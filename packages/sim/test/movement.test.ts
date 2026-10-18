import { describe, expect, it } from 'vitest';
import {
  ARENA_H,
  ARENA_W,
  CENTER_DROP_ZONE,
  CARRY_SPEED,
  OBSTACLES,
  SIDE_DROP_ZONES,
  UNIT_RADIUS,
  UNIT_SPEED,
  createMatch,
  padRect,
  stallRect,
  step,
} from '../src/index';
import type { MatchState, Rect, UnitInput, Vec2 } from '../src/index';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function inp(over: Partial<UnitInput> = {}): UnitInput {
  return {
    move: { x: 0, y: 0 },
    aim: null,
    fire: false,
    throwBomb: false,
    pickDrop: false,
    open: false,
    ...over,
  };
}

function runTicks(s: MatchState, input: UnitInput, ticks: number, unitId = 0): MatchState {
  for (let i = 0; i < ticks; i++) s = step(s, new Map([[unitId, input]]));
  return s;
}

function insideExpanded(p: Vec2, r: Rect, radius: number): boolean {
  return (
    p.x > r.minX - radius && p.x < r.maxX + radius && p.y > r.minY - radius && p.y < r.maxY + radius
  );
}

describe('movement', () => {
  it('moving {1,0} for 20 ticks covers exactly UNIT_SPEED units (+-1e-9)', () => {
    let s = createMatch(42);
    const start = must(s.units[0]).pos;
    s = runTicks(s, inp({ move: { x: 1, y: 0 } }), 20);
    const end = must(s.units[0]).pos;
    expect(end.x - start.x).toBeCloseTo(UNIT_SPEED, 9);
    expect(Math.abs(end.y - start.y)).toBeLessThan(1e-9);
  });

  it('moving while carrying covers CARRY_SPEED units over 20 ticks (+-1e-9)', () => {
    let s = createMatch(7);
    const unit = must(s.units[0]);
    unit.carrying = 1;
    s.crates.push({ id: 1, pos: { ...unit.pos }, state: 'carried', landTick: 0 });
    const start = unit.pos;
    s = runTicks(s, inp({ move: { x: 1, y: 0 } }), 20);
    const end = must(s.units[0]).pos;
    expect(end.x - start.x).toBeCloseTo(CARRY_SPEED, 9);
  });

  it('cannot pass an obstacle rect', () => {
    let s = createMatch(1);
    const start = must(s.units[0]).pos;
    const rect = must(
      OBSTACLES.find((r) => start.x >= r.minX && start.x <= r.maxX && r.maxY < start.y),
    );
    const seen: Vec2[] = [];
    for (let i = 0; i < 20; i++) {
      s = step(s, new Map([[0, inp({ move: { x: 0, y: -1 } })]]));
      seen.push({ ...must(s.units[0]).pos });
    }
    const end = must(s.units[0]).pos;
    expect(seen.every((p) => !insideExpanded(p, rect, UNIT_RADIUS))).toBe(true);
    expect(end.y).toBeGreaterThan(rect.maxY); // stopped in front of it
    expect(end.y).toBeLessThan(start.y); // but it did move
  });

  it('cannot pass a stall rect', () => {
    let s = createMatch(1);
    const start = must(s.units[0]).pos;
    const rect = stallRect('fruit');
    const seen: Vec2[] = [];
    for (let i = 0; i < 20; i++) {
      s = step(s, new Map([[0, inp({ move: { x: 0, y: 1 } })]]));
      seen.push({ ...must(s.units[0]).pos });
    }
    const end = must(s.units[0]).pos;
    expect(seen.every((p) => !insideExpanded(p, rect, UNIT_RADIUS))).toBe(true);
    expect(end.y).toBeLessThan(rect.minY); // never entered the stall
    expect(end.y).toBeGreaterThan(start.y); // but it did move
  });

  it('never leaves the arena, in any direction', () => {
    let s = createMatch(1);
    s = runTicks(s, inp({ move: { x: -1, y: 0 } }), 20);
    expect(must(s.units[0]).pos.x).toBeCloseTo(UNIT_RADIUS, 9);

    const dirs: Vec2[] = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
      { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
      { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
    ];
    for (const dir of dirs) {
      let m = createMatch(2);
      m = runTicks(m, inp({ move: dir }), 60);
      for (const u of m.units) {
        expect(u.pos.x).toBeGreaterThanOrEqual(UNIT_RADIUS);
        expect(u.pos.x).toBeLessThanOrEqual(ARENA_W - UNIT_RADIUS);
        expect(u.pos.y).toBeGreaterThanOrEqual(UNIT_RADIUS);
        expect(u.pos.y).toBeLessThanOrEqual(ARENA_H - UNIT_RADIUS);
      }
    }
  });
});

describe('map symmetry (180 deg rotation about the arena center)', () => {
  const C = { x: ARENA_W / 2, y: ARENA_H / 2 };

  function rotatePoint(p: Vec2): Vec2 {
    return { x: 2 * C.x - p.x, y: 2 * C.y - p.y };
  }

  function rotateRect(r: Rect): Rect {
    return {
      minX: 2 * C.x - r.maxX,
      minY: 2 * C.y - r.maxY,
      maxX: 2 * C.x - r.minX,
      maxY: 2 * C.y - r.minY,
    };
  }

  it('every obstacle rect equals the rotation of another obstacle rect', () => {
    expect(OBSTACLES.length).toBeGreaterThan(0);
    for (const r of OBSTACLES) {
      const rotated = rotateRect(r);
      expect(OBSTACLES.some((o) => JSON.stringify(o) === JSON.stringify(rotated))).toBe(true);
    }
  });

  it("stalls and pads are each other's rotation", () => {
    expect(rotateRect(stallRect('fruit'))).toEqual(stallRect('dessert'));
    // PAD_CELL_SIZE 2.2 makes the pad edges non-representable decimals, so exact
    // toEqual is float-impossible (24 - 22.4 !== 1.6 in IEEE doubles). The 180°
    // symmetry is still asserted per edge to 1e-10 world units — far below any
    // gameplay-relevant distance (UNIT_RADIUS is 0.45).
    const rotatedPad = rotateRect(padRect('fruit'));
    const dessertPad = padRect('dessert');
    expect(rotatedPad.minX).toBeCloseTo(dessertPad.minX, 10);
    expect(rotatedPad.minY).toBeCloseTo(dessertPad.minY, 10);
    expect(rotatedPad.maxX).toBeCloseTo(dessertPad.maxX, 10);
    expect(rotatedPad.maxY).toBeCloseTo(dessertPad.maxY, 10);
    expect(rotatePoint(must(stallRect('fruit') && { x: 5, y: 20 }))).toEqual({ x: 35, y: 4 });
  });

  it("drop zones are each other's rotation and the center zone is the pivot", () => {
    expect(SIDE_DROP_ZONES.length).toBe(2);
    const a = must(SIDE_DROP_ZONES[0]);
    const b = must(SIDE_DROP_ZONES[1]);
    expect({ x: a.x, y: a.y }).toEqual({ x: 12, y: 16 });
    expect({ x: b.x, y: b.y }).toEqual({ x: 28, y: 8 });
    expect(rotatePoint({ x: a.x, y: a.y })).toEqual({ x: b.x, y: b.y });
    expect({ x: CENTER_DROP_ZONE.x, y: CENTER_DROP_ZONE.y }).toEqual({ x: 20, y: 12 });
    expect(rotatePoint({ x: CENTER_DROP_ZONE.x, y: CENTER_DROP_ZONE.y })).toEqual({
      x: CENTER_DROP_ZONE.x,
      y: CENTER_DROP_ZONE.y,
    });
  });
});
