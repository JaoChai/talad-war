import { describe, expect, it } from 'vitest';
import { PAD_CELL_SIZE, PAD_FLOOR } from '@talad/sim';
import { clampDrawY, MIN_UNIT_DRAW_Y, padCellOffset, padCenterOffset } from '../src/render/world';

/**
 * Review round 1 guards:
 * - #2 top-edge crop: a unit at the world's minimum y (UNIT_RADIUS) must draw
 *   with its whole sprite on-canvas.
 * - #3 pad/art alignment: the view's pad-cell math must mirror sim pad.ts
 *   (col = cellY * PAD_FLOOR + cellX) and center props on the true pad.
 * The R2b pad enlargement (PAD_CELL_SIZE 1.5 -> 2.2) made the old literal
 * fixtures stale; the expectations are derived from the sim constants now so
 * the mapping contract survives geometry changes.
 */
describe('world mapping guards (review round 1)', () => {
  it('clamps the unit draw position so a min-y unit keeps its head on-canvas', () => {
    // world y = UNIT_RADIUS (0.45) maps to 13.5 px at 30 px/unit
    expect(clampDrawY(0.45 * 30)).toBe(MIN_UNIT_DRAW_Y);
    expect(clampDrawY(MIN_UNIT_DRAW_Y)).toBe(MIN_UNIT_DRAW_Y);
    expect(clampDrawY(500)).toBe(500);
  });

  it('maps pad columns to cells exactly like sim pad.ts (col = cellY*PAD_FLOOR + cellX)', () => {
    const cell = (cellX: number, cellY: number) => ({
      x: (cellX + 0.5) * PAD_CELL_SIZE,
      y: (cellY + 0.5) * PAD_CELL_SIZE,
    });
    expect(padCellOffset(0)).toEqual(cell(0, 0));
    expect(padCellOffset(1)).toEqual(cell(1, 0));
    expect(padCellOffset(2)).toEqual(cell(0, 1));
    expect(padCellOffset(3)).toEqual(cell(1, 1));
    // R2b values: 2x2 grid of 2.2-unit cells -> first cell center at 1.1.
    expect(padCellOffset(0)).toEqual({ x: 1.1, y: 1.1 });
  });

  it('centers the pad sprite on the true pad, not its corner', () => {
    expect(padCenterOffset()).toEqual({
      x: (PAD_FLOOR * PAD_CELL_SIZE) / 2,
      y: (PAD_FLOOR * PAD_CELL_SIZE) / 2,
    });
    // R2b values: 2 * 2.2 / 2 = 2.2.
    expect(padCenterOffset()).toEqual({ x: 2.2, y: 2.2 });
  });
});
