import { botGoal, createMatch, step } from '../src/index';
import type { Vec2 } from '../src/index';

/** QA cadence: endpoint displacement every 4 ticks, alive/non-opening at both ends. */
export function measureAttackMotion(seed: number) {
  let s = createMatch(seed);
  const previous = new Map<number, { pos: Vec2; eligible: boolean; attacking: boolean }>();
  const runs = new Map<number, number>();
  const attackRuns = new Map<number, number>();
  const idle: Record<number, number> = {};
  const attackIdle: Record<number, number> = {};
  const hits = { fruit: 0, dessert: 0 };
  let attackSamples = 0;
  for (let tick = 0; tick <= 1300 && s.winner === null; tick++) {
    if (tick > 0) s = step(s, new Map(), { fruit: 'attack' });
    for (const e of s.events) {
      if (e.kind === 'hit' && (e.target === 'fruit' || e.target === 'dessert')) {
        hits[e.target === 'fruit' ? 'dessert' : 'fruit']++;
      }
    }
    if (tick % 4 !== 0) continue;
    for (const u of s.units.filter((u) => u.isBot)) {
      const eligible = u.deadUntilTick === null && s.pads[u.team].opening?.byUnit !== u.id;
      const prev = previous.get(u.id);
      const still =
        prev?.eligible && eligible && Math.hypot(u.pos.x - prev.pos.x, u.pos.y - prev.pos.y) < 0.1;
      const run = still ? (runs.get(u.id) ?? 0) + 0.2 : 0;
      runs.set(u.id, run);
      idle[u.id] = Math.max(idle[u.id] ?? 0, run);
      const attacking = eligible && botGoal(s, u.id) === 'attack';
      if (attacking) attackSamples++;
      const attackRun =
        still && attacking && prev?.attacking ? (attackRuns.get(u.id) ?? 0) + 0.2 : 0;
      attackRuns.set(u.id, attackRun);
      attackIdle[u.id] = Math.max(attackIdle[u.id] ?? 0, attackRun);
      previous.set(u.id, { pos: { ...u.pos }, eligible, attacking });
    }
  }
  return {
    seed,
    idle,
    attackIdle,
    attackSamples,
    hits,
    minutes: s.tick / 1200,
    hitsPerMin: { fruit: hits.fruit / (s.tick / 1200), dessert: hits.dessert / (s.tick / 1200) },
  };
}
