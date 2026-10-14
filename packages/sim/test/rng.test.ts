import { describe, expect, it } from 'vitest';
import { createMatch, nextRandom } from '../src/index';
import type { MatchState } from '../src/index';

function draw(state: MatchState, count: number): number[] {
  return Array.from({ length: count }, () => nextRandom(state));
}

describe('seeded rng', () => {
  it('two states with the same seed produce the same 1000 values', () => {
    const a = draw(createMatch(42), 1000);
    const b = draw(createMatch(42), 1000);
    expect(a).toEqual(b);
  });

  it('seed 43 produces a different sequence than seed 42', () => {
    const a = draw(createMatch(42), 1000);
    const b = draw(createMatch(43), 1000);
    expect(b).not.toEqual(a);
  });

  it('every value lies in [0, 1)', () => {
    const values = draw(createMatch(12345), 1000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
