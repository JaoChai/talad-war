import { createMatch, step, type MatchState } from '@talad/sim';
import { describe, expect, it } from 'vitest';
import { emptyStats, tallyStats } from '../src/stats';

// Catches wrong attribution, off-pad/unit damage, mutation and last-tick-only tallying.
function sequence(): MatchState[] {
  const initial = createMatch(7);
  const a = structuredClone(initial);
  a.tick = 1;
  a.pads.fruit.cells[0]![0] = 100;
  a.pads.dessert.cells[1]![0] = 101;
  a.events = [
    { tick: 1, kind: 'opened', team: 'fruit', recipe: 'gun' },
    { tick: 1, kind: 'hit', target: 'dessert', dmg: 12 },
    { tick: 1, kind: 'hit', target: 0, dmg: 90 },
    { tick: 1, kind: 'crateDrop', unitId: 0, crateId: 999 },
  ];
  const b = structuredClone(a);
  b.tick = 2;
  b.events = [
    { tick: 2, kind: 'opened', team: 'dessert', recipe: 'bombs' },
    { tick: 2, kind: 'hit', target: 'fruit', dmg: 8 },
    { tick: 2, kind: 'crateDrop', unitId: 0, crateId: 999 },
  ];
  const c = structuredClone(b);
  c.tick = 3;
  c.pads.fruit.cells[2]![1] = 102;
  c.events = [
    { tick: 3, kind: 'opened', team: 'fruit', recipe: 'buddy' },
    { tick: 3, kind: 'hit', target: 'dessert', dmg: 5 },
  ];
  return [initial, a, b, c];
}

describe('tallyStats', () => {
  it('counts opened, stall damage and pad additions across three ticks without mutation', () => {
    const states = sequence();
    let stats = emptyStats();
    const initialStats = stats;
    const original = structuredClone(stats);
    const originalStates = structuredClone(states);
    for (let i = 1; i < states.length; i++) stats = tallyStats(stats, states[i - 1]!, states[i]!);
    expect(stats.fruit).toEqual({ cratesPlaced: 2, itemsBuilt: 2, stallDamage: 17 });
    expect(stats.dessert).toEqual({ cratesPlaced: 1, itemsBuilt: 1, stallDamage: 8 });
    expect(initialStats).toEqual(original);
    expect(states).toEqual(originalStates);
  });

  it('counts a lifted crate placed again but never subtracts consumed crates', () => {
    const [initial, a] = sequence();
    let stats = tallyStats(emptyStats(), initial!, a!);
    const lifted = structuredClone(a!);
    lifted.tick = 2;
    lifted.events = [];
    lifted.pads.fruit.cells[0]![0] = null;
    lifted.pads.dessert.cells[1]![0] = null;
    stats = tallyStats(stats, a!, lifted);
    const replaced = structuredClone(lifted);
    replaced.tick = 3;
    replaced.pads.fruit.cells[2]![0] = 100;
    stats = tallyStats(stats, lifted, replaced);
    expect(stats.fruit.cratesPlaced).toBe(2);
    expect(stats.dessert.cratesPlaced).toBe(1);
  });

  it('ignores repeated or frozen ticks and stale events', () => {
    const [initial, a] = sequence();
    const stats = tallyStats(emptyStats(), initial!, a!);
    expect(tallyStats(stats, a!, a!)).toEqual(stats);
    const stale = structuredClone(a!);
    stale.tick = 2;
    expect(tallyStats(stats, a!, stale)).toEqual({ ...stats, lastTick: 2 });
  });

  it('counts every real stepped tick once even when many ticks share a frame', () => {
    let state = createMatch(7);
    let stats = emptyStats();
    let opened = 0;
    let drops = 0;
    let damage = 0;
    for (let i = 0; i < 1600; i++) {
      const prev = state;
      state = step(state, new Map());
      stats = tallyStats(stats, prev, state);
      for (const e of state.events) {
        if (e.kind === 'opened') opened++;
        if (e.kind === 'hit' && typeof e.target === 'string') damage += Number(e.dmg);
      }
      for (const team of ['fruit', 'dessert'] as const) {
        const old = prev.pads[team].cells.flat();
        drops += state.pads[team].cells
          .flat()
          .filter((id) => id !== null && !old.includes(id)).length;
      }
    }
    expect(opened).toBeGreaterThan(0);
    expect(drops).toBeGreaterThan(0);
    expect(damage).toBeGreaterThan(0);
    expect(stats.fruit.itemsBuilt + stats.dessert.itemsBuilt).toBe(opened);
    expect(stats.fruit.cratesPlaced + stats.dessert.cratesPlaced).toBe(drops);
    expect(stats.fruit.stallDamage + stats.dessert.stallDamage).toBe(damage);
    expect(tallyStats(stats, state, step(state, new Map())).lastTick).toBe(state.tick + 1);
  });
});
