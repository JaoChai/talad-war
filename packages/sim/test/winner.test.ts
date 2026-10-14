import { describe, expect, it } from 'vitest';
import { createMatch, GUN_DMG, step } from '../src/index';
import type { MatchState, UnitId, UnitInput, Vec2 } from '../src/index';

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

function banishTeam(s: MatchState, team: 'fruit' | 'dessert', pos: Vec2): void {
  for (const unit of s.units) if (unit.team === team) unit.pos = { ...pos };
}

function inputsFor(
  s: MatchState,
  patches: [UnitId, Partial<UnitInput>][] = [],
): Map<UnitId, UnitInput> {
  const map = new Map<UnitId, UnitInput>();
  for (const unit of s.units) {
    map.set(unit.id, {
      move: { x: 0, y: 0 },
      aim: null,
      fire: false,
      throwBomb: false,
      pickDrop: false,
      open: false,
    });
  }
  for (const [id, extra] of patches) {
    map.set(id, { ...(must(map.get(id)) as UnitInput), ...extra });
  }
  return map;
}

/** One armed attacker beside the enemy stall, one bullet of stall HP left. */
function stallAtOneHp(attacker: UnitId): MatchState {
  const s = createMatch(1);
  if (attacker < 3) {
    banishTeam(s, 'dessert', { x: 25, y: 1 }); // out of GUN_RANGE so the stall is targeted
    unitAt(s, attacker, { x: 35, y: 7 }); // 1.0 from the dessert stall rect
    s.stalls.dessert.hp = GUN_DMG;
  } else {
    banishTeam(s, 'fruit', { x: 15, y: 6 });
    unitAt(s, attacker, { x: 5, y: 17 }); // 1.0 from the fruit stall rect
    s.stalls.fruit.hp = GUN_DMG;
  }
  arm(s, attacker);
  return s;
}

describe('winner', () => {
  it('destroying the dessert stall ends the match for fruit', () => {
    const s = stallAtOneHp(0);
    const fired = step(s, inputsFor(s, [[0, { fire: true }]])); // bullet spawns
    const travel = step(fired, new Map()); // 0.9 units closer, not yet inside
    expect(travel.winner).toBeNull();
    const final = step(travel, new Map()); // enters the stall rect: one hit kills
    expect(final.stalls.dessert.hp).toBe(0); // clamped, never negative
    expect(final.winner).toBe('fruit');
    expect(final.events).toContainEqual(
      expect.objectContaining({ kind: 'matchOver', winner: 'fruit' }),
    );
  });

  it('destroying the fruit stall ends the match for dessert', () => {
    const s = stallAtOneHp(3);
    let cur = step(s, inputsFor(s, [[3, { fire: true }]]));
    cur = step(cur, new Map());
    cur = step(cur, new Map());
    expect(cur.stalls.fruit.hp).toBe(0);
    expect(cur.winner).toBe('dessert');
    expect(cur.events).toContainEqual(
      expect.objectContaining({ kind: 'matchOver', winner: 'dessert' }),
    );
  });

  it('after matchOver, 100 more steps change nothing but tick', () => {
    let s = stallAtOneHp(0);
    s = step(s, inputsFor(s, [[0, { fire: true }]]));
    s = step(s, new Map());
    s = step(s, new Map());
    expect(s.winner).toBe('fruit');
    const snapshot = structuredClone(s);
    let extraEvents = 0;
    for (let i = 0; i < 100; i++) {
      s = step(s, new Map());
      if (s.events.length > 0) extraEvents++;
    }
    expect(s.tick).toBe(snapshot.tick + 100);
    expect(extraEvents).toBe(0);
    const strip = (st: MatchState): MatchState => {
      const clone = structuredClone(st);
      clone.tick = 0;
      clone.events = [];
      return clone;
    };
    expect(strip(s)).toEqual(strip(snapshot)); // no movement, spawns or damage after the end
  });
});
