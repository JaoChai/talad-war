import { ARENA_H, ARENA_W, CARRY_SPEED, DT, UNIT_RADIUS, UNIT_SPEED } from './constants';
import { spawnCrates, tryDrop, tryPick, updateCrateFalls } from './crates';
import { clamp, vecClampLength, vecNormalize } from './geometry';
import { isUnitWalkable } from './map';
import type { MatchState, SquadCommand, Team, Unit, UnitInput, UnitId, Vec2 } from './types';

/**
 * Fixed per-tick phase order — do not reorder; later tasks fill their phase in place:
 *   1. commands      (Task 5: apply squad commands)
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

  // Phase 1: squad commands — no behaviour until Task 5.
  void commands;
  // Phase 2: bot inputs — no behaviour until Task 5.

  // Phase 3: movement.
  for (const unit of next.units) moveUnit(unit, inputs.get(unit.id) ?? IDLE_INPUT);

  // Phase 4: pick/drop, ascending unit id so the lower id wins same-crate ties.
  for (const unit of next.units) {
    const input = inputs.get(unit.id) ?? IDLE_INPUT;
    if (!input.pickDrop) continue;
    if (unit.carrying === null) tryPick(next, unit);
    else tryDrop(next, unit);
  }

  // Phases 5-8: pad / open / combat / respawn — no behaviour until Tasks 3-4.

  // Phase 9: crate spawns.
  updateCrateFalls(next);
  spawnCrates(next);

  // Phase 10: winner — no behaviour until Task 4.

  return next;
}

function moveUnit(unit: Unit, input: UnitInput): void {
  const speed = unit.carrying === null ? UNIT_SPEED : CARRY_SPEED;
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
