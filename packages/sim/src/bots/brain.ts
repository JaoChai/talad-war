import { autoAimTarget } from '../autoAim';
import {
  ARENA_H,
  ARENA_W,
  BOMB_THROW_RANGE,
  CENTER_DROP_ZONE,
  HEALER_RADIUS,
  PICK_RADIUS,
  SLAP_RANGE,
} from '../constants';
import { dist2, vecClampLength, vecNormalize } from '../geometry';
import { nearestPickableCrate } from '../crates';
import { unitMaxHp, weaponStats } from '../items';
import type { Rect } from '../geometry';
import { stallCenter, stallRect } from '../map';
import { unitDead } from '../open';
import { canOpen, matchRecipe, padCellAt, padCellCenter, padPreview, placeCrate } from '../pad';
import type { Recipe } from '../pad';
import type {
  ClassPick,
  Crate,
  CrateId,
  MatchState,
  Pad,
  Unit,
  UnitInput,
  UnitId,
  Vec2,
} from '../types';
import { botGoal, chooseClass, teamNeeds } from './squad';

/** Input of a dead or unknown unit — phases skip dead units anyway. */
const IDLE_INPUT: UnitInput = Object.freeze({
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
});

/** Deterministic mill pattern: 8 compass headings, re-picked every MILL_TICKS. */
const MILL_DIRS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 0.7071067811865476, y: 0.7071067811865476 },
  { x: 0, y: 1 },
  { x: -0.7071067811865476, y: 0.7071067811865476 },
  { x: -1, y: 0 },
  { x: -0.7071067811865476, y: -0.7071067811865476 },
  { x: 0, y: -1 },
  { x: 0.7071067811865476, y: -0.7071067811865476 },
];
const MILL_TICKS = 4;
const VEER_TICKS = 40;

/**
 * What one bot wants this tick: a movement target with an arrival radius, a mill
 * speed for the arrived state, an explicit aim point (null = auto-aim), and the
 * action pulses. Everything is derived from the state — a bot has no memory
 * between ticks.
 */
interface BotPlan {
  target: Vec2;
  arriveRadius: number;
  millSpeed: number;
  aim: Vec2 | null;
  pickDrop: boolean;
  open: boolean;
  throwBomb: boolean;
  boundedMill?: boolean;
  classPick?: ClassPick;
  fire?: boolean;
}

/**
 * The input for bot unit `unitId` this tick (plan Task 5 contract). Pure and
 * deterministic: `s` is never mutated and the state's rng never advances (bots
 * use no randomness at all — their mill/veer/bomb patterns key on s.tick + the
 * unit's index within its team, never on the global unit id, so the two teams
 * play exact 180-degree mirror images of each other).
 */
export function botInput(s: MatchState, unitId: UnitId): UnitInput {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined || unitDead(unit)) return { ...IDLE_INPUT, move: { x: 0, y: 0 } };
  const opening = s.pads[unit.team].opening;
  if (opening?.byUnit === unit.id && opening.classId !== undefined)
    return { ...IDLE_INPUT, move: { x: 0, y: 0 } };
  const goal = botGoal(s, unit.id);
  const ti = teamIndexOf(s, unit);
  const plan =
    classPlan(s, unit, goal) ??
    (goal === 'fetch'
      ? fetchPlan(s, unit)
      : goal === 'guard'
        ? guardPlan(s, unit)
        : attackPlan(s, unit, ti));
  return {
    move: steer(unit, plan, s.tick, ti),
    aim: plan.aim, // explicit stall aim when the plan wants it, else auto-aim
    fire: plan.fire ?? autoAimTarget(s, unit.id) !== null,
    throwBomb: plan.throwBomb,
    pickDrop: plan.pickDrop,
    open: plan.open,
    ...(plan.classPick === undefined ? {} : { classPick: plan.classPick }),
  };
}

/** Index of the unit among its own team's units (ascending id; stable across deaths). */
function teamIndexOf(s: MatchState, unit: Unit): number {
  const index = s.units.filter((u) => u.team === unit.team).findIndex((u) => u.id === unit.id);
  return Math.max(0, index);
}

function fetchPlan(s: MatchState, unit: Unit): BotPlan {
  const pad = s.pads[unit.team];
  if (pad.opening !== null && pad.opening.byUnit !== unit.id) {
    // Another body's channel reserves the entire wall, even if need/bans change.
    return {
      target: rectCenterOfPad(pad),
      arriveRadius: 1,
      millSpeed: 0.4,
      aim: null,
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  if (pad.opening !== null && pad.opening.byUnit === unit.id) {
    // My own open is running: picking or placing now would change the pad
    // snapshot and cancel my own channel — hold still (mill in place).
    return {
      target: { ...unit.pos },
      arriveRadius: 0.3,
      millSpeed: 0.35,
      aim: null,
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  const needed = teamNeeds(s, unit.team);
  const preview = padPreview(s, unit.team);
  // A weapon loss can change the need while a legal buddy/bombs recipe is
  // ready. Finish it if it cannot extend toward the new need; don't strand it.
  const finishReady =
    needed !== null &&
    preview.openable &&
    (preview.recipe === needed || choosePadColumn(pad, needed) === null);
  if (finishReady) {
    const center = rectCenterOfPad(pad);
    if (unit.carrying !== null) {
      const unload = { x: center.x, y: center.y + (unit.team === 'fruit' ? -2.2 : 2.2) };
      return {
        target: unload,
        arriveRadius: 0.15,
        millSpeed: 0,
        aim: null,
        pickDrop: dist2(unit.pos, unload) <= 0.2 * 0.2,
        open: false,
        throwBomb: false,
      };
    }
    return {
      target: center,
      arriveRadius: 0.3,
      millSpeed: preview.recipe === 'class' ? 0 : 0.35,
      aim: null,
      pickDrop: false,
      open: canOpen(s, unit.id),
      throwBomb: false,
      ...(preview.recipe === 'class'
        ? {
            classPick: { classId: chooseClass(s, unit.team)!, snapshot: JSON.stringify(pad.cells) },
          }
        : {}),
    };
  }
  if (needed !== 'class' && pad.cells.some((c) => c[1] !== null)) {
    // Illegal/capped/incompatible wall: recover real upper crates with the same
    // own-pad pick/drop path humans use. Unload cargo outside before lifting more.
    if (unit.carrying !== null) return unloadPlan(unit, pad);
    const order = unit.team === 'fruit' ? [0, 1, 2, 3] : [3, 2, 1, 0];
    const col = order.find((i) => pad.cells[i]![1] !== null)!;
    return {
      target: padCellCenter(pad, col),
      arriveRadius: 0.25,
      millSpeed: 0,
      aim: null,
      pickDrop: padCellAt(pad, unit.pos) === col,
      open: false,
      throwBomb: false,
    };
  }
  if (unit.carrying !== null) {
    const col = needed === null ? null : choosePadColumn(pad, needed);
    if (col !== null) {
      const center = padCellCenter(pad, col);
      return {
        target: center,
        arriveRadius: 0.25,
        millSpeed: 0.3,
        aim: null,
        pickDrop: padCellAt(pad, unit.pos) === col, // place once standing on the column
        open: false,
        throwBomb: false,
      };
    }
    // Nothing useful to place yet (the missing recipe needs more crates): wait
    // near the pad until the pad can take this crate.
    return {
      target: rectCenterOfPad(pad),
      arriveRadius: 1.0,
      millSpeed: 0.4,
      aim: null,
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  const crate = claimCrate(s, unit);
  if (crate === null) {
    // No ground crates anywhere: wait where the next one drops.
    return {
      target: { x: CENTER_DROP_ZONE.x, y: CENTER_DROP_ZONE.y },
      arriveRadius: 3.5,
      millSpeed: 0.5,
      aim: null,
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  const reach = PICK_RADIUS * PICK_RADIUS * 0.81; // pulse slightly inside the pick radius
  return {
    target: { ...crate.pos },
    arriveRadius: 0.4,
    millSpeed: 0.5,
    aim: null,
    pickDrop:
      dist2(unit.pos, crate.pos) <= reach && nearestPickableCrate(s, unit.pos)?.id === crate.id,
    open: false,
    throwBomb: false,
  };
}

function unloadPlan(unit: Unit, pad: Pad): BotPlan {
  const center = rectCenterOfPad(pad);
  const target = { x: center.x, y: center.y + (unit.team === 'fruit' ? -2.2 : 2.2) };
  return {
    target,
    arriveRadius: 0.15,
    millSpeed: 0,
    aim: null,
    pickDrop: dist2(unit.pos, target) <= 0.2 * 0.2,
    open: false,
    throwBomb: false,
  };
}

/** Bounded class tactics; explicit guard/fetch still use their normal plans. */
function classPlan(s: MatchState, unit: Unit, goal: ReturnType<typeof botGoal>): BotPlan | null {
  if (goal !== 'attack') return null;
  if (unit.classId === 'healer' && s.commands[unit.team] === null) {
    const ally = s.units
      .filter(
        (u) => u.team === unit.team && u.id !== unit.id && !unitDead(u) && u.hp < unitMaxHp(u),
      )
      .sort(
        (a, b) =>
          a.hp / unitMaxHp(a) - b.hp / unitMaxHp(b) ||
          dist2(unit.pos, a.pos) - dist2(unit.pos, b.pos) ||
          a.id - b.id,
      )[0];
    if (ally !== undefined)
      return {
        target: { ...ally.pos },
        arriveRadius: HEALER_RADIUS,
        millSpeed: 0,
        aim: null,
        pickDrop: false,
        open: false,
        throwBomb: false,
      };
  }
  if (unit.classId === 'ninja' && unit.gun === null && unit.carrying === null) {
    const pad = s.pads[unit.team === 'fruit' ? 'dessert' : 'fruit'];
    // Resolve distance ties in canonical order so a rotation cannot pick another column.
    const order = unit.team === 'fruit' ? [0, 1, 2, 3] : [3, 2, 1, 0];
    const col = order
      .filter((i) => pad.cells[i]!.some((c) => c !== null))
      .sort(
        (a, b) => dist2(unit.pos, padCellCenter(pad, a)) - dist2(unit.pos, padCellCenter(pad, b)),
      )[0];
    if (col !== undefined)
      return {
        target: padCellCenter(pad, col),
        arriveRadius: 0.25,
        millSpeed: 0,
        aim: null,
        fire: padCellAt(pad, unit.pos) === col,
        pickDrop: false,
        open: false,
        throwBomb: false,
      };
  }
  return null;
}

/** A guard engages enemies that push its stall closer than this to the stall centre. */
const GUARD_CHASE_RADIUS = 3.0;

function guardPlan(s: MatchState, unit: Unit): BotPlan {
  const center = stallCenter(unit.team);
  // Engage the nearest enemy pushing the stall (the plan scopes guard stillness
  // to "while no enemy is near"); otherwise mill at the post. Team-index-safe:
  // the choice keys on distances and the lower enemy id on exact ties, both of
  // which are preserved under the 180-degree arena rotation.
  let best: Unit | null = null;
  let bestD2 = GUARD_CHASE_RADIUS * GUARD_CHASE_RADIUS;
  for (const enemy of s.units) {
    if (enemy.team === unit.team || unitDead(enemy)) continue;
    const d2 = dist2(enemy.pos, center);
    if (d2 > bestD2) continue;
    if (d2 === bestD2 && best !== null && enemy.id > best.id) continue;
    best = enemy;
    bestD2 = d2;
  }
  if (best !== null) {
    return {
      target: { ...best.pos }, // close into slap range; fire pulses via auto-aim
      arriveRadius: 0.2,
      millSpeed: 0.6,
      aim: null,
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  return {
    target: center,
    arriveRadius: 1.5,
    millSpeed: 0.6,
    aim: null,
    pickDrop: false,
    open: false,
    throwBomb: false,
  };
}

function attackPlan(s: MatchState, unit: Unit, ti: number): BotPlan {
  const enemy = unit.team === 'fruit' ? 'dessert' : 'fruit';
  const rect = stallRect(enemy);
  const nr = nearestRectPoint(unit.pos, rect);
  const dx = unit.pos.x - nr.x;
  const dy = unit.pos.y - nr.y;
  const d = Math.hypot(dx, dy);
  const armed = unit.gun !== null;
  const range = unit.gun === null ? SLAP_RANGE : weaponStats(unit.gun).range;
  const closeAttackGroup =
    !armed &&
    unit.bombs === 0 &&
    d <= 3 &&
    s.units.filter(
      (u) =>
        u.team === unit.team &&
        u.isBot &&
        !unitDead(u) &&
        u.gun === null &&
        u.bombs === 0 &&
        botGoal(s, u.id) === 'attack',
    ).length > 1;
  if (closeAttackGroup) {
    // Stable close-attack stations, not the current position: self-anchored
    // full-speed milling drifts along the face and piles teammates together.
    // Resolve in fruit space then rotate; global ids must never choose slots.
    const canonical = stallRect('dessert');
    const slots = [
      { x: canonical.minX - 0.7, y: canonical.minY + 2.4 },
      { x: canonical.minX + 0.7, y: canonical.maxY + 0.7 },
      { x: canonical.minX - 0.7, y: canonical.minY + 0.2 },
      { x: canonical.maxX - 0.5, y: canonical.maxY + 0.7 },
      { x: canonical.maxX + 0.7, y: canonical.minY + 2.4 },
    ];
    const canonicalPos = (u: Unit): Vec2 =>
      u.team === 'fruit' ? u.pos : { x: ARENA_W - u.pos.x, y: ARENA_H - u.pos.y };
    // Incumbents claim their nearest station first, then arrivals take the
    // nearest free face. Ties use TEAM INDEX, not global ids or team direction.
    // No remembered assignment: identical mirrored states give identical claims.
    const group = s.units
      .filter(
        (u) =>
          u.team === unit.team &&
          u.isBot &&
          !unitDead(u) &&
          u.gun === null &&
          u.bombs === 0 &&
          botGoal(s, u.id) === 'attack',
      )
      .sort(
        (a, b) =>
          Math.min(...slots.map((p) => dist2(canonicalPos(a), p))) -
            Math.min(...slots.map((p) => dist2(canonicalPos(b), p))) ||
          teamIndexOf(s, a) - teamIndexOf(s, b),
      );
    const free = new Set(slots.map((_, i) => i));
    let at = slots[0]!;
    for (const mate of group) {
      const pos = canonicalPos(mate);
      const slot = [...free].sort(
        (a, b) => dist2(pos, slots[a]!) - dist2(pos, slots[b]!) || a - b,
      )[0]!;
      free.delete(slot);
      if (mate.id === unit.id) {
        at = slots[slot]!;
        break;
      }
    }
    return {
      target: unit.team === 'fruit' ? at : { x: ARENA_W - at.x, y: ARENA_H - at.y },
      arriveRadius: 0.25,
      millSpeed: 0.25,
      boundedMill: true,
      aim: nr, // movement no longer makes a slapper face away from its attack
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  // Bomb carriers close in first: the throw range is shorter than the gun range,
  // and a carrier that holds at gun range never releases its bombs.
  const holdDist = unit.bombs > 0 ? BOMB_THROW_RANGE - 0.5 : armed ? range - 1.5 : SLAP_RANGE - 0.6;
  // Mirrored stand-in heading for the degenerate "standing exactly on the stall"
  // case — negated for dessert so the two teams' headings stay mirror images.
  const from =
    d > 1e-6 ? { x: dx / d, y: dy / d } : unit.team === 'fruit' ? { x: 0, y: 1 } : { x: 0, y: -1 };
  const bombsReady = bombAtStall(s, unit, d, ti);
  // Ranged pressure on the stall (card t_38d70034): an armed attack bot in gun
  // range with no enemy close enough to contest aims at the stall's nearest
  // point instead of auto-aiming at the milling guard; bomb carriers about to
  // throw aim there too, so the bomb lands on the stall rather than along the
  // last walk direction.
  const enemyNear = s.units.some(
    (e) => e.team !== unit.team && !unitDead(e) && dist2(unit.pos, e.pos) <= (SLAP_RANGE * 2) ** 2,
  );
  const aim =
    (armed && d <= range && !enemyNear) || bombsReady || (!armed && d <= SLAP_RANGE) ? nr : null;
  if (d > holdDist + 0.4) {
    return {
      target: { x: nr.x + from.x * holdDist, y: nr.y + from.y * holdDist },
      arriveRadius: 0.5,
      millSpeed: 0.5,
      aim,
      pickDrop: false,
      open: false,
      throwBomb: bombsReady,
    };
  }
  return {
    target: { ...unit.pos },
    arriveRadius: 0.3,
    millSpeed: armed ? 0.5 : 0.25, // slappers mill tighter to stay in slap range
    aim,
    pickDrop: false,
    open: false,
    throwBomb: bombsReady,
  };
}

/** Space bomb throws 3 s apart so a 3-stack lasts, and only within throw range. */
function bombAtStall(s: MatchState, unit: Unit, distToStall: number, ti: number): boolean {
  if (unit.bombs <= 0 || distToStall > BOMB_THROW_RANGE - 0.5) return false;
  // Team index, not unit id: the two teams' carriers must throw on the same
  // cadence or the mirror symmetry breaks.
  return (s.tick + ti) % 60 === 0;
}

/**
 * Veered straight-line steering (the card's "go straight; slide along / pick a
 * side detour"). Toward the target with a perpendicular bias that flips on a
 * fixed cadence, so obstacle faces are slid along and corners rounded without
 * pathfinding. On arrival the bot mills on a fixed deterministic pattern — it
 * never freezes (the stuck contract), but stays near its post via a weak pull.
 * Both patterns key on the unit's team index (never its global id), and the
 * dessert mill rotates its headings by 180 degrees, so the two teams steer as
 * exact mirror images.
 */
function steer(unit: Unit, plan: BotPlan, tick: number, ti: number): Vec2 {
  const to = { x: plan.target.x - unit.pos.x, y: plan.target.y - unit.pos.y };
  const d = Math.hypot(to.x, to.y);
  if (d > plan.arriveRadius) {
    const sign = (Math.floor(tick / VEER_TICKS) + ti) % 2 === 0 ? 1 : -1;
    return vecNormalize({
      x: to.x / d - (to.y / d) * 0.45 * sign,
      y: to.y / d + (to.x / d) * 0.45 * sign,
    });
  }
  if (plan.millSpeed === 0) return { x: 0, y: 0 };
  const mill = MILL_DIRS[
    (Math.floor(tick / MILL_TICKS) + ti * 3 + (unit.team === 'dessert' ? 4 : 0)) % MILL_DIRS.length
  ] ?? { x: 0, y: 0 };
  if (plan.boundedMill) {
    // Retain the small mill's magnitude instead of normalizing it to full speed.
    return vecClampLength(
      { x: mill.x * plan.millSpeed + to.x * 2, y: mill.y * plan.millSpeed + to.y * 2 },
      0.5,
    );
  }
  const pull = d > 1e-6 ? { x: (to.x / d) * 0.25, y: (to.y / d) * 0.25 } : { x: 0, y: 0 };
  return vecNormalize({ x: mill.x * plan.millSpeed + pull.x, y: mill.y * plan.millSpeed + pull.y });
}

/**
 * Deterministic crate claim: teammates that are living, empty-handed fetch bots
 * with a LOWER id claim their nearest ground crate first (each seeing the claims
 * before it); this bot then takes its nearest unclaimed crate. Every bot computes
 * the same greedy from the same state, so claims never collide and no memory is
 * needed. Teammates with a higher id do not constrain this bot — they defer to it.
 */
function claimCrate(s: MatchState, unit: Unit): Crate | null {
  const claimed = new Set<CrateId>();
  for (const mate of s.units) {
    if (mate.id >= unit.id) break; // units ascend by id
    if (mate.team !== unit.team || !mate.isBot || unitDead(mate)) continue;
    if (mate.carrying !== null || botGoal(s, mate.id) !== 'fetch') continue;
    const crate = nearestUnclaimedCrate(s, mate, claimed);
    if (crate !== null) claimed.add(crate.id);
  }
  return nearestUnclaimedCrate(s, unit, claimed);
}

function nearestUnclaimedCrate(s: MatchState, unit: Unit, claimed: Set<CrateId>): Crate | null {
  let best: Crate | null = null;
  let bestD2 = Infinity;
  const preferSuper = !s.itemBans?.[unit.team]?.includes('super');
  for (const crate of s.crates) {
    if (crate.state !== 'ground' || claimed.has(crate.id)) continue;
    // Coincident drops cannot be separated by movement: ordinary pickup must
    // take the lowest ID at that point first. Reserve that prerequisite using
    // the same greedy claims, rather than wait forever for an unreachable super
    // or pick an unrelated normal on the way there.
    const firstAtPoint = nearestPickableCrate(s, crate.pos);
    if (firstAtPoint === null || claimed.has(firstAtPoint.id)) continue;
    const d2 = dist2(unit.pos, crate.pos);
    const quality = preferSuper ? Number(crate.kind === 'super') : 0;
    const bestQuality = preferSuper ? Number(best?.kind === 'super') : 0;
    if (
      best === null ||
      quality > bestQuality ||
      (quality === bestQuality && (d2 < bestD2 || (d2 === bestD2 && crate.id < best.id)))
    ) {
      best = crate;
      bestD2 = d2;
    }
  }
  // At the chosen point its own crate is distance zero, so only exact
  // co-location/lower-ID ties can redirect the claim (never nearby normals).
  return best === null ? null : nearestPickableCrate(s, best.pos);
}

/**
 * The column whose placement moves the pad toward `needed`: first column that
 * completes `needed` exactly, else — for bombs/buddy, which start from an empty
 * pad — the first column that keeps the pad extensible (one crate down, recipe
 * still completable). Null when no placement helps (hold the crate). Dessert
 * resolves the choice in fruit-canonical column space and maps back (col c of
 * one pad is the 180-degree rotation of col 3-c of the other), so both teams
 * build the same mirrored shape.
 */
function choosePadColumn(pad: Pad, needed: Recipe): number | null {
  if (pad.team === 'dessert') {
    const canonical: Pad = {
      ...pad,
      team: 'fruit', // resolve in fruit-canonical space; never recurse back into this branch
      cells: pad.cells.map((_, i) => [
        ...((pad.cells[pad.cells.length - 1 - i] ?? []) as Array<CrateId | null>),
      ]),
    };
    const col = choosePadColumn(canonical, needed);
    return col === null ? null : pad.cells.length - 1 - col;
  }
  if (needed === 'class') {
    const pair = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ].find((p) =>
      pad.cells.every(
        (c, i) =>
          (p.includes(i) || c.every((id) => id === null)) && (c[1] === null || c[0] !== null),
      ),
    );
    if (pair === undefined) return null;
    // Complete the floor before either upper: never stray into a third column.
    for (const layer of [0, 1])
      for (const col of pair) if (pad.cells[col]![layer] === null) return col;
    return null;
  }
  let total = 0;
  const candidates: number[] = [];
  for (let col = 0; col < pad.cells.length; col++) {
    const column = pad.cells[col];
    if (column === undefined) continue;
    for (const crate of column) if (crate !== null) total++;
    if ((column[0] ?? null) !== null || (column[1] ?? null) !== null) candidates.push(col);
    else candidates.unshift(col); // empty cols first, highest col first among them (unshift while ascending) — ground spots stay open for the two-crate recipe; stacking cols come last
  }
  for (const col of candidates) {
    // Only the temporary clone sees this sentinel; no state, IDs or RNG change.
    const trial: Pad = { ...pad, cells: pad.cells.map((c) => [...c]) };
    const layer = placeCrate(trial, col, -1);
    if (layer === 'full') continue;
    if (needed === 'heavy') {
      if (
        layer === 'ground' &&
        trial.cells.every((c) => c[1] === null) &&
        (total < 3 || matchRecipe(trial) === 'heavy')
      )
        return col;
    } else if (matchRecipe(trial) === needed) return col;
  }
  if ((needed === 'bombs' || needed === 'buddy') && total === 0) return candidates[0] ?? null;
  return null;
}

function rectCenterOfPad(pad: Pad): Vec2 {
  const half = 1.5; // PAD_FLOOR * PAD_CELL_SIZE / 2
  return { x: pad.origin.x + half, y: pad.origin.y + half };
}

function nearestRectPoint(p: Vec2, rect: Rect): Vec2 {
  return {
    x: Math.min(Math.max(p.x, rect.minX), rect.maxX),
    y: Math.min(Math.max(p.y, rect.minY), rect.maxY),
  };
}
