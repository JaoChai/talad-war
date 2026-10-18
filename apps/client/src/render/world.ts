import { ARENA_H, ARENA_W, PAD_CELL_SIZE, PAD_FLOOR } from '@talad/sim';
import type { Vec2 } from '@talad/sim';

/** Logical 720p stage — must match the Phaser game config in main.ts. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** World units (arena 40x24) map to a centered strip of the 16:9 stage. */
export const STAGE_SCALE = STAGE_H / ARENA_H;
const OFFSET_X = (STAGE_W - ARENA_W * STAGE_SCALE) / 2;

export function worldToStage(p: Vec2): Vec2 {
  return { x: OFFSET_X + p.x * STAGE_SCALE, y: p.y * STAGE_SCALE };
}

export function stageToWorld(p: Vec2): Vec2 {
  return { x: (p.x - OFFSET_X) / STAGE_SCALE, y: p.y / STAGE_SCALE };
}

/**
 * Review round 1 #2: unit sprites are UNIT_DISPLAY_HEIGHT px tall with a
 * feet-anchored origin, so a unit at the world's minimum y would draw its head
 * above the canvas top. Clamp only the draw position (units in the top band
 * stand a touch lower on screen; the sim position is untouched).
 */
export const MIN_UNIT_DRAW_Y = 92;

export function clampDrawY(y: number): number {
  return Math.max(y, MIN_UNIT_DRAW_Y);
}

/**
 * Review round 1 #3: mirror sim pad.ts exactly — a pad is a 2x2 floor of
 * PAD_CELL_SIZE cells and column `col = cellY * PAD_FLOOR + cellX`; a placed
 * crate rests at the center of its cell. (The view previously used col%4 /
 * floor(col/4), which drew columns 2-3 off the pad.)
 */
export function padCellOffset(col: number): Vec2 {
  const cellX = col % PAD_FLOOR;
  const cellY = Math.floor(col / PAD_FLOOR);
  return { x: (cellX + 0.5) * PAD_CELL_SIZE, y: (cellY + 0.5) * PAD_CELL_SIZE };
}

/** World-space center of the 3x3 pad rect, relative to the pad origin. */
export function padCenterOffset(): Vec2 {
  const half = (PAD_FLOOR * PAD_CELL_SIZE) / 2;
  return { x: half, y: half };
}

/**
 * R2b: a crate resting on a pad fills ~90% of its pad cell (owner mockup for
 * the enlarged pad), so it reads at ground-crate scale instead of the stale
 * 34 px literal that A1's 66 px ground crates dwarfed.
 */
export const ON_PAD_CRATE_WIDTH = Math.round(0.9 * PAD_CELL_SIZE * STAGE_SCALE);

/**
 * R2b: layer-1 stack lift above the lower crate, keeping the shipped
 * 22 px-at-34 px ratio to the crate width so the stacked pair still overlaps
 * like one crate with a visible top step.
 */
export const ON_PAD_STACK_OFFSET = Math.round(ON_PAD_CRATE_WIDTH * (22 / 34));
