import { describe, expect, it } from 'vitest';
import { PAD_CELL_SIZE, PAD_FLOOR } from '@talad/sim';
import {
  GROUND_CRATE_WIDTH,
  MIN_UNIT_DRAW_Y,
  ON_PAD_CRATE_WIDTH,
  ON_PAD_STACK_OFFSET,
  PAD_ART_SCALE,
  STAGE_SCALE,
  clampDrawY,
  padArtStageWidth,
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

  it('sizes the on-pad crate exactly at the ground-crate width (R2d owner note)', () => {
    // R2d owner playtest ("ลังบนแท่นเล็กกว่าลังพื้นตอนผสม"): on-pad crates draw
    // at the SAME width as ground crates, derived from ONE shared constant in
    // render/world.ts — the card forbids duplicating the 66 px literal.
    expect(GROUND_CRATE_WIDTH).toBe(2.2 * STAGE_SCALE);
    expect(ON_PAD_CRATE_WIDTH).toBe(Math.round(GROUND_CRATE_WIDTH));
    expect(ON_PAD_CRATE_WIDTH).toBe(66);
  });

  it('scales the layer-1 stack offset with the on-pad crate width (22 px at 34 px)', () => {
    expect(ON_PAD_STACK_OFFSET).toBe(Math.round(ON_PAD_CRATE_WIDTH * (22 / 34)));
    // R2d values: round(66 * 22 / 34) = 43 px, up from R2b's 38 px at 59 px.
    expect(ON_PAD_STACK_OFFSET).toBe(43);
  });

  it('places on-pad crates at the painted cell centres of the pad art (R2b round 2)', () => {
    // Lead finding 22:11: the world-rect cell span (±33 px in y) put the back
    // row ABOVE the painted art, because sizeProp draws the 370x220 pad at
    // 132x78.5 with the origin anchor at 35% height. The painted 2x2 floor is
    // an iso diamond; tile centroids measured once on prop_pad_fruit.webp /
    // prop_pad_dessert.webp (the two arts agree within ~2 art px, worst team
    // deviation <= 1 stage px) give these stage offsets from the pad centre:
    // R2c pins: same centroids at the x1.3 art scale (PAD_ART_SCALE).
    expect(padPaintedCellStageOffset(0)).toEqual({ x: 2, y: -15 }); // back tile
    expect(padPaintedCellStageOffset(1)).toEqual({ x: 33, y: 1 }); // right tile
    expect(padPaintedCellStageOffset(2)).toEqual({ x: -35, y: -1 }); // left tile
    expect(padPaintedCellStageOffset(3)).toEqual({ x: -4, y: 16 }); // front tile
    // Absolute positions: fruit pad origin (8,18) -> centre (10.2,20.2) ->
    // worldToStage = (40 + 10.2*30, 20.2*30) = (346,606).
    expect(padPaintedCellStagePos({ x: 8, y: 18 }, 0)).toEqual({ x: 348, y: 591 });
    expect(padPaintedCellStagePos({ x: 8, y: 18 }, 3)).toEqual({ x: 342, y: 622 });
    // Dessert pad origin (27.6,1.6) -> centre (29.8,3.8) -> (934,114).
    expect(padPaintedCellStagePos({ x: 27.6, y: 1.6 }, 1)).toEqual({ x: 967, y: 115 });
  });
});

describe('R2c pad art scale (owner: "ปรับที่แท่นวางกล่องให้เท่ากับขนาดกล่อง")', () => {
  it('draws the pad art PAD_ART_SCALE x the world-rect span, tuned inside 1.2..1.35', () => {
    // Lead mock: pad art x1.3 makes each on-pad crate read as sitting on one
    // painted tile (7.5/10 vs 4/10 at x1.0); the card bounds the tuning.
    expect(PAD_ART_SCALE).toBeGreaterThanOrEqual(1.2);
    expect(PAD_ART_SCALE).toBeLessThanOrEqual(1.35);
    // R2c values: 2 * 2.2 * 30 * 1.3 = 171.6 px wide, up from 132.
    expect(padArtStageWidth()).toBeCloseTo(
      PAD_FLOOR * PAD_CELL_SIZE * STAGE_SCALE * PAD_ART_SCALE,
      6,
    );
    expect(padArtStageWidth()).toBeCloseTo(171.6, 3);
  });

  it('scales the painted-cell offsets with the art (x1.3 pins)', () => {
    // Same measured centroids as R2b, now multiplied by 171.6/370 art scale.
    expect(padPaintedCellStageOffset(0)).toEqual({ x: 2, y: -15 }); // back tile
    expect(padPaintedCellStageOffset(1)).toEqual({ x: 33, y: 1 }); // right tile
    expect(padPaintedCellStageOffset(2)).toEqual({ x: -35, y: -1 }); // left tile
    expect(padPaintedCellStageOffset(3)).toEqual({ x: -4, y: 16 }); // front tile
    expect(padPaintedCellStagePos({ x: 8, y: 18 }, 0)).toEqual({ x: 348, y: 591 });
    expect(padPaintedCellStagePos({ x: 8, y: 18 }, 3)).toEqual({ x: 342, y: 622 });
    expect(padPaintedCellStagePos({ x: 27.6, y: 1.6 }, 1)).toEqual({ x: 967, y: 115 });
  });
});
