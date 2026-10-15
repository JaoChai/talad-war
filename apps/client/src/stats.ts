import type { MatchState, Team } from '@talad/sim';

export interface TeamStats {
  cratesPlaced: number;
  itemsBuilt: number;
  stallDamage: number;
}
export type MatchStats = Record<Team, TeamStats> & { lastTick: number };

export function emptyStats(): MatchStats {
  return {
    fruit: { cratesPlaced: 0, itemsBuilt: 0, stallDamage: 0 },
    dessert: { cratesPlaced: 0, itemsBuilt: 0, stallDamage: 0 },
    lastTick: 0,
  };
}

/** Pure per-tick accumulator. Opening consumes crates but never subtracts placements. */
export function tallyStats(stats: MatchStats, prev: MatchState, cur: MatchState): MatchStats {
  if (cur.tick <= stats.lastTick || cur.tick <= prev.tick) return stats;
  const next: MatchStats = {
    fruit: { ...stats.fruit },
    dessert: { ...stats.dessert },
    lastTick: cur.tick,
  };
  for (const team of ['fruit', 'dessert'] as const) {
    const old = new Set(prev.pads[team].cells.flat());
    for (const id of new Set(cur.pads[team].cells.flat())) {
      if (id !== null && !old.has(id)) next[team].cratesPlaced++;
    }
  }
  for (const event of cur.events) {
    if (event.tick !== cur.tick) continue;
    if (event.kind === 'opened' && (event.team === 'fruit' || event.team === 'dessert')) {
      next[event.team].itemsBuilt++;
    }
    if (event.kind === 'hit' && (event.target === 'fruit' || event.target === 'dessert')) {
      next[event.target === 'fruit' ? 'dessert' : 'fruit'].stallDamage += Number(event.dmg);
    }
  }
  return next;
}
