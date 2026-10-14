import { describe, expect, it } from 'vitest';
import { checkTargets, runBatch } from '../src/harness';
import type { BatchResult } from '../src/harness';

const IN_BAND: BatchResult = {
  games: 1000,
  medianSec: 380,
  p90Sec: 470,
  winRate: { fruit: 0.52, dessert: 0.45 },
  draws: 30,
  timeouts: 20,
  msPerTick: 0.4,
};

const OUT_OF_BAND: BatchResult = {
  games: 1000,
  medianSec: 200,
  p90Sec: 250,
  winRate: { fruit: 0.7, dessert: 0.25 },
  draws: 0,
  timeouts: 50,
  msPerTick: 0.9,
};

describe('runBatch', () => {
  it('runs the requested number of all-bot games', () => {
    expect(runBatch({ games: 5, seed0: 1, maxMinutes: 15 }).games).toBe(5);
  });

  it('is deterministic: same opts give an identical result except msPerTick', () => {
    const a = runBatch({ games: 5, seed0: 1, maxMinutes: 15 });
    const b = runBatch({ games: 5, seed0: 1, maxMinutes: 15 });
    expect({ ...a, msPerTick: 0 }).toEqual({ ...b, msPerTick: 0 });
  });

  it('wins + draws + timeouts sum the games (draws count for neither team)', () => {
    const r = runBatch({ games: 5, seed0: 1, maxMinutes: 15 });
    const buckets = r.winRate.fruit + r.winRate.dessert + r.draws / r.games + r.timeouts / r.games;
    expect(buckets).toBeCloseTo(1, 10);
  });
});

describe('checkTargets (--assert bands)', () => {
  it('accepts a result inside every band', () => {
    const v = checkTargets(IN_BAND);
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
  });

  it('flags median, win rates, timeouts and msPerTick of an out-of-band result', () => {
    const v = checkTargets(OUT_OF_BAND);
    expect(v.ok).toBe(false);
    expect(v.failures.length).toBe(5);
    expect(v.failures.some((f) => f.includes('median'))).toBe(true);
    expect(v.failures.some((f) => f.includes('fruit'))).toBe(true);
    expect(v.failures.some((f) => f.includes('dessert'))).toBe(true);
    expect(v.failures.some((f) => f.includes('timeouts'))).toBe(true);
    expect(v.failures.some((f) => f.includes('msPerTick'))).toBe(true);
  });

  it('accepts exact band edges (inclusive targets)', () => {
    const edge: BatchResult = {
      games: 1000,
      medianSec: 300,
      p90Sec: 480,
      winRate: { fruit: 0.55, dessert: 0.45 },
      draws: 0,
      timeouts: 20,
      msPerTick: 0.5,
    };
    expect(checkTargets(edge).ok).toBe(true);
  });
});
