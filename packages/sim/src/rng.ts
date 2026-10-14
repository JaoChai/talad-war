import type { MatchState } from './types';

/**
 * mulberry32 — the sim's only randomness source. Advances `s.rng` in place and returns
 * a value in [0, 1). Only ever call it on a state you own (a fresh `step` clone).
 */
export function nextRandom(s: MatchState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
