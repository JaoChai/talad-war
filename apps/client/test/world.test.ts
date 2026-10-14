import { describe, expect, it } from 'vitest';
import { clampDrawY, MIN_UNIT_DRAW_Y, padCellOffset, padCenterOffset } from '../src/render/world';

/**
 * Review round 1 guards:
 * - #2 top-edge crop: a unit at the world's minimum y (UNIT_RADIUS) must draw
 *   with its whole sprite on-canvas.
 * - #3 pad/art alignment: the view's pad-cell math must mirror sim pad.ts
 *   (col = cellY * PAD_FLOOR + cellX) and center props on the true 3x3 pad.
 */
describe('world mapping guards (review round 1)', () => {
  it('clamps the unit draw position so a min-y unit keeps its head on-canvas', () => {
    // world y = UNIT_RADIUS (0.45) maps to 13.5 px at 30 px/unit
    expect(clampDrawY(0.45 * 30)).toBe(MIN_UNIT_DRAW_Y);
    expect(clampDrawY(MIN_UNIT_DRAW_Y)).toBe(MIN_UNIT_DRAW_Y);
    expect(clampDrawY(500)).toBe(500);
  });

  it('maps pad columns to cells exactly like sim pad.ts (col = cellY*2 + cellX)', () => {
    expect(padCellOffset(0)).toEqual({ x: 0.75, y: 0.75 });
    expect(padCellOffset(1)).toEqual({ x: 2.25, y: 0.75 });
    expect(padCellOffset(2)).toEqual({ x: 0.75, y: 2.25 });
    expect(padCellOffset(3)).toEqual({ x: 2.25, y: 2.25 });
  });

  it('centers the pad sprite on the true 3x3 pad, not its corner', () => {
    expect(padCenterOffset()).toEqual({ x: 1.5, y: 1.5 });
  });
});
