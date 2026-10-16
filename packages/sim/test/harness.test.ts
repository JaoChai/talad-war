import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkTargets, runBatch } from '../src/harness';
import type { BatchOpts, BatchResult } from '../src/harness';
import {
  createMatch,
  padCellCenter,
  padPreview,
  processAttacks,
  recipeResult,
  spawnCrates,
  startOpen,
  step,
  TICK_HZ,
  OPEN_TICKS,
  SUPER_BUDDY_MAX_HP,
  updateOpens,
} from '../src/index';
import type { ItemBan, Recipe, Team, UnitInput } from '../src/index';

const teams = ['fruit', 'dessert'] as const;
const recipes = ['gun', 'bombs', 'buddy', 'heavy'] as const;
const sources = ['slap', 'gun', 'bombs', 'heavy'] as const;
const counts = () => ({ gun: 0, bombs: 0, buddy: 0, heavy: 0 });
const damage = () => ({ slap: 0, gun: 0, bombs: 0, heavy: 0 });
const IN_BAND: BatchResult = {
  games: 1000,
  medianSec: 380,
  p90Sec: 470,
  winRate: { fruit: 0.52, dessert: 0.45 },
  draws: 30,
  timeouts: 0,
  msPerTick: 0.4,
  opens: { fruit: counts(), dessert: counts() },
  superOpens: { fruit: 0, dessert: 0 },
  stallDamage: { fruit: damage(), dessert: damage() },
};
const OUT_OF_BAND: BatchResult = {
  ...IN_BAND,
  medianSec: 200,
  p90Sec: 250,
  winRate: { fruit: 0.7, dessert: 0.25 },
  draws: 0,
  timeouts: 50,
  msPerTick: 0.9,
};
const idle: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};

/** Independent event oracle: actual step events, not fixtures or mocked counters. */
function observe(opts: BatchOpts) {
  const opens = { fruit: counts(), dessert: counts() };
  const superOpens = { fruit: 0, dessert: 0 };
  const stallDamage = { fruit: damage(), dessert: damage() };
  const wins = { fruit: 0, dessert: 0 };
  let draws = 0;
  let timeouts = 0;
  for (let seed = opts.seed0; seed < opts.seed0 + opts.games; seed++) {
    let s = createMatch(seed, { humanUnit: null });
    if (opts.ban) s.itemBans = { [opts.ban.team]: [opts.ban.item] };
    while (s.winner === null && s.tick < opts.maxMinutes * 60 * TICK_HZ) {
      s = step(s, new Map());
      for (const e of s.events) {
        if (e.kind === 'opened') {
          expect(teams).toContain(e.team);
          expect(recipes).toContain(e.recipe);
          opens[e.team as Team][e.recipe as Recipe]++;
          if (e.super === true) superOpens[e.team as Team]++;
        }
        if (e.kind === 'hit' && (e.target === 'fruit' || e.target === 'dessert')) {
          expect(sources).toContain(e.source);
          expect(typeof e.dmg).toBe('number');
          // Attribute to the ATTACKING side, not the damaged stall.
          stallDamage[e.target === 'fruit' ? 'dessert' : 'fruit'][
            e.source as (typeof sources)[number]
          ] += e.dmg as number;
        }
      }
    }
    if (s.winner === null) timeouts++;
    else if (s.winner === 'draw') draws++;
    else wins[s.winner]++;
  }
  return {
    opens,
    superOpens,
    stallDamage,
    draws,
    timeouts,
    winRate: { fruit: wins.fruit / opts.games, dessert: wins.dessert / opts.games },
  };
}

describe('runBatch', () => {
  it('runs the requested number of all-bot games', () => {
    expect(runBatch({ games: 5, seed0: 1, maxMinutes: 15 }).games).toBe(5);
  });
  it('is deterministic: same opts give an identical result except msPerTick', () => {
    const opts = { games: 5, seed0: 1, maxMinutes: 15 };
    const a = runBatch(opts),
      b = runBatch(opts);
    expect({ ...a, msPerTick: 0 }).toEqual({ ...b, msPerTick: 0 });
  });
  it('is deterministic with a ban, including all telemetry', () => {
    const opts = {
      games: 2,
      seed0: 1,
      maxMinutes: 15,
      ban: { team: 'dessert', item: 'super' } as const,
    };
    const a = runBatch(opts),
      b = runBatch(opts);
    expect({ ...a, msPerTick: 0 }).toEqual({ ...b, msPerTick: 0 });
  });
  it('wins + draws + timeouts sum the games (draws count for neither team)', () => {
    for (const maxMinutes of [15, 0.001]) {
      const r = runBatch({ games: 5, seed0: 1, maxMinutes });
      expect(r.winRate.fruit + r.winRate.dessert + (r.draws + r.timeouts) / r.games).toBeCloseTo(
        1,
        10,
      );
      if (maxMinutes < 1) {
        expect(r.timeouts).toBe(5);
        expect(r.winRate).toEqual({ fruit: 0, dessert: 0 });
        expect(r.opens).toEqual(IN_BAND.opens);
        expect(r.stallDamage).toEqual(IN_BAND.stallDamage);
      }
    }
  });
  it('accumulates every recipe, quality and actual damage source by attacking team', () => {
    const opts = { games: 3, seed0: 1, maxMinutes: 15 };
    const expected = observe(opts);
    expect(runBatch(opts)).toMatchObject(expected);
    for (const recipe of recipes)
      expect(expected.opens.fruit[recipe] + expected.opens.dessert[recipe]).toBeGreaterThan(0);
    for (const source of sources)
      expect(
        expected.stallDamage.fruit[source] + expected.stallDamage.dessert[source],
      ).toBeGreaterThan(0);
    for (const team of teams) expect(expected.superOpens[team]).toBeGreaterThan(0);
  }, 30_000);
  it.each(teams.flatMap((team) => (['heavy', 'super'] as const).map((item) => ({ team, item }))))(
    'sets the $team/$item ban on every new match',
    (ban) => {
      const opts = { games: 2, seed0: 1, maxMinutes: 15, ban };
      const expected = observe(opts);
      expect(runBatch(opts)).toMatchObject(expected);
      if (ban.item === 'heavy') expect(expected.opens[ban.team].heavy).toBe(0);
      else expect(expected.superOpens[ban.team]).toBe(0);
      const opponent = ban.team === 'fruit' ? 'dessert' : 'fruit';
      expect(
        ban.item === 'heavy' ? expected.opens[opponent].heavy : expected.superOpens[opponent],
      ).toBeGreaterThan(0);
    },
    30_000,
  );
});

describe('checkTargets (--assert bands)', () => {
  it('accepts a result inside every band', () => {
    expect(checkTargets(IN_BAND)).toEqual({ ok: true, failures: [] });
  });
  it('flags median, both win rates, timeouts and msPerTick', () => {
    const v = checkTargets(OUT_OF_BAND);
    expect(v.ok).toBe(false);
    expect(v.failures).toHaveLength(5);
    for (const label of ['median', 'fruit', 'dessert', 'timeouts', 'msPerTick'])
      expect(v.failures.some((f) => f.includes(label))).toBe(true);
  });
  it.each([300, 480])(
    'accepts inclusive median %s, win and performance edges with zero timeouts',
    (medianSec) => {
      expect(
        checkTargets({
          ...IN_BAND,
          medianSec,
          winRate: { fruit: 0.55, dessert: 0.45 },
          msPerTick: 0.5,
        }).ok,
      ).toBe(true);
    },
  );
  it('rejects even one timeout', () => {
    expect(checkTargets({ ...IN_BAND, timeouts: 1 }).ok).toBe(false);
  });
  it.each(teams)(
    'normal 40 percent fails but banned %s at 40 percent accepts other pacing',
    (team) => {
      const asymmetric = {
        ...IN_BAND,
        medianSec: 200,
        winRate: team === 'fruit' ? { fruit: 0.4, dessert: 0.6 } : { fruit: 0.6, dessert: 0.4 },
      };
      expect(checkTargets({ ...asymmetric, medianSec: 380 }).ok).toBe(false);
      for (const item of ['heavy', 'super'] as const) {
        const ban = { team, item };
        expect(checkTargets(asymmetric, ban)).toEqual({ ok: true, failures: [] });
        expect(
          checkTargets({ ...asymmetric, winRate: { ...asymmetric.winRate, [team]: 0.399 } }, ban)
            .ok,
        ).toBe(false);
        expect(checkTargets({ ...asymmetric, timeouts: 1 }, ban).ok).toBe(false);
        expect(checkTargets({ ...asymmetric, msPerTick: 0.5001 }, ban).ok).toBe(false);
      }
    },
  );
});

function cli(args: string[]) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('../src/harness.ts', import.meta.url)),
      '--games',
      '1',
      '--max-minutes',
      '0.001',
      ...args,
    ],
    { encoding: 'utf8' },
  );
}
describe('CLI ban validation', () => {
  it('retains normal invocation without mandatory new options', () => {
    const r = cli([]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ games: 1, timeouts: 1 });
  });
  it.each(teams.flatMap((team) => (['heavy', 'super'] as const).map((item) => [team, item])))(
    'accepts paired --ban-team %s --ban-item %s',
    (team, item) => {
      const r = cli(['--ban-team', team!, '--ban-item', item!]);
      expect(r.status, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout).timeouts).toBe(1);
      expect(cli(['--ban-team', team!, '--ban-item', item!, '--assert']).status).toBe(1);
    },
  );
  it.each([
    ['--ban-team', 'fruit'],
    ['--ban-item', 'heavy'],
    ['--ban-team'],
    ['--ban-item'],
    ['--ban-team', 'other', '--ban-item', 'heavy'],
    ['--ban-team', 'fruit', '--ban-item', 'gun'],
    ['--ban-team', 'fruit', '--ban-item'],
    ['--ban-item', 'super', '--ban-team'],
  ])('rejects partial/unknown ban arguments %j', (...args) => {
    const r = cli(args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ban/i);
    expect(r.stdout).toBe('');
  });
});

/** Legal super pad, direct open channel; no bot or combat interference. */
function recipeArena(team: Team, recipe: Recipe, item: ItemBan) {
  const s = createMatch(1, { humanUnit: null });
  for (const u of s.units) u.isBot = false;
  s.itemBans = { [team]: [item] };
  for (const side of teams) {
    const pad = s.pads[side];
    const cells =
      recipe === 'gun'
        ? [[0, 0]]
        : recipe === 'bombs'
          ? [
              [0, 0],
              [1, 0],
            ]
          : recipe === 'buddy'
            ? [
                [0, 0],
                [0, 1],
              ]
            : [
                [0, 0],
                [1, 0],
                [2, 0],
                [3, 0],
              ];
    for (const [col, layer] of cells) {
      const id = s.nextId++;
      pad.cells[col!]![layer!] = id;
      s.crates.push({
        id,
        kind: 'super',
        state: 'onPad',
        pos: padCellCenter(pad, col!),
        landTick: 0,
      });
    }
    const opener = s.units.find((u) => u.team === side)!;
    opener.pos = padCellCenter(pad, 0);
  }
  return s;
}
describe('ban policy uses existing rule resolver, not deleted/recoloured crates', () => {
  it.each(teams)('heavy ban cannot grant or fire heavy on %s, opponent unchanged', (team) => {
    const s = recipeArena(team, 'heavy', 'heavy');
    const opponent = team === 'fruit' ? 'dessert' : 'fruit';
    expect(recipeResult(s, team)).toBeNull();
    expect(padPreview(s, team).openable).toBe(false);
    const before = structuredClone(s.pads[team].cells);
    for (const side of teams) startOpen(s, s.units.find((u) => u.team === side)!.id);
    s.tick += OPEN_TICKS;
    updateOpens(s);
    expect(s.pads[team].cells).toEqual(before);
    expect(s.units.find((u) => u.team === team)!.gun).toBeNull();
    expect(s.units.find((u) => u.team === opponent)!.gun).toMatchObject({
      kind: 'heavy',
      super: true,
    });
    processAttacks(
      s,
      new Map(s.units.map((u) => [u.id, { ...idle, fire: true, aim: { x: 20, y: 12 } }])),
    );
    expect(s.projectiles.filter((p) => p.team === team && p.kind === 'coconut')).toHaveLength(0);
    expect(s.projectiles.filter((p) => p.team === opponent && p.kind === 'coconut')).toHaveLength(
      1,
    );
  });
  it.each(teams.flatMap((team) => recipes.map((recipe) => ({ team, recipe }))))(
    'super $recipe resolves normal only for $team',
    ({ team, recipe }) => {
      const s = recipeArena(team, recipe, 'super');
      for (const side of teams) {
        expect(recipeResult(s, side)).toEqual({ recipe, super: side !== team });
        startOpen(s, s.units.find((u) => u.team === side)!.id);
      }
      s.tick += OPEN_TICKS;
      updateOpens(s);
      for (const side of teams) {
        const quality = side !== team;
        const u = s.units.find((u) => u.team === side)!;
        expect(s.events).toContainEqual(
          expect.objectContaining({ kind: 'opened', team: side, recipe, super: quality }),
        );
        if (recipe === 'gun' || recipe === 'heavy') expect(u.gun?.super === true).toBe(quality);
        if (recipe === 'bombs') {
          expect(u.bombs).toBe(quality ? 5 : 3);
          expect(u.bombsSuper).toBe(quality);
        }
        if (recipe === 'buddy') {
          const buddy = s.units.filter((u) => u.team === side).at(-1)!;
          expect(buddy.superBuddy === true).toBe(quality);
          expect(buddy.hp).toBe(quality ? SUPER_BUDDY_MAX_HP : 100);
        }
      }
    },
  );
  it.each(teams.flatMap((team) => (['heavy', 'super'] as const).map((item) => ({ team, item }))))(
    'leaves shared spawn RNG and quality unchanged with $team/$item',
    (ban) => {
      const normal = createMatch(1),
        banned = createMatch(1);
      banned.itemBans = { [ban.team]: [ban.item] };
      for (let tick = 60; tick <= 840; tick += 20) {
        normal.tick = banned.tick = tick;
        spawnCrates(normal);
        spawnCrates(banned);
        expect(banned.crates).toEqual(normal.crates);
        expect(banned.rng).toBe(normal.rng);
        expect(banned.nextId).toBe(normal.nextId);
      }
    },
  );
});
