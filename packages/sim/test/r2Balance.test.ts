import { describe, expect, it } from 'vitest';
import { checkTargets, runBatch } from '../src/harness';
import * as sim from '../src/index';
import type { BatchResult } from '../src/harness';
import type { ItemBan, Team, UnitClass } from '../src/index';

const teams = ['fruit', 'dessert'] as const;
const classes = ['boxer', 'healer', 'ninja', 'giant'] as const;
const items = [...classes, 'class'] as const;
const recipes = ['gun', 'bombs', 'buddy', 'heavy', 'class'] as const;
const sources = ['slap', 'gun', 'bombs', 'heavy'] as const;

// Real complete result shape; only the metrics under test are replaced.
it('pins the measured R2-only numeric table for reproducible balance runs', () => {
  const chosen = {
    BOXER_MAX_HP: 130,
    BOXER_SPEED_MULT: 1.1,
    BOXER_SLAP_DMG: 12,
    HEALER_MAX_HP: 100,
    HEALER_SPEED_MULT: 1,
    HEALER_RADIUS: 3.25,
    HEALER_AURA_HP_PER_SEC: 4,
    HEALER_SELF_HP_PER_SEC: 2,
    NINJA_MAX_HP: 75,
    NINJA_SPEED_MULT: 1.35,
    NINJA_KNOCK_COOLDOWN_TICKS: 40,
    GIANT_MAX_HP: 200,
    GIANT_SPEED_MULT: 0.75,
    GIANT_BOMB_DAMAGE_MULT: 0.6,
    CLASS_SUPER_HP_MULT: 1.05,
    CLASS_SUPER_SPEED_MULT: 1.03,
    BOT_CLASS_MIN_SUPPLY: 4,
    BOT_CLASS_TARGET_COUNT: 2,
    BOT_CLASS_WOUNDED_FRACTION: 0.65,
    BOT_CLASS_ENEMY_PAD_CRATES: 2,
    BOT_CLASS_DUPLICATE_PENALTY: 4,
    BOT_CLASS_HEALER_NEED_BONUS: 3,
    BOT_CLASS_NINJA_NEED_BONUS: 2,
    BOT_CLASS_GIANT_NEED_BONUS: 2,
    BOT_CLASS_BOXER_NEED_BONUS: 1,
  };
  for (const key of Object.keys(chosen) as Array<keyof typeof chosen>)
    expect(sim[key], key).toBe(chosen[key]);
});

const band: BatchResult = {
  ...runBatch({ games: 1, seed0: 1, maxMinutes: 0.001 }),
  games: 10000,
  medianSec: 300,
  winRate: { fruit: 0.5, dessert: 0.5 },
  draws: 0,
  timeouts: 0,
  msPerTick: 0.1,
};

describe('R2 locked balance boundaries', () => {
  it.each([
    [299.99, false],
    [300, true],
    [480, true],
    [480.01, false],
  ] as const)('median %s accepted=%s', (medianSec, ok) => {
    expect(checkTargets({ ...band, medianSec }).ok).toBe(ok);
  });
  it.each(teams)('checks both inclusive win edges for %s', (team) => {
    const opponent = team === 'fruit' ? 'dessert' : 'fruit';
    for (const [rate, otherRate, ok] of [
      [0.4499, 0.5501, false],
      [0.45, 0.55, true],
      [0.55, 0.45, true],
      [0.5501, 0.4499, false],
    ] as const) {
      expect(
        checkTargets({ ...band, winRate: { ...band.winRate, [team]: rate, [opponent]: otherRate } })
          .ok,
      ).toBe(ok);
    }
  });
  it.each(teams.flatMap((team) => items.map((item) => ({ team, item }))))(
    'checks asymmetric floor, timeout and performance for $team/$item',
    (ban) => {
      const opponent = ban.team === 'fruit' ? 'dessert' : 'fruit';
      for (const [rate, ok] of [
        [0.3999, false],
        [0.4, true],
        [0.7, true],
      ] as const) {
        const r = {
          ...band,
          medianSec: 200,
          winRate: { ...band.winRate, [ban.team]: rate, [opponent]: 1 - rate },
        };
        expect(checkTargets(r, ban).ok).toBe(ok);
        expect(checkTargets({ ...r, timeouts: 1 }, ban).ok).toBe(false);
        expect(checkTargets({ ...r, msPerTick: 0.5001 }, ban).ok).toBe(false);
      }
    },
  );
  it('rejects any timeout and accepts only inclusive performance cap', () => {
    expect(checkTargets({ ...band, timeouts: 1 }).ok).toBe(false);
    expect(checkTargets({ ...band, msPerTick: 0.5 }).ok).toBe(true);
    expect(checkTargets({ ...band, msPerTick: 0.5001 }).ok).toBe(false);
  });
});

// Independent observer: collect real events into lists, then reduce by literal
// event categories, rather than invoking the harness parser/counter helpers.
function observeSixSeeds() {
  const events: sim.MatchState['events'] = [];
  const winners: Array<Team | 'draw' | null> = [];
  const seconds: number[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    let state = sim.createMatch(seed, { humanUnit: null });
    while (state.winner === null && state.tick < 18000) {
      state = sim.step(state, new Map());
      events.push(...state.events);
    }
    winners.push(state.winner);
    seconds.push(state.tick / 20);
  }
  seconds.sort((a, b) => a - b);
  const opens = Object.fromEntries(
    teams.map((team) => [
      team,
      Object.fromEntries(
        recipes.map((recipe) => [
          recipe,
          events.filter((e) => e.kind === 'opened' && e.team === team && e.recipe === recipe)
            .length,
        ]),
      ),
    ]),
  );
  const classPicks = Object.fromEntries(
    teams.map((team) => [
      team,
      Object.fromEntries(
        classes.map((classId) => [
          classId,
          events.filter(
            (e) =>
              e.kind === 'opened' &&
              e.recipe === 'class' &&
              e.team === team &&
              e.classId === classId,
          ).length,
        ]),
      ),
    ]),
  );
  const stallDamage = Object.fromEntries(
    teams.map((team) => [
      team,
      Object.fromEntries(
        sources.map((source) => [
          source,
          events
            .filter(
              (e) =>
                e.kind === 'hit' &&
                e.target === (team === 'fruit' ? 'dessert' : 'fruit') &&
                e.source === source,
            )
            .reduce((sum, e) => sum + (e.dmg as number), 0),
        ]),
      ),
    ]),
  );
  return {
    games: 6,
    medianSec: (seconds[2]! + seconds[3]!) / 2,
    p90Sec: (seconds[4]! + seconds[5]!) / 2,
    winRate: Object.fromEntries(
      teams.map((team) => [team, winners.filter((w) => w === team).length / 6]),
    ),
    draws: winners.filter((w) => w === 'draw').length,
    timeouts: winners.filter((w) => w === null).length,
    opens,
    classPicks,
    stallDamage,
    superOpens: Object.fromEntries(
      teams.map((team) => [
        team,
        events.filter((e) => e.kind === 'opened' && e.team === team && e.super === true).length,
      ]),
    ),
  };
}

it('replays six short natural matches with independently observed counters and percentiles', () => {
  const opts = { games: 6, seed0: 1, maxMinutes: 15 };
  const expected = observeSixSeeds();
  const { msPerTick: firstTiming, ...first } = runBatch(opts);
  const { msPerTick: secondTiming, ...second } = runBatch(opts);
  expect(first).toEqual(expected);
  expect(second).toEqual(first);
  expect(firstTiming).toBeGreaterThan(0);
  expect(secondTiming).toBeGreaterThan(0);
  for (const classId of classes)
    expect(first.classPicks.fruit[classId] + first.classPicks.dessert[classId]).toBeGreaterThan(0);
}, 30000);

function walls(banTeam: Team, item: ItemBan) {
  const s = sim.createMatch(1);
  s.itemBans = { [banTeam]: [item] };
  for (const u of s.units) u.isBot = false;
  for (const team of teams) {
    const pad = s.pads[team];
    for (const col of [0, 1])
      for (const layer of [0, 1]) {
        const id = s.nextId++;
        pad.cells[col]![layer] = id;
        s.crates.push({
          id,
          kind: 'normal',
          state: 'onPad',
          pos: sim.padCellCenter(pad, col),
          landTick: 0,
        });
      }
    s.units.find((u) => u.team === team)!.pos = sim.padCellCenter(pad, 0);
  }
  return s;
}

it.each(teams.flatMap((team) => items.map((item) => ({ team, item }))))(
  '$team/$item prohibits only selected-side recruits through real input',
  ({ team, item }) => {
    for (const classId of classes) {
      let s = walls(team, item);
      const inputs = new Map(
        s.units
          .filter((u) => u.id === 0 || u.id === 3)
          .map((u) => [
            u.id,
            {
              move: { x: 0, y: 0 },
              aim: null,
              fire: false,
              throwBomb: false,
              pickDrop: false,
              open: true,
              classPick: {
                classId: classId as UnitClass,
                snapshot: JSON.stringify(s.pads[u.team].cells),
              },
            },
          ]),
      );
      const recruits: sim.MatchState['events'] = [];
      s = sim.step(s, inputs);
      for (let tick = 0; tick < 20; tick++) {
        s = sim.step(s, new Map());
        recruits.push(...s.events.filter((e) => e.kind === 'opened' && e.recipe === 'class'));
      }
      const prohibited = item === 'class' || item === classId;
      expect(recruits.filter((e) => e.team === team)).toHaveLength(prohibited ? 0 : 1);
      expect(recruits.filter((e) => e.team !== team)).toHaveLength(1);
      expect(recruits.every((e) => e.classId === classId)).toBe(true);
    }
  },
);
