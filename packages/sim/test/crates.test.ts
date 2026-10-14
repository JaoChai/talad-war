import { describe, expect, it } from 'vitest';
import {
  ARENA_H,
  ARENA_W,
  CRATE_MARGIN,
  DROP_FALL_TICKS,
  OBSTACLES,
  PICK_RADIUS,
  createMatch,
  dropCrateAt,
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

function runEmpty(s: MatchState, ticks: number): MatchState {
  for (let i = 0; i < ticks; i++) s = step(s, new Map());
  return s;
}

/** First center-zone crate: spawns at tick 60, grounded at 60 + DROP_FALL_TICKS. */
function groundCrateMatch(): MatchState {
  return runEmpty(createMatch(9), 60 + DROP_FALL_TICKS);
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Independent re-check of the "free walkable ground point" invariant (Review Focus 2). */
function manuallyWalkableCratePoint(p: Vec2): boolean {
  const inRect = (r: Rect) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
  if (p.x < CRATE_MARGIN || p.x > ARENA_W - CRATE_MARGIN) return false;
  if (p.y < CRATE_MARGIN || p.y > ARENA_H - CRATE_MARGIN) return false;
  const blocked = [
    ...OBSTACLES,
    stallRect('fruit'),
    stallRect('dessert'),
    padRect('fruit'),
    padRect('dessert'),
  ];
  return !blocked.some(inRect);
}

describe('crate drops', () => {
  it('spawns falling at tick 60 with landTick = tick + DROP_FALL_TICKS, ground on that tick', () => {
    let s = runEmpty(createMatch(1), 60);
    expect(s.tick).toBe(60);
    expect(s.crates.length).toBe(1);
    const crate = must(s.crates[0]);
    expect(crate.state).toBe('falling');
    expect(crate.landTick).toBe(60 + DROP_FALL_TICKS);

    s = runEmpty(s, DROP_FALL_TICKS);
    expect(s.tick).toBe(60 + DROP_FALL_TICKS);
    expect(must(s.crates[0]).state).toBe('ground');
  });

  it('empty-handed pickDrop near a ground crate (within PICK_RADIUS) picks it up', () => {
    let s = groundCrateMatch();
    const crate = must(s.crates[0]);
    const unit = must(s.units[0]);
    unit.pos = { x: crate.pos.x + PICK_RADIUS - 0.4, y: crate.pos.y };
    s = step(s, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBe(crate.id);
    expect(must(s.crates[0]).state).toBe('carried');
  });

  it('pickDrop while carrying off-pad drops the crate at the feet', () => {
    let s = groundCrateMatch();
    const crate = must(s.crates[0]);
    const unit = must(s.units[0]);
    unit.pos = { x: crate.pos.x + 0.5, y: crate.pos.y };
    s = step(s, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBe(crate.id);

    const feet = { ...must(s.units[0]).pos };
    s = step(s, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBeNull();
    expect(must(s.crates[0]).state).toBe('ground');
    expect(must(s.crates[0]).pos).toEqual(feet);
  });

  it('two units pressing pickDrop on one crate in the same tick: lower unit id wins', () => {
    let s = groundCrateMatch();
    const crate = must(s.crates[0]);
    must(s.units[0]).pos = { x: crate.pos.x - 0.5, y: crate.pos.y };
    must(s.units[1]).pos = { x: crate.pos.x + 0.5, y: crate.pos.y };
    const inputs = new Map([
      [0, inp({ pickDrop: true })],
      [1, inp({ pickDrop: true })],
    ]);
    s = step(s, inputs);
    expect(must(s.units[0]).carrying).toBe(crate.id);
    expect(must(s.units[1]).carrying).toBeNull();
    expect(must(s.crates[0]).state).toBe('carried');
  });

  it('dropCrateAt inside the pad area lands just outside on walkable ground', () => {
    const s = groundCrateMatch();
    const crate = must(s.crates[0]);
    crate.state = 'carried';
    must(s.units[0]).carrying = crate.id;

    dropCrateAt(s, crate.id, { x: 9, y: 19 }); // fruit pad rect (8,18)-(11,21)
    expect(crate.state).toBe('ground');
    expect(manuallyWalkableCratePoint(crate.pos)).toBe(true);
    expect(dist(crate.pos, { x: 9, y: 19 })).toBeLessThan(1.3);
    expect(must(s.units[0]).carrying).toBeNull();
  });

  it('dropCrateAt on the stall lands outside the stall on walkable ground', () => {
    const s = groundCrateMatch();
    const crate = must(s.crates[0]);
    crate.state = 'carried';
    must(s.units[0]).carrying = crate.id;

    dropCrateAt(s, crate.id, { x: 5, y: 20 }); // fruit stall center
    expect(crate.state).toBe('ground');
    expect(manuallyWalkableCratePoint(crate.pos)).toBe(true);
    expect(dist(crate.pos, { x: 5, y: 20 })).toBeLessThan(2.3);
  });

  it('dropCrateAt at the arena corner lands inside the arena on walkable ground', () => {
    const s = groundCrateMatch();
    const crate = must(s.crates[0]);
    crate.state = 'carried';
    must(s.units[0]).carrying = crate.id;

    dropCrateAt(s, crate.id, { x: 0, y: 0 });
    expect(crate.state).toBe('ground');
    expect(crate.pos.x).toBeGreaterThanOrEqual(CRATE_MARGIN);
    expect(crate.pos.y).toBeGreaterThanOrEqual(CRATE_MARGIN);
    expect(manuallyWalkableCratePoint(crate.pos)).toBe(true);
    expect(dist(crate.pos, { x: 0, y: 0 })).toBeLessThan(0.5);
  });

  it('dropCrateAt on an already-walkable point drops exactly there', () => {
    const s = groundCrateMatch();
    const crate = must(s.crates[0]);
    crate.state = 'carried';
    must(s.units[0]).carrying = crate.id;

    dropCrateAt(s, crate.id, { x: 15, y: 15 });
    expect(crate.state).toBe('ground');
    expect(crate.pos).toEqual({ x: 15, y: 15 });
    expect(must(s.units[0]).carrying).toBeNull();
  });

  it('step returns a new state and leaves the previous state untouched', () => {
    const a = createMatch(3);
    const snapshot = structuredClone(a);
    const b = step(a, new Map());
    expect(b).not.toBe(a);
    expect(a).toEqual(snapshot);
  });
});
