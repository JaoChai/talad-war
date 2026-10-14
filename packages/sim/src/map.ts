import {
  ARENA_H,
  ARENA_W,
  CRATE_MARGIN,
  PAD_CELL_SIZE,
  PAD_FLOOR,
  PAD_ORIGINS,
  STALL_RECTS,
  UNIT_RADIUS,
} from './constants';
import { circleOverlapsRect, pointInRect, rectCenter } from './geometry';
import type { Rect } from './geometry';
import type { Team, Vec2 } from './types';

/**
 * Market-stall obstacle rects, written in pairs so every rect is the exact 180°
 * rotation of another about the arena center (20,12) — keeps the map fair.
 */
export const OBSTACLES: Rect[] = [
  { minX: 4, minY: 9, maxX: 6, maxY: 12 },
  { minX: 34, minY: 12, maxX: 36, maxY: 15 },
  { minX: 14, minY: 4, maxX: 17, maxY: 6 },
  { minX: 23, minY: 18, maxX: 26, maxY: 20 },
  { minX: 18, minY: 3, maxX: 22, maxY: 4 },
  { minX: 18, minY: 20, maxX: 22, maxY: 21 },
];

export function stallRect(team: Team): Rect {
  return { ...STALL_RECTS[team] };
}

export function padRect(team: Team): Rect {
  const origin = PAD_ORIGINS[team];
  const size = PAD_FLOOR * PAD_CELL_SIZE;
  return { minX: origin.x, minY: origin.y, maxX: origin.x + size, maxY: origin.y + size };
}

export function stallCenter(team: Team): Vec2 {
  return rectCenter(STALL_RECTS[team]);
}

/**
 * Units may stand here: inside the arena (with a body-radius margin) and clear of
 * obstacle and stall rects. Pad floors ARE walkable — carriers stand on them (Task 3).
 */
export function isUnitWalkable(pos: Vec2, radius: number = UNIT_RADIUS): boolean {
  if (pos.x < radius || pos.x > ARENA_W - radius) return false;
  if (pos.y < radius || pos.y > ARENA_H - radius) return false;
  for (const rect of OBSTACLES) if (circleOverlapsRect(pos, radius, rect)) return false;
  for (const team of ['fruit', 'dessert'] as const) {
    if (circleOverlapsRect(pos, radius, STALL_RECTS[team])) return false;
  }
  return true;
}

/**
 * A resting crate may sit here: a point at least CRATE_MARGIN inside the arena and
 * outside every obstacle, stall and pad rect (stricter than unit walkability).
 */
export function isCrateGroundPoint(pos: Vec2): boolean {
  if (pos.x < CRATE_MARGIN || pos.x > ARENA_W - CRATE_MARGIN) return false;
  if (pos.y < CRATE_MARGIN || pos.y > ARENA_H - CRATE_MARGIN) return false;
  for (const rect of OBSTACLES) if (pointInRect(pos, rect)) return false;
  for (const team of ['fruit', 'dessert'] as const) {
    if (pointInRect(pos, STALL_RECTS[team])) return false;
    if (pointInRect(pos, padRect(team))) return false;
  }
  return true;
}

/** True when pos stands on a pad floor — Pick/Drop means "place" there from Task 3 on. */
export function onPadCell(pos: Vec2): boolean {
  for (const team of ['fruit', 'dessert'] as const) {
    if (pointInRect(pos, padRect(team))) return true;
  }
  return false;
}
