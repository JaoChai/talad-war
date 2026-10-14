import { autoAimTarget } from '../autoAim';
import {
  BOMB_THROW_RANGE,
  CENTER_DROP_ZONE,
  GUN_RANGE,
  PICK_RADIUS,
  SLAP_RANGE,
} from '../constants';
import { dist2, vecNormalize } from '../geometry';
import type { Rect } from '../geometry';
import { stallCenter, stallRect } from '../map';
import { unitDead } from '../open';
import { canOpen, padCellAt, padCellCenter, padPreview } from '../pad';
import type { Recipe } from '../pad';
import type { Crate, CrateId, MatchState, Pad, Unit, UnitInput, UnitId, Vec2 } from '../types';
import { botGoal, teamNeeds } from './squad';

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
 * speed for the arrived state, and the action pulses. Everything is derived from
 * the state — a bot has no memory between ticks.
 */
interface BotPlan {
  target: Vec2;
  arriveRadius: number;
  millSpeed: number;
  pickDrop: boolean;
  open: boolean;
  throwBomb: boolean;
}

/**
 * The input for bot unit `unitId` this tick (plan Task 5 contract). Pure and
 * deterministic: `s` is never mutated and the state's rng never advances (bots
 * use no randomness at all — their mill/veer patterns key on s.tick + unit id).
 */
export function botInput(s: MatchState, unitId: UnitId): UnitInput {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined || unitDead(unit)) return { ...IDLE_INPUT, move: { x: 0, y: 0 } };
  const goal = botGoal(s, unit.id);
  const plan =
    goal === 'fetch'
      ? fetchPlan(s, unit)
      : goal === 'guard'
        ? guardPlan(s, unit)
        : attackPlan(s, unit);
  return {
    move: steer(unit, plan, s.tick),
    aim: null, // auto-aim: combat picks the target (nearest enemy unit, else stall)
    fire: autoAimTarget(s, unit.id) !== null,
    throwBomb: plan.throwBomb,
    pickDrop: plan.pickDrop,
    open: plan.open,
  };
}

function fetchPlan(s: MatchState, unit: Unit): BotPlan {
  const pad = s.pads[unit.team];
  if (pad.opening !== null && pad.opening.byUnit === unit.id) {
    // My own open is running: picking or placing now would change the pad
    // snapshot and cancel my own channel — hold still (mill in place).
    return {
      target: { ...unit.pos },
      arriveRadius: 0.3,
      millSpeed: 0.35,
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  const needed = teamNeeds(s, unit.team);
  if (unit.carrying !== null) {
    const col = needed === null ? null : choosePadColumn(pad, needed);
    if (col !== null) {
      const center = padCellCenter(pad, col);
      return {
        target: center,
        arriveRadius: 0.25,
        millSpeed: 0.3,
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
      pickDrop: false,
      open: false,
      throwBomb: false,
    };
  }
  if (needed !== null && canOpen(s, unit.id)) {
    const preview = padPreview(s, unit.team);
    if (preview.openable && preview.recipe === needed) {
      return {
        target: { ...unit.pos },
        arriveRadius: 0.3,
        millSpeed: 0.35,
        pickDrop: false,
        open: true,
        throwBomb: false,
      };
    }
  }
  const crate = claimCrate(s, unit);
  if (crate === null) {
    // No ground crates anywhere: wait where the next one drops.
    return {
      target: { x: CENTER_DROP_ZONE.x, y: CENTER_DROP_ZONE.y },
      arriveRadius: 3.5,
      millSpeed: 0.5,
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
    pickDrop: dist2(unit.pos, crate.pos) <= reach,
    open: false,
    throwBomb: false,
  };
}

function guardPlan(s: MatchState, unit: Unit): BotPlan {
  return {
    target: stallCenter(unit.team),
    arriveRadius: 1.5,
    millSpeed: 0.6,
    pickDrop: false,
    open: false,
    throwBomb: false,
  };
}

function attackPlan(s: MatchState, unit: Unit): BotPlan {
  const enemy = unit.team === 'fruit' ? 'dessert' : 'fruit';
  const rect = stallRect(enemy);
  const nr = nearestRectPoint(unit.pos, rect);
  const dx = unit.pos.x - nr.x;
  const dy = unit.pos.y - nr.y;
  const d = Math.hypot(dx, dy);
  const armed = unit.gun !== null;
  const holdDist = armed ? GUN_RANGE - 1.5 : SLAP_RANGE - 0.6;
  const from = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 0, y: 1 };
  const bombsReady = bombAtStall(s, unit, d);
  if (d > holdDist + 0.4) {
    return {
      target: { x: nr.x + from.x * holdDist, y: nr.y + from.y * holdDist },
      arriveRadius: 0.5,
      millSpeed: 0.5,
      pickDrop: false,
      open: false,
      throwBomb: bombsReady,
    };
  }
  return {
    target: { ...unit.pos },
    arriveRadius: 0.3,
    millSpeed: armed ? 0.5 : 0.25, // slappers mill tighter to stay in slap range
    pickDrop: false,
    open: false,
    throwBomb: bombsReady,
  };
}

/** Space bomb throws 1.5 s apart so a 3-stack lasts, and only within throw range. */
function bombAtStall(s: MatchState, unit: Unit, distToStall: number): boolean {
  if (unit.bombs <= 0 || distToStall > BOMB_THROW_RANGE - 0.5) return false;
  return (s.tick + unit.id) % 30 === 0;
}

/**
 * Veered straight-line steering (the card's "go straight; slide along / pick a
 * side detour"). Toward the target with a perpendicular bias that flips on a
 * fixed cadence, so obstacle faces are slid along and corners rounded without
 * pathfinding. On arrival the bot mills on a fixed deterministic pattern — it
 * never freezes (the stuck contract), but stays near its post via a weak pull.
 */
function steer(unit: Unit, plan: BotPlan, tick: number): Vec2 {
  const to = { x: plan.target.x - unit.pos.x, y: plan.target.y - unit.pos.y };
  const d = Math.hypot(to.x, to.y);
  if (d > plan.arriveRadius) {
    const sign = (Math.floor(tick / VEER_TICKS) + unit.id) % 2 === 0 ? 1 : -1;
    return vecNormalize({
      x: to.x / d - (to.y / d) * 0.45 * sign,
      y: to.y / d + (to.x / d) * 0.45 * sign,
    });
  }
  const dir = MILL_DIRS[(Math.floor(tick / MILL_TICKS) + unit.id * 3) % MILL_DIRS.length] ?? {
    x: 0,
    y: 0,
  };
  const pull = d > 1e-6 ? { x: (to.x / d) * 0.25, y: (to.y / d) * 0.25 } : { x: 0, y: 0 };
  return vecNormalize({ x: dir.x * plan.millSpeed + pull.x, y: dir.y * plan.millSpeed + pull.y });
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
    const crate = nearestUnclaimedCrate(s, mate.pos, claimed);
    if (crate !== null) claimed.add(crate.id);
  }
  return nearestUnclaimedCrate(s, unit.pos, claimed);
}

function nearestUnclaimedCrate(s: MatchState, pos: Vec2, claimed: Set<CrateId>): Crate | null {
  let best: Crate | null = null;
  let bestD2 = Infinity;
  for (const crate of s.crates) {
    if (crate.state !== 'ground' || claimed.has(crate.id)) continue;
    const d2 = dist2(pos, crate.pos);
    if (d2 < bestD2 || (d2 === bestD2 && best !== null && crate.id < best.id)) {
      best = crate;
      bestD2 = d2;
    }
  }
  return best;
}

/**
 * The column whose placement moves the pad toward `needed`: first column that
 * completes `needed` exactly, else — for bombs/buddy, which start from an empty
 * pad — the first column that keeps the pad extensible (one crate down, recipe
 * still completable). Null when no placement helps (hold the crate).
 */
function choosePadColumn(pad: Pad, needed: Recipe): number | null {
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
    if (recipeAfterPlace(pad, col, total) === needed) return col;
  }
  if ((needed === 'bombs' || needed === 'buddy') && total === 0) return candidates[0] ?? null;
  return null;
}

/**
 * matchRecipe(pad) after placeCrate(pad, col, ...): ground layer when free, else
 * upper (stacking). Mirrors pad.ts's exact-shape rules without cloning the pad.
 */
function recipeAfterPlace(pad: Pad, col: number, total: number): Recipe | null {
  const column = pad.cells[col];
  if (column === undefined) return null;
  const groundFree = (column[0] ?? null) === null;
  const upperFree = (column[1] ?? null) === null;
  if (!groundFree && !upperFree) return null; // placeCrate would return 'full'
  const count = total + 1;
  if (count === 1) return 'gun';
  if (count > 2) return null;
  // Exactly two crates after the placement: buddy iff some column ends with both
  // layers (this one when the crate stacks), else bombs iff the two ground crates
  // sit in adjacent columns.
  let stacked = !groundFree; // placing into an occupied ground column stacks it
  if (!stacked) {
    for (let c = 0; c < pad.cells.length; c++) {
      if (c === col) continue;
      const other = pad.cells[c];
      if (other !== undefined && (other[0] ?? null) !== null && (other[1] ?? null) !== null) {
        stacked = true;
      }
    }
  }
  if (stacked) return 'buddy';
  const grounds: number[] = [];
  for (let c = 0; c < pad.cells.length; c++) {
    const other = pad.cells[c];
    // The placed crate itself lands on layer 0 of `col` when that ground is
    // free — count it, or a one-crate pad can never reach the two-ground shape.
    if (other !== undefined && ((other[0] ?? null) !== null || (c === col && groundFree))) {
      grounds.push(c);
    }
  }
  if (grounds.length !== 2) return null;
  const a = grounds[0] ?? -1;
  const b = grounds[1] ?? -1;
  return Math.abs((a % 2) - (b % 2)) + Math.abs(Math.floor(a / 2) - Math.floor(b / 2)) === 1
    ? 'bombs'
    : null;
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
