import { describe, expect, it } from 'vitest';
import { autoAimTarget, createMatch, GUN_RANGE, SLAP_RANGE, stallCenter } from '../src/index';
import type { MatchState, Vec2 } from '../src/index';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function unitAt(s: MatchState, id: number, pos: Vec2): void {
  must(s.units.find((u) => u.id === id)).pos = { ...pos };
}

function arm(s: MatchState, id: number): void {
  must(s.units.find((u) => u.id === id)).gun = { ammoCooldownTicks: 0 };
}

/** Direct state surgery (pad.test.ts convention): mark a unit dead. */
function kill(s: MatchState, id: number): void {
  const unit = must(s.units.find((u) => u.id === id));
  unit.hp = 0;
  unit.deadUntilTick = s.tick + 100;
}

/** Park every dessert unit far from the probe point so range checks are unambiguous. */
function banishDessert(s: MatchState): void {
  for (const unit of s.units) if (unit.team === 'dessert') unit.pos = { x: 25, y: 1 };
}

describe('autoAimTarget', () => {
  it('returns the nearest living enemy unit within SLAP_RANGE when unarmed', () => {
    const s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 3, { x: 13, y: 12 }); // 1.0 away
    unitAt(s, 4, { x: 11.5, y: 12 }); // 0.5 away — nearest
    expect(autoAimTarget(s, 0)).toEqual<Vec2 | null>({ x: 11.5, y: 12 });
  });

  it('breaks distance ties by the lower enemy id', () => {
    const s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 4, { x: 13, y: 12 }); // same distance as unit 3
    unitAt(s, 3, { x: 11, y: 12 });
    expect(autoAimTarget(s, 0)).toEqual<Vec2 | null>({ x: 11, y: 12 });
  });

  it('falls back to the enemy stall centre when no unit is in range', () => {
    const s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 35, y: 7 }); // 1.0 from the dessert stall rect, inside SLAP_RANGE
    expect(autoAimTarget(s, 0)).toEqual<Vec2 | null>(stallCenter('dessert'));
  });

  it('uses GUN_RANGE, not SLAP_RANGE, when the unit is armed', () => {
    const s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 3, { x: 17, y: 12 }); // 5 away: beyond slap, inside gun range
    expect(autoAimTarget(s, 0)).toBeNull();
    arm(s, 0);
    expect(autoAimTarget(s, 0)).toEqual<Vec2 | null>({ x: 17, y: 12 });
  });

  it('respects the exact range boundary when armed', () => {
    const s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    arm(s, 0);
    unitAt(s, 3, { x: 12 + GUN_RANGE, y: 12 }); // exactly GUN_RANGE: in
    expect(autoAimTarget(s, 0)).toEqual<Vec2 | null>({ x: 12 + GUN_RANGE, y: 12 });
    unitAt(s, 3, { x: 12 + GUN_RANGE + 0.1, y: 12 }); // just outside: null
    expect(autoAimTarget(s, 0)).toBeNull();
  });

  it('ignores dead enemies, and a dead unit cannot auto-aim', () => {
    const s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 3, { x: 13, y: 12 }); // dead, would otherwise be nearest
    kill(s, 3);
    unitAt(s, 4, { x: 13.8, y: 12 }); // alive, 1.8 away: inside gun range, outside slap
    expect(autoAimTarget(s, 0)).toBeNull(); // unarmed: the living unit is too far
    arm(s, 0);
    expect(autoAimTarget(s, 0)).toEqual<Vec2 | null>({ x: 13.8, y: 12 }); // skips the corpse
    expect(SLAP_RANGE).toBe(1.2); // the boundary the assertions above rely on
    kill(s, 0);
    expect(autoAimTarget(s, 0)).toBeNull(); // the dead do not aim
  });
});
