import { describe, expect, it } from 'vitest';
import { HEALER_RADIUS, botGoal, createMatch, step, unitMaxHp } from '../src/index';
import type { MatchState, Unit, UnitId } from '../src/index';

/**
 * R2b regression: the enlarged pad (PAD_CELL_SIZE 2.2) parks freshly-armed
 * dessert attackers against wall faces so their circle clips an obstacle by a
 * fraction of a unit; from there BOTH per-axis steps of the desired move are
 * rejected and the fixed ±0.45 rad veer never asks for the one direction that
 * frees them (away from the face), so the bot stands at the same spot for the
 * rest of the match (seed 5 bot 3 at the obstacle {18,3,22,4} NE corner and
 * seed 13 bot 3, both measured on 1304134).
 *
 * This pins the never-stuck contract — the same observer, thresholds and
 * exemptions as the 20-seed 'never stuck' test in bots.test.ts (copied
 * verbatim) — on seeds 5 and 13 for the FULL match instead of its 2400-tick
 * window. Main (e79b78b) passes this full-match scan with zero violations;
 * the violations are introduced by the pad geometry, so the steering fix must
 * clear them without weakening anything.
 */

type StuckRefs = Map<UnitId, { pos: { x: number; y: number }; since: number }>;

// Infer real phase-7 healing independently from HP and damage events. Net HP
// alone misses healing on a combat tick; death/respawn must never count as a heal.
function supportedAllyWasHealed(before: MatchState, s: MatchState, unit: Unit): boolean {
  const source = before.units.find((u) => u.id === unit.id);
  if (
    source === undefined ||
    !source.isBot ||
    !unit.isBot ||
    source.classId !== 'healer' ||
    source.deadUntilTick !== null ||
    unit.deadUntilTick !== null ||
    before.commands[source.team] !== null ||
    botGoal(before, source.id) !== 'attack'
  )
    return false;
  const distance2 = (a: Unit, b: Unit) => (a.pos.x - b.pos.x) ** 2 + (a.pos.y - b.pos.y) ** 2;
  const selected = before.units
    .filter(
      (u) =>
        u.team === source.team &&
        u.id !== source.id &&
        u.deadUntilTick === null &&
        u.hp < unitMaxHp(u),
    )
    .sort(
      (a, b) =>
        a.hp / unitMaxHp(a) - b.hp / unitMaxHp(b) ||
        distance2(source, a) - distance2(source, b) ||
        a.id - b.id,
    )[0];
  if (selected === undefined) return false;
  const target = s.units.find((u) => u.id === selected.id);
  if (
    target === undefined ||
    target.deadUntilTick !== null ||
    distance2(unit, target) > HEALER_RADIUS ** 2 ||
    s.events.some((e) => e.kind === 'death' && (e.unitId === unit.id || e.unitId === target.id))
  )
    return false;
  const damage = s.events.reduce(
    (sum, e) => (e.kind === 'hit' && e.target === target.id ? sum + (e.dmg as number) : sum),
    0,
  );
  const preHealHp = selected.hp - damage;
  return preHealHp > 0 && preHealHp < unitMaxHp(target) && target.hp > preHealHp;
}

function checkStuck(before: MatchState, s: MatchState, refs: StuckRefs, t: number, seed: number) {
  for (const unit of s.units) {
    const goal = botGoal(s, unit.id);
    const opening = s.pads[unit.team].opening?.byUnit === unit.id;
    if (
      unit.deadUntilTick !== null ||
      goal === 'guard' ||
      opening ||
      supportedAllyWasHealed(before, s, unit)
    ) {
      refs.delete(unit.id);
      continue;
    }
    const ref = refs.get(unit.id);
    if (ref === undefined || Math.hypot(unit.pos.x - ref.pos.x, unit.pos.y - ref.pos.y) > 0.1) {
      refs.set(unit.id, { pos: { ...unit.pos }, since: t });
    } else if (t - ref.since > 100) {
      throw new Error(
        `seed ${seed}: bot ${unit.id} (${goal}) stuck at ` +
          `(${unit.pos.x.toFixed(2)},${unit.pos.y.toFixed(2)}) ticks ${ref.since}-${t}`,
      );
    }
  }
}

// Bound matches at 9000 ticks (450 s) — well past the ~330 s p90 — while still
// letting the assertion fire early on a permanent freeze.
const TICK_CAP = 9000;

function runSeedNoPermanentFreeze(seed: number) {
  let s = createMatch(seed, { humanUnit: null });
  const refs: StuckRefs = new Map();
  for (let t = 0; t < TICK_CAP && s.winner === null; t++) {
    const before = s;
    s = step(s, new Map());
    checkStuck(before, s, refs, t, seed);
  }
  return s;
}

describe('R2b corner-freeze regression (enlarged pad, seeds 5 and 13)', () => {
  it('seed 5 never holds a bot at one spot for more than 5 s for the whole match', () => {
    const s = runSeedNoPermanentFreeze(5);
    expect(s.winner).not.toBeNull();
  }, 600_000);

  it('seed 13 never holds a bot at one spot for more than 5 s for the whole match', () => {
    const s = runSeedNoPermanentFreeze(13);
    expect(s.winner).not.toBeNull();
  }, 600_000);
});
