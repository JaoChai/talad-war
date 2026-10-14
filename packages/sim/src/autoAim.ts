import { GUN_RANGE, SLAP_RANGE } from './constants';
import { dist2 } from './geometry';
import type { Rect } from './geometry';
import { stallCenter, stallRect } from './map';
import { unitDead } from './open';
import type { MatchState, Team, UnitId, Vec2 } from './types';

/** Nearest point of `rect` to `p` (a point of the rect itself when p is inside). */
function nearestRectPoint(p: Vec2, rect: Rect): Vec2 {
  return {
    x: Math.min(Math.max(p.x, rect.minX), rect.maxX),
    y: Math.min(Math.max(p.y, rect.minY), rect.maxY),
  };
}

function otherTeam(team: Team): Team {
  return team === 'fruit' ? 'dessert' : 'fruit';
}

/**
 * Where a fire input should point when the player gave no explicit aim: the
 * nearest living enemy unit, else the enemy stall centre — within GUN_RANGE
 * when the unit is armed, SLAP_RANGE when not. Ties break to the lower enemy
 * id. Returns null when the unit is dead or nothing is in range. Exported
 * because the client draws the target marker from it.
 */
export function autoAimTarget(s: MatchState, unitId: UnitId): Vec2 | null {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined || unitDead(unit)) return null;
  const range = unit.gun !== null ? GUN_RANGE : SLAP_RANGE;
  let bestD2 = range * range;
  let best: Vec2 | null = null;

  // Units ascend by id, so `d2 === bestD2` on a later unit means a tie the
  // lower id already won.
  for (const enemy of s.units) {
    if (enemy.team === unit.team || unitDead(enemy)) continue;
    const d2 = dist2(unit.pos, enemy.pos);
    if (d2 > bestD2) continue;
    if (d2 === bestD2 && best !== null) continue;
    best = { ...enemy.pos };
    bestD2 = d2;
  }

  // The stall is a fallback only: it is aimed at when no living enemy unit is
  // in range (contract: "nearest living enemy unit, ELSE the enemy stall").
  if (best === null) {
    const stall = stallRect(otherTeam(unit.team));
    if (dist2(unit.pos, nearestRectPoint(unit.pos, stall)) <= bestD2) {
      best = stallCenter(otherTeam(unit.team));
    }
  }
  return best === null ? null : { ...best };
}
