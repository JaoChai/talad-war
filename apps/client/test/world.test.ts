import { describe, expect, it } from 'vitest';
import { PAD_CELL_SIZE, PAD_FLOOR } from '@talad/sim';
import {
  MIN_UNIT_DRAW_Y,
  ON_PAD_CRATE_WIDTH,
  ON_PAD_STACK_OFFSET,
  STAGE_SCALE,
  clampDrawY,
  padCellOffset,
  padCenterOffset,
  padPaintedCellStageOffset,
  padPaintedCellStagePos,
} from '../src/render/world';

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

  it('sizes the on-pad crate from the pad cell (0.9x cell), per the R2b mockup', () => {
    // The owner mockup fixed the on-pad crate at ~0.9 of a pad cell so it
    // visually matches the enlarged ground crates instead of the stale 34 px.
    expect(ON_PAD_CRATE_WIDTH).toBe(Math.round(0.9 * PAD_CELL_SIZE * STAGE_SCALE));
    // R2b values: 0.9 * 2.2 * 30 = 59.4 -> 59 px, vs ground crate 66 px.
    expect(ON_PAD_CRATE_WIDTH).toBe(59);
  });

  it('scales the layer-1 stack offset with the on-pad crate width (22 px at 34 px)', () => {
    expect(ON_PAD_STACK_OFFSET).toBe(Math.round(ON_PAD_CRATE_WIDTH * (22 / 34)));
    // R2b values: round(59 * 22 / 34) = 38 px, up from the stale 22 px.
    expect(ON_PAD_STACK_OFFSET).toBe(38);
  });

  it('places on-pad crates at the painted cell centres of the pad art (R2b round 2)', () => {
    // Lead finding 22:11: the world-rect cell span (±33 px in y) put the back
    // row ABOVE the painted art, because sizeProp draws the 370x220 pad at
    // 132x78.5 with the origin anchor at 35% height. The painted 2x2 floor is
    // an iso diamond; tile centroids measured once on prop_pad_fruit.webp /
    // prop_pad_dessert.webp (the two arts agree within ~2 art px, worst team
    // deviation <= 1 stage px) give these stage offsets from the pad centre:
    expect(padPaintedCellStageOffset(0)).toEqual({ x: 2, y: -12 }); // back tile
    expect(padPaintedCellStageOffset(1)).toEqual({ x: 26, y: 1 }); // right tile
    expect(padPaintedCellStageOffset(2)).toEqual({ x: -27, y: -1 }); // left tile
    expect(padPaintedCellStageOffset(3)).toEqual({ x: -3, y: 12 }); // front tile
    // Absolute positions: fruit pad origin (8,18) -> centre (10.2,20.2) ->
    // worldToStage = (40 + 10.2*30, 20.2*30) = (346,606).
    expect(padPaintedCellStagePos({ x: 8, y: 18 }, 0)).toEqual({ x: 348, y: 594 });
    expect(padPaintedCellStagePos({ x: 8, y: 18 }, 3)).toEqual({ x: 343, y: 618 });
    // Dessert pad origin (27.6,1.6) -> centre (29.8,3.8) -> (934,114).
    expect(padPaintedCellStagePos({ x: 27.6, y: 1.6 }, 1)).toEqual({ x: 960, y: 115 });
  });
});
