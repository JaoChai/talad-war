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

/** World-space center of the PAD_FLOOR×PAD_FLOOR pad rect, relative to the origin. */
export function padCenterOffset(): Vec2 {
  const half = (PAD_FLOOR * PAD_CELL_SIZE) / 2;
  return { x: half, y: half };
}

/**
 * R2c (owner: "ปรับที่แท่นวางกล่องผสมให้เท่ากับขนาดกล่อง มันเล็กไป"): the pad
 * ART is drawn PAD_ART_SCALE x the world-rect span so each on-pad crate reads
 * as sitting on one painted tile. Lead mock measured x1.3 at 7.5/10 (vs 4/10
 * at x1.0, crates overhanging the painted tiles); the card bounds tuning to
 * 1.2..1.35. The sim pad rect (packages/sim) is untouched — art only.
 */
export const PAD_ART_SCALE = 1.3;

/** Stage-space width the pad art sprite is drawn at (world span x PAD_ART_SCALE). */
export function padArtStageWidth(): number {
  return PAD_FLOOR * PAD_CELL_SIZE * STAGE_SCALE * PAD_ART_SCALE;
}

/**
 * R2d (owner playtest "ลังบนแท่นเล็กกว่าลังพื้นตอนผสม"): ground crates draw at
 * 2.2 world units (66 stage px) — the single width constant shared by ground
 * crates in render/view.ts and, since R2d, on-pad crates too.
 */
export const GROUND_CRATE_WIDTH = 2.2 * STAGE_SCALE;

/**
 * R2d: a crate resting on a pad draws at the SAME stage width as a ground
 * crate so the pad stack reads at cargo scale; replaces R2b's 0.9x-cell 59 px.
 * Derived from GROUND_CRATE_WIDTH — never a duplicated literal.
 */
export const ON_PAD_CRATE_WIDTH = Math.round(GROUND_CRATE_WIDTH);

/**
 * R2b: layer-1 stack lift above the lower crate, keeping the shipped
 * 22 px-at-34 px ratio to the crate width so the stacked pair still overlaps
 * like one crate with a visible top step.
 */
export const ON_PAD_STACK_OFFSET = Math.round(ON_PAD_CRATE_WIDTH * (22 / 34));

/**
 * R2b round 2 (Lead finding 22:11): crates rest on the PAINTED cells of the
 * pad art, not on the world-rect cell span — sizeProp draws the ~370x220 art
 * at 132x78.5 with the origin anchor at 35% of the frame, so the world-rect
 * span (±33 px in y from the pad centre) put the back row above the art.
 *
 * The painted 2x2 floor is an iso diamond (tiles at N/E/S/W). Tile centroids
 * were measured once per art by connected-component analysis of the painted
 * pixels; fruit and dessert agree within ~2 art px, so one table serves both
 * teams (worst per-team deviation <= 1 stage px at scale 132/370):
 *   fruit  col0 (189.4,44.7) col1 (256.9,79.6) col2 (109.0,74.3) col3 (175.2,111.5)
 *   dessert col0 (191.7,44.2) col1 (257.4,79.7) col2 (110.2,75.5) col3 (175.9,111.1)
 */
const PAD_ART_TILE_CENTRES: Readonly<Vec2[]> = [
  { x: 190.6, y: 44.5 }, // col0 back tile
  { x: 257.2, y: 79.7 }, // col1 right tile
  { x: 109.6, y: 74.9 }, // col2 left tile
  { x: 175.6, y: 111.3 }, // col3 front tile
];

/** The pad sprite origin (0.5, 0.35) expressed in art pixels of the ~370x220 frame. */
const PAD_ART_ORIGIN_PX: Vec2 = { x: 185.3, y: 77.2 };

/** Stage-space offset from the pad centre to painted cell `col`'s centre. */
export function padPaintedCellStageOffset(col: number): Vec2 {
  const art = PAD_ART_TILE_CENTRES[col];
  if (!art) throw new Error(`pad col ${col} is outside the 2x2 painted floor`);
  const scale = padArtStageWidth() / 370;
  return {
    x: Math.round((art.x - PAD_ART_ORIGIN_PX.x) * scale),
    y: Math.round((art.y - PAD_ART_ORIGIN_PX.y) * scale),
  };
}

/** Absolute stage position of painted pad cell `col` for a pad at `padOrigin`. */
export function padPaintedCellStagePos(padOrigin: Vec2, col: number): Vec2 {
  const centre = worldToStage({
    x: padOrigin.x + padCenterOffset().x,
    y: padOrigin.y + padCenterOffset().y,
  });
  const off = padPaintedCellStageOffset(col);
  // Round the composed point: worldToStage introduces float noise (e.g. 3.8*30)
  // and the crate sprites sit on whole stage pixels in every pinned fixture.
  return { x: Math.round(centre.x + off.x), y: Math.round(centre.y + off.y) };
}
