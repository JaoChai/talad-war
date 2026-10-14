import { describe, expect, it } from 'vitest';
import { SLAP_DMG, createMatch, step } from '../src/index';
import type { MatchState, UnitId, UnitInput } from '../src/index';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function inputsFor(s: MatchState, fireIds: UnitId[]): Map<UnitId, UnitInput> {
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
  for (const id of fireIds) {
    map.set(id, { ...(must(map.get(id)) as UnitInput), fire: true });
  }
  return map;
}

/**
 * Q10 draw setup: one controllable unit per team beside the ENEMY stall, both
 * stalls one slap from destruction, every other unit banished to the arena
 * center (far from both stalls and from the two attackers). Both fire on the
 * same tick: both stalls reach 0 HP in one step.
 */
function bothStallsAtSlapHp(): MatchState {
  const s = createMatch(1); // human unit 0 (fruit); unit 3 made human below
  must(s.units.find((u) => u.id === 3)).isBot = false; // controllable dessert unit
  for (const unit of s.units) {
    if (unit.id !== 0 && unit.id !== 3) unit.pos = { x: 20, y: 12 };
  }
  must(s.units.find((u) => u.id === 0)).pos = { x: 35, y: 7 }; // beside the dessert stall
  must(s.units.find((u) => u.id === 3)).pos = { x: 5, y: 17 }; // beside the fruit stall
  s.stalls.fruit.hp = SLAP_DMG;
  s.stalls.dessert.hp = SLAP_DMG;
  return s;
}

describe('draw (Q10: mutual stall destruction)', () => {
  it('both stalls reaching 0 HP on the same tick gives winner "draw" and a matchOver event', () => {
    const s = bothStallsAtSlapHp();
    const final = step(s, inputsFor(s, [0, 3])); // both slaps land in this one tick
    expect(final.stalls.fruit.hp).toBe(0);
    expect(final.stalls.dessert.hp).toBe(0);
    expect(final.winner).toBe('draw');
    expect(final.events).toContainEqual(
      expect.objectContaining({ kind: 'matchOver', winner: 'draw' }),
    );
  });

  it('after a draw, 100 more steps change nothing but tick', () => {
    let s = bothStallsAtSlapHp();
    s = step(s, inputsFor(s, [0, 3]));
    expect(s.winner).toBe('draw');
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
    expect(strip(s)).toEqual(strip(snapshot)); // frozen exactly like a won match
  });
});
