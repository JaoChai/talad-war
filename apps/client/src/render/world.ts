import { ARENA_H, ARENA_W } from '@talad/sim';
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
