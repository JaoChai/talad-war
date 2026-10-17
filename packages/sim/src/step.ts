import { ARENA_H, ARENA_W, DT, UNIT_RADIUS } from './constants';
import { updateClassHealing } from './classes';
import { controlledUnit, switchControl } from './control';
import { unitMoveSpeed } from './items';
import { botInput } from './bots/brain';
import { updateProjectiles, processAttacks, updateRespawns, updateWinner } from './combat';
import { spawnCrates, tryDrop, tryPick, updateCrateFalls } from './crates';
import { clamp, vecClampLength, vecNormalize } from './geometry';
import { isUnitWalkable } from './map';
import { startOpen, unitDead, updateOpens } from './open';
import { canStartOpen, liftTop, padCellAt, padCellCenter, placeCrate } from './pad';
import type { MatchState, Pad, SquadCommand, Team, Unit, UnitInput, UnitId, Vec2 } from './types';

/**
 * Fixed per-tick phase order — do not reorder; later tasks fill their phase in place:
 *   1. commands      (Task 5: apply squad commands)
 *  1b. control       (R2: handoff before bot authoring; both bodies idle)
 *   2. bot inputs    (Task 5: bots author UnitInputs)
 *   3. movement      (this card)
 *   4. pick/drop     (this card)
 *   5. pad           (Task 3: placement / lift)
 *   6. open          (Task 3: Open! channel)
 *   7. combat        (Task 4: guns, bombs, stall damage)
 *   8. respawn       (Task 4)
 *   9. crate spawns  (this card)
 *  10. winner        (Task 4: stall destruction)
 *
 * `step` is pure at its edge: it clones the state (structuredClone), mutates the clone
 * and returns it. `events` is reset every tick and holds only the latest tick's events.
 * pickDrop is level-triggered; the client sends it as a one-tick pulse.
 */
const IDLE_INPUT: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};

export function step(
  s: MatchState,
  inputs: ReadonlyMap<UnitId, UnitInput>,
  commands?: Partial<Record<Team, SquadCommand>>,
): MatchState {
  const next = structuredClone(s);
  next.tick += 1;
  next.events = [];

  // Q5: the match is over — nothing changes but the tick (no movement, spawns
  // or damage; `events` stays empty).
  if (s.winner !== null) return next;

  // Phase 1: squad commands — store what arrived; a missing key keeps the
  // previous command (commands persist in the state until changed or cleared).
  if (commands !== undefined) {
    if (commands.fruit !== undefined) next.commands.fruit = commands.fruit;
    if (commands.dessert !== undefined) next.commands.dessert = commands.dessert;
  }

  // Phase 1b: accept only the current owner's pulse, once. Never carry either
  // body's pre-buffered actions into a handoff or author the released bot yet.
  const effective = new Map(inputs);
  const handoffIdle = new Set<UnitId>();
  const source = controlledUnit(next);
  if (source !== null && inputs.get(source.id)?.switchNext) {
    const targetId = switchControl(next, source.id);
    if (targetId !== null) {
      for (const id of [source.id, targetId]) {
        handoffIdle.add(id);
        effective.set(id, IDLE_INPUT);
      }
    }
  }

  // Phase 2: ordinary living bots author inputs on the post-command/control
  // state; a successful handoff's two bodies remain idle until the next tick.
  for (const unit of next.units) {
    if (!unit.isBot || unitDead(unit) || handoffIdle.has(unit.id)) continue;
    effective.set(unit.id, botInput(next, unit.id));
  }

  // Phase 3: movement (the dead do not move — Task 4 rule).
  for (const unit of next.units) {
    if (unitDead(unit)) continue;
    moveUnit(unit, effective.get(unit.id) ?? IDLE_INPUT);
  }

  // Phases 4-5 share one decision: each pickDrop pulse performs exactly ONE action,
  // chosen here on the post-movement state. "Open wins if canOpen, else pickDrop
  // applies" — decided once per tick too, so one input never performs both actions.
  // A unit absent from `venue` performs nothing this tick (open won, or enemy pad).
  const openWins = new Set<UnitId>();
  const venue = new Map<UnitId, 'ground' | 'pad'>();
  for (const unit of next.units) {
    const input = effective.get(unit.id) ?? IDLE_INPUT;
    if (unitDead(unit)) continue; // the dead do not act (Task 4 rule)
    if (input.open && canStartOpen(next, unit.id, input.classPick)) openWins.add(unit.id);
    if (!input.pickDrop || openWins.has(unit.id)) continue;
    if (padCellAt(next.pads[otherTeam(unit.team)], unit.pos) !== null) continue; // no stealing
    const col = padCellAt(next.pads[unit.team], unit.pos);
    // On the own pad: place while carrying, lift from an occupied column (priority
    // over the ground pick); an empty column keeps the T2 ground pick.
    venue.set(
      unit.id,
      col !== null && (unit.carrying !== null || columnCrateCount(next.pads[unit.team], col) > 0)
        ? 'pad'
        : 'ground',
    );
  }

  // Phase 4: pick/drop, ascending unit id so the lower id wins same-crate ties.
  for (const unit of next.units) {
    const input = effective.get(unit.id) ?? IDLE_INPUT;
    if (!input.pickDrop || openWins.has(unit.id) || venue.get(unit.id) !== 'ground') continue;
    if (unit.carrying !== null) tryDrop(next, unit);
    else tryPick(next, unit);
  }

  // Phase 5: pad — place while carrying, lift the top crate when empty-handed.
  for (const unit of next.units) {
    const input = effective.get(unit.id) ?? IDLE_INPUT;
    if (!input.pickDrop || openWins.has(unit.id) || venue.get(unit.id) !== 'pad') continue;
    const col = padCellAt(next.pads[unit.team], unit.pos);
    if (col === null) continue; // unreachable: decided on the same post-movement state
    if (unit.carrying !== null) placeOnPad(next, unit, col);
    else liftFromPad(next, unit, col);
  }

  // Phase 6: open — progress running openings, then start new ones. canOpen is
  // rechecked: phases 4-5 may have changed the pad or the opening state.
  updateOpens(next);
  for (const unit of next.units) {
    const input = effective.get(unit.id) ?? IDLE_INPUT;
    if (input.open && openWins.has(unit.id) && canStartOpen(next, unit.id, input.classPick)) {
      startOpen(next, unit.id, input.classPick);
    }
  }

  // Phase 7: combat — attacks (cooldowns, slaps, bullets, bombs), then projectile
  // motion. Freshly spawned projectiles first act on the next tick.
  const freshProjectiles = processAttacks(next, effective);
  updateProjectiles(next, freshProjectiles);

  // Simultaneous class healing sees projectile deaths, but not phase-8 respawns.
  updateClassHealing(next);

  // Phase 8: respawn — heal the dead back at their stall once deadUntilTick arrives.
  updateRespawns(next);

  // Phase 9: crate spawns.
  updateCrateFalls(next);
  spawnCrates(next);

  // Phase 10: winner — stall destruction ends the match (Q5).
  updateWinner(next);

  return next;
}

function moveUnit(unit: Unit, input: UnitInput): void {
  const speed = unitMoveSpeed(unit);
  const move = vecClampLength(input.move, 1);
  const dx = move.x * speed * DT;
  const dy = move.y * speed * DT;
  tryAxis(unit, dx, 0); // slide along walls: x and y resolve independently
  tryAxis(unit, 0, dy);
  updateFacing(unit, input, move);
}

function tryAxis(unit: Unit, dx: number, dy: number): void {
  const candidate = {
    x: clamp(unit.pos.x + dx, UNIT_RADIUS, ARENA_W - UNIT_RADIUS),
    y: clamp(unit.pos.y + dy, UNIT_RADIUS, ARENA_H - UNIT_RADIUS),
  };
  if (isUnitWalkable(candidate, UNIT_RADIUS)) unit.pos = candidate;
}

function updateFacing(unit: Unit, input: UnitInput, move: Vec2): void {
  if (input.aim !== null) {
    const v = vecNormalize({ x: input.aim.x - unit.pos.x, y: input.aim.y - unit.pos.y });
    if (v.x !== 0 || v.y !== 0) unit.facing = v;
    return;
  }
  if (move.x !== 0 || move.y !== 0) unit.facing = vecNormalize(move);
}

function otherTeam(team: Team): Team {
  return team === 'fruit' ? 'dessert' : 'fruit';
}

function columnCrateCount(pad: Pad, col: number): number {
  const column = pad.cells[col];
  if (column === undefined) return 0;
  let count = 0;
  for (const crate of column) if (crate !== null) count++;
  return count;
}

/** Phase 5: carried crate onto the own pad. 'full' keeps it carried (shake event only). */
function placeOnPad(s: MatchState, unit: Unit, col: number): void {
  const crateId = unit.carrying;
  if (crateId === null) return;
  const pad = s.pads[unit.team];
  if (placeCrate(pad, col, crateId) === 'full') {
    s.events.push({ tick: s.tick, kind: 'padFull', unitId: unit.id, team: unit.team, col });
    return;
  }
  const crate = s.crates.find((c) => c.id === crateId);
  if (crate !== undefined) {
    crate.state = 'onPad';
    crate.pos = padCellCenter(pad, col);
  }
  unit.carrying = null;
}

/** Phase 5: empty hands on an occupied own cell lifts the top crate (carry it). */
function liftFromPad(s: MatchState, unit: Unit, col: number): void {
  const crateId = liftTop(s.pads[unit.team], col);
  if (crateId === null) return; // unreachable: phase 4 gates on an occupied column
  unit.carrying = crateId;
  const crate = s.crates.find((c) => c.id === crateId);
  if (crate !== undefined) crate.state = 'carried';
}
