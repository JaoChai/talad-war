import { describe, expect, it } from 'vitest';
import {
  ARENA_H,
  ARENA_W,
  PAD_CELL_SIZE,
  PAD_FLOOR,
  PAD_ORIGINS,
  STALL_RECTS,
  UNIT_RADIUS,
} from '../src/constants';
import { OBSTACLES, padRect } from '../src/map';
import type { Rect } from '../src/geometry';

/**
 * R2b pad-enlargement pin (owner card t_f6b09e2f): PAD_CELL_SIZE 1.5 -> 2.2.
 * The fruit origin stays (8,18); the dessert pad must remain the exact 180°
 * rotation of the fruit pad about the arena centre (20,12), so its origin is
 * recomputed to (27.6,1.6) -> rect (27.6,1.6)-(32,6). Everything below pins
 * that geometry AND the invariants it must keep: inside the arena with a
 * unit-radius margin, clear of every stall/obstacle rect, and mirror-symmetric.
 */

const ARENA_CENTER = { x: ARENA_W / 2, y: ARENA_H / 2 };

function rotate180(r: Rect, c: { x: number; y: number }): Rect {
  return {
    minX: 2 * c.x - r.maxX,
    minY: 2 * c.y - r.maxY,
    maxX: 2 * c.x - r.minX,
    maxY: 2 * c.y - r.minY,
  };
}

function expectRectClose(actual: Rect, expected: Rect): void {
  expect(actual.minX).toBeCloseTo(expected.minX, 10);
  expect(actual.minY).toBeCloseTo(expected.minY, 10);
  expect(actual.maxX).toBeCloseTo(expected.maxX, 10);
  expect(actual.maxY).toBeCloseTo(expected.maxY, 10);
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

describe('pad geometry (R2b enlarged pads)', () => {
  it('uses the 2.2 cell size with the pinned origins', () => {
    expect(PAD_CELL_SIZE).toBe(2.2);
    expect(PAD_ORIGINS.fruit).toEqual({ x: 8, y: 18 });
    expect(PAD_ORIGINS.dessert).toEqual({ x: 27.6, y: 1.6 });
  });

  it('grows both pad rects to 4.4x4.4 world units at the pinned corners', () => {
    expectRectClose(padRect('fruit'), { minX: 8, minY: 18, maxX: 12.4, maxY: 22.4 });
    expectRectClose(padRect('dessert'), { minX: 27.6, minY: 1.6, maxX: 32, maxY: 6 });
    const size = PAD_FLOOR * PAD_CELL_SIZE;
    for (const team of ['fruit', 'dessert'] as const) {
      const r = padRect(team);
      expect(r.maxX - r.minX).toBeCloseTo(size, 10);
      expect(r.maxY - r.minY).toBeCloseTo(size, 10);
    }
  });

  it('keeps both pad rects inside the arena with a unit-radius margin', () => {
    for (const team of ['fruit', 'dessert'] as const) {
      const r = padRect(team);
      expect(r.minX).toBeGreaterThanOrEqual(UNIT_RADIUS);
      expect(r.minY).toBeGreaterThanOrEqual(UNIT_RADIUS);
      expect(r.maxX).toBeLessThanOrEqual(ARENA_W - UNIT_RADIUS);
      expect(r.maxY).toBeLessThanOrEqual(ARENA_H - UNIT_RADIUS);
    }
  });

  it('keeps both pad rects clear of every stall and obstacle rect', () => {
    for (const team of ['fruit', 'dessert'] as const) {
      const pad = padRect(team);
      for (const stall of Object.values(STALL_RECTS)) {
        expect(rectsOverlap(pad, stall), `${team} pad vs stall`).toBe(false);
      }
      for (const obstacle of OBSTACLES) {
        expect(rectsOverlap(pad, obstacle), `${team} pad vs obstacle`).toBe(false);
      }
    }
  });

  it('keeps the dessert pad the exact 180° rotation of the fruit pad about (20,12)', () => {
    expectRectClose(rotate180(padRect('fruit'), ARENA_CENTER), padRect('dessert'));
    expectRectClose(rotate180(padRect('dessert'), ARENA_CENTER), padRect('fruit'));
  });
});
