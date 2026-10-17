import { describe, expect, it } from 'vitest';
import {
  botGoal,
  botInput,
  chooseClass,
  createMatch,
  padCellCenter,
  stateHash,
  step,
  teamNeeds,
  unitMaxHp,
  CLASS_IDS,
  BOT_CLASS_MIN_SUPPLY,
  TEAM_CAP,
  OPEN_TICKS,
} from '../src/index';
import type { MatchState, Recipe, Team, Unit, UnitClass, Vec2 } from '../src/index';

const teams = ['fruit', 'dessert'] as const;
const rotate = (p: Vec2): Vec2 => ({ x: 40 - p.x, y: 24 - p.y });
const mates = (s: MatchState, team: Team): Unit[] => s.units.filter((u) => u.team === team);
function supply(s: MatchState, count = BOT_CLASS_MIN_SUPPLY) {
  for (let i = 0; i < count; i++)
    s.crates.push({ id: s.nextId++, state: 'ground', pos: { x: 20 + i, y: 12 }, landTick: 0 });
}
function cells(s: MatchState, team: Team, columns: number[][]) {
  const pad = s.pads[team];
  pad.cells = Array.from({ length: 4 }, () => [null, null]);
  columns.forEach((layers, col) =>
    layers.forEach((layer) => {
      const id = s.nextId++;
      pad.cells[col]![layer] = id;
      s.crates.push({ id, state: 'onPad', pos: padCellCenter(pad, col), landTick: 0 });
    }),
  );
}
function fixture(team: Team) {
  const s = createMatch(1, { humanUnit: null });
  mates(s, team)[0]!.gun = { ammoCooldownTicks: 0 };
  return s;
}

// Breaks caught: premature ordinary opens, non-superset wall placements, or missing real pick command.
describe('R2 natural class bots', () => {
  it('wall_builds_without_premature_open', () => {
    for (const team of teams) {
      let s = fixture(team);
      const id = mates(s, team)[0]!.id;
      for (const u of s.units) if (u.id !== id) u.isBot = false;
      s.commands[team] = 'fetch';
      supply(s);
      const visited: number[] = [];
      for (let count = 0; count < 4; count++) {
        const u = s.units.find((v) => v.id === id)!;
        const c = s.crates.find((v) => v.state === 'ground')!;
        c.state = 'carried';
        u.carrying = c.id;
        expect(teamNeeds(s, team)).toBe('class');
        for (let t = 0; t < 300; t++) {
          s = step(s, new Map());
          expect(s.events.some((e) => e.kind === 'opened')).toBe(false);
          if (s.units.find((v) => v.id === id)!.carrying === null) break;
        }
        const col = s.pads[team].cells.findIndex((v) => v.includes(c.id));
        visited.push(team === 'fruit' ? col : 3 - col);
        expect(s.pads[team].cells.flat().filter((v) => v !== null)).toHaveLength(count + 1);
        if (count < 3) expect(botInput(s, id).open).toBe(false);
      }
      expect(visited).toEqual([0, 1, 0, 1]);
      let recruit: Unit | undefined;
      for (let t = 0; t < 100 && recruit === undefined; t++) {
        s = step(s, new Map());
        for (const e of s.events)
          if (e.kind === 'opened' && e.recipe === 'class') {
            expect(e.classId).toBeDefined();
            recruit = s.units.find((u) => u.id === e.spawnedUnitId);
            expect(recruit?.classId).toBe(e.classId);
            expect(recruit?.team).toBe(team);
          }
      }
      expect(recruit).toBeDefined();
    }
  });

  it('needs_respect_supply_cap_bans_and_partial_wall', () => {
    for (const team of teams) {
      const s = fixture(team);
      supply(s);
      expect(teamNeeds(s, team)).toBe('class');
      s.itemBans = { [team]: ['class'] };
      expect(teamNeeds(s, team)).toBe('bombs');
      s.itemBans = { [team]: [...CLASS_IDS] };
      expect(teamNeeds(s, team)).toBe('bombs');
      s.itemBans = { [team]: ['boxer', 'ninja', 'giant'] };
      expect(teamNeeds(s, team)).toBe('class');
      s.crates = [];
      expect(teamNeeds(s, team)).toBe('bombs');
      cells(s, team, [[0, 1], [], [], []]);
      // A single stacked column remains an ordinary buddy at low supply.
      mates(s, team)[0]!.bombs = 1;
      expect(teamNeeds(s, team)).toBe('buddy');
      const actor = mates(s, team)[0]!;
      s.commands[team] = 'fetch';
      actor.pos = padCellCenter(s.pads[team], 0);
      expect(botInput(s, actor.id).open).toBe(true);
      supply(s, BOT_CLASS_MIN_SUPPLY);
      expect(teamNeeds(s, team)).toBe('class');
      expect(botInput(s, actor.id).open).toBe(false);
      s.crates = s.crates.filter((c) => c.state !== 'ground');
      cells(s, team, [[0, 1], [0], [], []]);
      mates(s, team)[0]!.gun = null;
      expect(teamNeeds(s, team)).toBe('class'); // committed two-column upper wall survives gun loss
      s.pads[team].cells[1]![0] = s.nextId++;
      s.pads[team].cells[1]![1] = s.nextId++;
      expect(teamNeeds(s, team)).toBe('class'); // ready wall wins over gun need
      while (mates(s, team).length < TEAM_CAP)
        s.units.push({
          ...structuredClone(mates(s, team)[0]!),
          id: s.nextId++,
          deadUntilTick: 100,
        });
      expect(teamNeeds(s, team)).not.toBe('class');
    }
    const s = fixture('fruit');
    supply(s);
    for (const u of mates(s, 'fruit').slice(1)) {
      u.classId = 'boxer';
      u.deadUntilTick = 100;
    }
    expect(teamNeeds(s, 'fruit')).not.toBe('class'); // persistent target counts corpses
    cells(s, 'fruit', [[0], [0], [0], []]);
    expect(teamNeeds(s, 'fruit')).toBe('heavy');
  });

  it('choose_class_is_need_based_seed_tied_and_pure', () => {
    for (const team of teams) {
      const s = fixture(team);
      for (let seed = 0; seed < 4; seed++) {
        s.seed = seed;
        expect(chooseClass(s, team)).toBe(CLASS_IDS[seed]);
      }
      for (const u of mates(s, team).slice(0, 2)) u.hp = 30;
      expect(chooseClass(s, team)).toBe('healer');
      for (const u of mates(s, team)) u.hp = unitMaxHp(u);
      cells(s, team === 'fruit' ? 'dessert' : 'fruit', [[0, 1], [], [], []]);
      expect(chooseClass(s, team)).toBe('ninja');
      s.pads[team === 'fruit' ? 'dessert' : 'fruit'].cells = [
        [null, null],
        [null, null],
        [null, null],
        [null, null],
      ];
      mates(s, team === 'fruit' ? 'dessert' : 'fruit')[0]!.bombs = 1;
      expect(chooseClass(s, team)).toBe('giant');
      s.itemBans = { [team]: ['boxer', 'ninja', 'giant'] };
      const before = structuredClone(s),
        hash = stateHash(s);
      expect(chooseClass(s, team)).toBe('healer');
      botInput(s, mates(s, team)[0]!.id);
      expect(s).toEqual(before);
      expect(stateHash(s)).toBe(hash);
      s.itemBans = { [team]: ['class'] };
      expect(chooseClass(s, team)).toBeNull();
      s.itemBans = { [team]: [...CLASS_IDS] };
      expect(chooseClass(s, team)).toBeNull();
    }
    const s = fixture('fruit');
    s.seed = 0xffffffff;
    expect(chooseClass(s, 'fruit')).toBe('giant');
    mates(s, 'fruit')[1]!.classId = 'giant';
    mates(s, 'fruit')[1]!.deadUntilTick = 100;
    expect(chooseClass(s, 'fruit')).toBe('boxer');
    mates(s, 'fruit')[0]!.gun = null;
    expect(chooseClass(s, 'fruit')).toBe('boxer');
  });

  it('bot_channel_holds_under_goal_change', () => {
    for (const team of teams) {
      let s = fixture(team);
      const u = mates(s, team)[0]!;
      u.gun = null;
      u.pos = padCellCenter(s.pads[team], 0);
      cells(s, team, [[0, 1], [0, 1], [], []]);
      const snapshot = JSON.stringify(s.pads[team].cells);
      s.pads[team].opening = { byUnit: u.id, doneTick: OPEN_TICKS, snapshot, classId: 'healer' };
      const pos = { ...u.pos };
      for (let t = 0; t < OPEN_TICKS; t++) {
        s.commands[team] = t % 2 ? 'attack' : 'guard';
        const input = botInput(s, u.id);
        expect(input.move).toEqual({ x: 0, y: 0 });
        expect([input.pickDrop, input.open, input.throwBomb, input.fire]).toEqual([
          false,
          false,
          false,
          false,
        ]);
        s = step(s, new Map());
        expect(s.units.find((v) => v.id === u.id)!.pos).toEqual(pos);
      }
      expect(s.events.some((e) => e.kind === 'opened' && e.classId === 'healer')).toBe(true);
      expect(mates(s, team).filter((v) => v.classId === 'healer')).toHaveLength(1);
    }
  });

  it('ninja_raids_and_healer_supports', () => {
    for (const team of teams) {
      const enemy = team === 'fruit' ? 'dessert' : 'fruit';
      let s = fixture(team);
      const ninja = mates(s, team)[2]!;
      ninja.classId = 'ninja';
      cells(s, enemy, [[0, 1], [], [], []]);
      ninja.pos = padCellCenter(s.pads[enemy], 0);
      expect(botGoal(s, ninja.id)).toBe('attack');
      expect(botInput(s, ninja.id).fire).toBe(true);
      s = step(s, new Map());
      expect(s.events.some((e) => e.kind === 'ninjaKnock' && e.unitId === ninja.id)).toBe(true);
      const healer = mates(s, team)[2]!;
      healer.classId = 'healer';
      healer.pos = team === 'fruit' ? { x: 20, y: 12 } : { x: 20, y: 12 };
      const ally = mates(s, team)[1]!;
      ally.hp = 20;
      ally.pos = team === 'fruit' ? { x: 24, y: 12 } : { x: 16, y: 12 };
      const sign = team === 'fruit' ? 1 : -1;
      expect(botInput(s, healer.id).move.x * sign).toBeGreaterThan(0);
      healer.pos = { ...ally.pos };
      expect(botInput(s, healer.id).move).toEqual({ x: 0, y: 0 });
      s.commands[team] = 'guard';
      expect(Math.hypot(...Object.values(botInput(s, healer.id).move))).toBeGreaterThan(0);
    }
  });

  it('banned_or_full_walls_recover_real_crates_without_touching_reserved_walls', () => {
    for (const team of teams)
      for (const mode of ['class', 'all', 'cap'] as const) {
        let s = fixture(team);
        const actor = mates(s, team)[0]!;
        cells(s, team, [[0, 1], [0, 1], [], []]);
        const original = s.crates.map((c) => c.id);
        if (mode === 'cap')
          while (mates(s, team).length < TEAM_CAP)
            s.units.push({ ...structuredClone(actor), id: s.nextId++, deadUntilTick: 9999 });
        else s.itemBans = { [team]: mode === 'all' ? [...CLASS_IDS] : ['class'] };
        for (const u of s.units) if (u.id !== actor.id) u.isBot = false;
        s.commands[team] = 'fetch';
        actor.pos = padCellCenter(s.pads[team], 0);
        let progress = false,
          lifted = false;
        for (let t = 0; t < 600 && !progress; t++) {
          s = step(s, new Map());
          expect(s.events.some((e) => e.kind === 'opened' && e.recipe === 'class')).toBe(false);
          if (s.units.find((u) => u.id === actor.id)!.carrying !== null) {
            lifted = true;
            expect(original).toContain(s.units.find((u) => u.id === actor.id)!.carrying);
            expect(original.every((id) => s.crates.some((c) => c.id === id))).toBe(true);
          }
          progress = s.events.some((e) => e.kind === 'opened');
        }
        expect(lifted).toBe(true);
        expect(progress, `${team}/${mode}`).toBe(true);
      }
    const s = fixture('fruit');
    cells(s, 'fruit', [[0, 1], [0, 1], [], []]);
    const [opener, other] = mates(s, 'fruit');
    s.commands.fruit = 'fetch';
    s.itemBans = { fruit: ['class'] };
    s.pads.fruit.opening = {
      byUnit: opener!.id,
      doneTick: 20,
      snapshot: JSON.stringify(s.pads.fruit.cells),
      classId: 'boxer',
    };
    other!.pos = padCellCenter(s.pads.fruit, 0);
    expect(botInput(s, other!.id).pickDrop).toBe(false);
  });

  it('all_class_choices_banned_alternatives_and_tactics_are_mirrored_and_pure', () => {
    for (const classId of CLASS_IDS)
      for (const banned of [false, true])
        for (const carried of [false, true])
          for (const tick of [0, 61, 240]) {
            const s = createMatch(2, { humanUnit: null });
            s.tick = tick;
            for (const team of teams) {
              const group = mates(s, team);
              group[0]!.gun = { ammoCooldownTicks: 0 };
              group[1]!.hp = 20;
              group[2]!.classId = classId;
              group[2]!.pos = { x: 20, y: 12 };
              cells(s, team, [[0, 1], [0], [], []]);
              if (team === 'dessert') s.pads[team].cells.reverse();
              s.itemBans = {
                ...s.itemBans,
                [team]: banned ? [classId] : CLASS_IDS.filter((c) => c !== classId),
              };
              if (carried) {
                group[0]!.carrying = s.nextId++;
                s.crates.push({
                  id: group[0]!.carrying,
                  state: 'carried',
                  pos: group[0]!.pos,
                  landTick: 0,
                });
              }
            }
            const f = mates(s, 'fruit'),
              d = mates(s, 'dessert');
            for (let i = 0; i < f.length; i++) {
              d[i]!.pos = rotate(f[i]!.pos);
              d[i]!.facing = { x: -f[i]!.facing.x, y: -f[i]!.facing.y };
            }
            const before = structuredClone(s),
              hash = stateHash(s);
            const pick = chooseClass(s, 'fruit');
            expect(chooseClass(s, 'dessert')).toBe(pick);
            if (banned) expect(pick).not.toBe(classId);
            else expect(pick).toBe(classId);
            for (let i = 0; i < f.length; i++) {
              const a = botInput(s, f[i]!.id),
                b = botInput(s, d[i]!.id);
              expect(b.move.x).toBeCloseTo(-a.move.x, 9);
              expect(b.move.y).toBeCloseTo(-a.move.y, 9);
              expect(b.aim).toEqual(a.aim === null ? null : rotate(a.aim));
              expect([b.open, b.fire, b.pickDrop, b.throwBomb]).toEqual([
                a.open,
                a.fire,
                a.pickDrop,
                a.throwBomb,
              ]);
              expect(b.classPick?.classId).toBe(a.classPick?.classId);
            }
            expect(s).toEqual(before);
            expect(stateHash(s)).toBe(hash);
            expect(s.rng).toBe(before.rng);
          }
  });

  it('six_natural_seeds_recruit_each_class', () => {
    const total: Record<UnitClass, number> = { boxer: 0, healer: 0, ninja: 0, giant: 0 };
    const recipes: Record<Recipe, number> = { gun: 0, bombs: 0, buddy: 0, heavy: 0, class: 0 };
    for (let seed = 1; seed <= 6; seed++) {
      let s = createMatch(seed, { humanUnit: null });
      const picks = { boxer: 0, healer: 0, ninja: 0, giant: 0 };
      const counts = { gun: 0, bombs: 0, buddy: 0, heavy: 0, class: 0 };
      const quality = { normal: 0, super: 0 };
      while (s.winner === null && s.tick < 18000) {
        s = step(s, new Map());
        for (const e of s.events)
          if (e.kind === 'opened') {
            const recipe = e.recipe as Recipe;
            recipes[recipe]++;
            counts[recipe]++;
            quality[e.super === true ? 'super' : 'normal']++;
            if (recipe === 'class') {
              expect(CLASS_IDS).toContain(e.classId);
              const classId = e.classId as UnitClass;
              const recruit = s.units.find((u) => u.id === e.spawnedUnitId);
              expect(recruit?.classId).toBe(classId);
              expect(recruit?.isBot).toBe(true);
              picks[classId]++;
              total[classId]++;
            }
          }
      }
      console.log(JSON.stringify({ seed, tick: s.tick, winner: s.winner, counts, quality, picks }));
      expect(s.winner).not.toBeNull();
    }
    console.log(JSON.stringify({ recipes, total }));
    for (const count of Object.values(total)) expect(count).toBeGreaterThanOrEqual(1);
    for (const count of Object.values(recipes)) expect(count).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
