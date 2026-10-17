import {
  CENTER_DROP_ZONE,
  DROP_FALL_TICKS,
  DROP_INTERVAL_CENTER_TICKS,
  DROP_INTERVAL_SIDE_TICKS,
  MAX_GROUND_CRATES,
  PICK_RADIUS,
  SIDE_DROP_ZONES,
  SUPER_CRATE_CHANCE,
} from './constants';
import { dist2 } from './geometry';
import { isCrateGroundPoint, onPadCell } from './map';
import { nextRandom } from './rng';
import type { Crate, CrateId, MatchState, Unit, UnitId, Vec2 } from './types';

const RESOLVE_STEP = 0.1;
const RESOLVE_MAX_RADIUS = 64;

/** Phase 9 (first half): land every falling crate whose landTick has arrived. */
export function updateCrateFalls(s: MatchState): void {
  for (const crate of s.crates) {
    if (crate.state === 'falling' && s.tick >= crate.landTick) {
      crate.state = 'ground';
      s.events.push({ tick: s.tick, kind: 'crateLand', crateId: crate.id });
    }
  }
}

/** Phase 9 (second half): scheduled drop-zone spawns, capped at MAX_GROUND_CRATES. */
export function spawnCrates(s: MatchState): void {
  if (s.tick % DROP_INTERVAL_CENTER_TICKS === 0) {
    trySpawnInZone(s, 'center', CENTER_DROP_ZONE);
  }
  if (s.tick % DROP_INTERVAL_SIDE_TICKS === 0) {
    const index = Math.floor(s.tick / DROP_INTERVAL_SIDE_TICKS) % SIDE_DROP_ZONES.length;
    const zone = SIDE_DROP_ZONES[index];
    if (zone) trySpawnInZone(s, zone.team, zone);
  }
}

function trySpawnInZone(
  s: MatchState,
  zoneName: string,
  zone: { x: number; y: number; r: number },
): void {
  let ground = 0;
  for (const crate of s.crates) if (crate.state === 'ground') ground++;
  if (ground >= MAX_GROUND_CRATES) return;
  const id = s.nextId++;
  const angle = nextRandom(s) * Math.PI * 2;
  const radius = Math.sqrt(nextRandom(s)) * zone.r;
  const pos = {
    x: zone.x + Math.cos(angle) * radius,
    y: zone.y + Math.sin(angle) * radius,
  };
  // Only centre drops roll quality, after the two position draws; the cap returned above.
  const kind = zoneName === 'center' && nextRandom(s) < SUPER_CRATE_CHANCE ? 'super' : 'normal';
  s.crates.push({ id, pos, kind, state: 'falling', landTick: s.tick + DROP_FALL_TICKS });
  s.events.push({ tick: s.tick, kind: 'crateSpawn', crateId: id, zone: zoneName });
}

/** Nearest ground crate within PICK_RADIUS of pos; ties break to the lower crate id. */
export function nearestPickableCrate(s: MatchState, pos: Vec2): Crate | null {
  let best: Crate | null = null;
  let bestD2 = PICK_RADIUS * PICK_RADIUS;
  for (const crate of s.crates) {
    if (crate.state !== 'ground') continue;
    const d2 = dist2(pos, crate.pos);
    if (d2 > bestD2) continue;
    if (d2 === bestD2 && best !== null && crate.id > best.id) continue;
    best = crate;
    bestD2 = d2;
  }
  return best;
}

/** Phase 4: empty-handed Pick/Drop — grab the nearest ground crate in reach. */
export function tryPick(s: MatchState, unit: Unit): void {
  const crate = nearestPickableCrate(s, unit.pos);
  if (crate === null) return;
  crate.state = 'carried';
  unit.carrying = crate.id;
  s.events.push({ tick: s.tick, kind: 'cratePick', crateId: crate.id, unitId: unit.id });
}

/**
 * Phase 4: Pick/Drop while carrying. Off a pad floor the crate drops at the unit's
 * feet; on a pad floor it means "place" — pad placement is Task 3, so it is a no-op here.
 */
export function tryDrop(s: MatchState, unit: Unit): void {
  if (unit.carrying === null) return;
  if (onPadCell(unit.pos)) return;
  dropCrateAt(s, unit.carrying, unit.pos, unit.id);
}

/**
 * Drop crate `crateId` so it rests at `pos` — or, when `pos` is not a free walkable
 * ground point (inside a stall/pad/obstacle rect or outside the arena), at the nearest
 * one. Pick/Drop uses it here; Task 4 (death drops) reuses it. Mutates the state
 * (callers pass a fresh `step` clone).
 */
export function dropCrateAt(
  s: MatchState,
  crateId: CrateId,
  pos: Vec2,
  unitId: UnitId | null = null,
): void {
  const crate = s.crates.find((c) => c.id === crateId);
  if (!crate) throw new Error(`dropCrateAt: unknown crate ${crateId}`);
  crate.pos = isCrateGroundPoint(pos) ? { x: pos.x, y: pos.y } : nearestGroundPoint(pos);
  crate.state = 'ground';
  for (const unit of s.units) {
    if (unit.carrying === crateId) unit.carrying = null;
  }
  s.events.push({ tick: s.tick, kind: 'crateDrop', crateId, unitId });
}

/**
 * Nearest `isCrateGroundPoint` to pos: expanding square rings on a 0.1 grid, ties
 * broken by (distance, x, y). Deterministic; the arena always has open ground nearby.
 */
function nearestGroundPoint(pos: Vec2): Vec2 {
  for (let ring = 1; ring * RESOLVE_STEP <= RESOLVE_MAX_RADIUS; ring++) {
    let best: Vec2 | null = null;
    let bestD2 = Infinity;
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const candidate = { x: pos.x + i * RESOLVE_STEP, y: pos.y + j * RESOLVE_STEP };
        if (!isCrateGroundPoint(candidate)) continue;
        const d2 = (i * i + j * j) * RESOLVE_STEP * RESOLVE_STEP;
        const winsTie =
          d2 === bestD2 &&
          best !== null &&
          (candidate.x < best.x || (candidate.x === best.x && candidate.y < best.y));
        if (d2 < bestD2 || winsTie) {
          best = candidate;
          bestD2 = d2;
        }
      }
    }
    if (best !== null) return best;
  }
  throw new Error('nearestGroundPoint: no walkable ground point found');
}
