import { describe, expect, it } from 'vitest';
import {
  botGoal,
  botInput,
  createMatch,
  dropCrateAt,
  padCellCenter,
  stateHash,
  step,
  teamNeeds,
  BOT_HEAVY_MIN_SUPPLY,
  HEAVY_RANGE,
  SUPER_GUN_RANGE,
  TEAM_CAP,
} from '../src/index';
import type { MatchState, Recipe, Team, Unit, Vec2 } from '../src/index';

const teams = ['fruit', 'dessert'] as const;
const rotate = (p: Vec2): Vec2 => ({ x: 40 - p.x, y: 24 - p.y });
function mates(s: MatchState, team: Team): Unit[] {
  return s.units.filter((u) => u.team === team);
}
function armed(s: MatchState, team: Team): Unit {
  const u = mates(s, team)[0]!;
  u.gun = { ammoCooldownTicks: 0 };
  return u;
}
function grow(s: MatchState, team: Team, count: number) {
  s.nextId = Math.max(s.nextId, ...s.units.map((u) => u.id + 1));
  while (mates(s, team).length < count) {
    s.units.push({ ...structuredClone(mates(s, team)[0]!), id: s.nextId++, gun: null });
  }
}
function floor(s: MatchState, team: Team, count: number) {
  s.pads[team].cells = Array.from({ length: 4 }, (_, i) => [i < count ? 100 + i : null, null]);
  for (let i = 0; i < count; i++)
    s.crates.push({
      id: 100 + i,
      state: 'onPad',
      pos: padCellCenter(s.pads[team], i),
      landTick: 0,
    });
  s.nextId = 200;
}
function supply(s: MatchState, count: number) {
  for (let i = 0; i < count; i++)
    s.crates.push({ id: s.nextId++, state: 'ground', pos: { x: 20 + i, y: 12 }, landTick: 0 });
}

describe('R1 bot decisions and natural traffic', () => {
  it('needs_gun_then_buddy_with_bombs_then_heavy_with_supply_then_bombs', () => {
    for (const team of teams) {
      const s = createMatch(1, { humanUnit: null });
      expect(teamNeeds(s, team)).toBe('gun');
      const u = armed(s, team);
      expect(teamNeeds(s, team)).toBe('bombs');
      mates(s, team)[1]!.bombs = 1;
      expect(teamNeeds(s, team)).toBe('buddy');
      mates(s, team)[1]!.bombs = 0;
      grow(s, team, 4);
      supply(s, BOT_HEAVY_MIN_SUPPLY);
      expect(teamNeeds(s, team)).toBe('heavy');
      // Falling crates and enemy cargo are not usable supply.
      s.crates[0]!.state = 'falling';
      s.crates[1]!.state = 'carried';
      mates(s, team === 'fruit' ? 'dessert' : 'fruit')[0]!.carrying = s.crates[1]!.id;
      expect(teamNeeds(s, team)).toBe('bombs');
      s.crates[0]!.state = 'carried';
      u.carrying = s.crates[0]!.id;
      s.crates[1]!.state = 'ground';
      expect(teamNeeds(s, team)).toBe('heavy');
      u.gun = { kind: 'heavy', ammoCooldownTicks: 0 };
      expect(teamNeeds(s, team)).toBe('bombs');
      mates(s, team)[1]!.bombs = 1;
      grow(s, team, TEAM_CAP);
      expect(teamNeeds(s, team)).toBeNull();
      // Dead equipment does not cover a need; dead buddies still count at cap.
      u.deadUntilTick = 100;
      expect(teamNeeds(s, team)).toBe('gun');
    }
  });

  it('three_floor_crates_finish_heavy_before_bomb_rebuild', () => {
    for (const team of teams) {
      const s = createMatch(1, { humanUnit: null });
      armed(s, team);
      floor(s, team, 3);
      expect(teamNeeds(s, team)).toBe('heavy');
      s.pads[team].cells[2]![0] = null;
      expect(teamNeeds(s, team)).toBe('bombs'); // interrupted supply: no commitment at two
      s.pads[team].cells[2]![0] = 102;
      s.pads[team].cells[0]![1] = 103;
      expect(teamNeeds(s, team)).toBe('bombs'); // contaminated floor isn't heavy
      const before = structuredClone(s.pads[team].cells);
      const u = mates(s, team)[0]!;
      u.carrying = 104;
      s.crates.push({ id: 104, state: 'carried', pos: { ...u.pos }, landTick: 0 });
      for (let t = 0; t < 120; t++) {
        const input = botInput(s, u.id);
        expect(Math.hypot(input.move.x, input.move.y)).toBeGreaterThan(0);
        expect(input.pickDrop || input.open).toBe(false);
        s.tick++;
      }
      expect(s.pads[team].cells).toEqual(before); // retain v1 fallback, no deletion/upper placement
    }
  });

  it('bans_choose_legal_alternatives', () => {
    for (const team of teams) {
      const s = createMatch(1, { humanUnit: null });
      armed(s, team);
      grow(s, team, 4);
      supply(s, BOT_HEAVY_MIN_SUPPLY);
      s.itemBans = { [team]: ['heavy'] };
      expect(teamNeeds(s, team)).toBe('bombs');
      floor(s, team, 3);
      expect(teamNeeds(s, team)).not.toBe('heavy');
      s.itemBans = { [team]: ['super'] };
      expect(teamNeeds(s, team)).toBe('heavy');
    }
  });

  it('super_first_claims_do_not_collide', () => {
    for (const team of teams) {
      const s = createMatch(1, { humanUnit: null });
      s.commands[team] = 'fetch';
      const [a, b] = mates(s, team);
      a!.pos = { x: 20, y: 12 };
      b!.pos = { x: 20, y: 12 };
      s.units = [a!, b!];
      s.crates = [
        { id: 100, state: 'ground', pos: { x: 20, y: 12 }, landTick: 0 },
        { id: 101, state: 'ground', kind: 'super', pos: { x: 24, y: 12 }, landTick: 0 },
        { id: 102, state: 'ground', kind: 'super', pos: { x: 16, y: 12 }, landTick: 0 },
      ];
      expect(botInput(s, a!.id).move.x).toBeGreaterThan(0); // equal-distance supers: lower ID
      expect(botInput(s, b!.id).move.x).toBeLessThan(0); // same ordering for earlier claims
      expect(botInput(s, a!.id).pickDrop).toBe(false); // don't pick nearby normal en route
      s.itemBans = { [team]: ['super'] };
      expect(botInput(s, a!.id).pickDrop).toBe(true);
      expect(botInput(s, b!.id).move.x).toBeGreaterThan(0);
    }
  });

  it.each(teams)('coincident_drops_make_pickup_and_crafting_progress_for_%s', (team) => {
    // A super claim must not wait forever for a physically impossible tie pickup.
    for (const coincident of [true, false]) {
      let s = createMatch(1, { humanUnit: null });
      const u = mates(s, team)[0]!;
      s.units = [u];
      s.commands[team] = 'fetch';
      u.pos = { x: 20, y: 12 };
      s.crates = [
        { id: 100, kind: 'normal', state: 'carried', pos: { ...u.pos }, landTick: 0 },
        { id: 101, kind: 'super', state: 'carried', pos: { ...u.pos }, landTick: 0 },
      ];
      s.nextId = 102;
      const normalPos = coincident ? u.pos : { x: team === 'fruit' ? 18 : 22, y: 12 };
      dropCrateAt(s, 100, normalPos);
      dropCrateAt(s, 101, u.pos);
      const initial = structuredClone(s);
      const hash = stateHash(s);
      botInput(s, u.id);
      expect(s).toEqual(initial);
      expect(stateHash(s)).toBe(hash);
      const picked: number[] = [];
      let openings = 0;
      for (let tick = 0; tick < 600; tick++) {
        s = step(s, new Map());
        for (const event of s.events) {
          if (event.kind === 'cratePick') picked.push(event.crateId as number);
          if (event.kind === 'opened') openings++;
        }
      }
      expect(picked[0]).toBe(coincident ? 100 : 101);
      expect(picked).toContain(101); // super becomes reachable after the normal blocker
      expect(openings).toBeGreaterThan(0);
      // The complete ordinary-action recovery also replays without hidden bot memory.
      let replay = initial;
      for (let tick = 0; tick < 600; tick++) replay = step(replay, new Map());
      expect(replay).toEqual(s);
      expect(stateHash(replay)).toBe(stateHash(s));
    }
  });

  it('coincident_blocker_claims_are_shared_without_grabbing_unrelated_normals', () => {
    for (const team of teams) {
      let s = createMatch(1, { humanUnit: null });
      const [a, b] = mates(s, team);
      s.units = [a!, b!];
      s.commands[team] = 'fetch';
      a!.pos = { x: 20, y: 12 };
      b!.pos = { x: 20, y: 12 };
      const far = team === 'fruit' ? { x: 24, y: 12 } : { x: 16, y: 12 };
      s.crates = [
        { id: 100, kind: 'normal', state: 'ground', pos: { x: 20, y: 12 }, landTick: 0 },
        { id: 101, kind: 'super', state: 'ground', pos: { x: 20, y: 12 }, landTick: 0 },
        { id: 102, kind: 'super', state: 'ground', pos: far, landTick: 0 },
        { id: 103, kind: 'normal', state: 'ground', pos: { x: 20, y: 12 }, landTick: 0 },
      ];
      s.nextId = 104;
      expect(botInput(s, a!.id).pickDrop).toBe(true);
      const second = botInput(s, b!.id);
      expect(second.pickDrop).toBe(false);
      expect(second.move.x * (team === 'fruit' ? 1 : -1)).toBeGreaterThan(0);
      s = step(s, new Map());
      expect(s.events.filter((e) => e.kind === 'cratePick').map((e) => e.crateId)).toEqual([100]);
      expect(s.units[0]!.carrying).toBe(100);
      expect(s.units[1]!.carrying).toBeNull();
    }
  });

  it('heavy_places_4_floor_cells_never_upper_or_premature_open', () => {
    for (const team of teams) {
      let s = createMatch(1, { humanUnit: null });
      const u = armed(s, team);
      grow(s, team, 4);
      // Isolate actual bot placement/opening from combat and other builders.
      for (const mate of s.units) if (mate.id !== u.id) mate.isBot = false;
      s.commands[team] = 'fetch';
      supply(s, BOT_HEAVY_MIN_SUPPLY);
      for (let count = 0; count < 4; count++) {
        const actor = s.units.find((v) => v.id === u.id)!;
        const crate = s.crates.find((c) => c.state === 'ground')!;
        crate.state = 'carried';
        actor.carrying = crate.id;
        for (let t = 0; t < 300 && actor.id === u.id; t++) {
          s = step(s, new Map());
          const now = s.units.find((v) => v.id === u.id)!;
          expect(s.pads[team].cells.every((c) => c[1] === null)).toBe(true);
          expect(s.events.some((e) => e.kind === 'opened')).toBe(false);
          if (now.carrying === null) break;
        }
        expect(s.pads[team].cells.filter((c) => c[0] !== null)).toHaveLength(count + 1);
        if (count < 3) expect(botInput(s, u.id).open).toBe(false);
      }
      let opened = false;
      for (let t = 0; t < 100 && !opened; t++) {
        s = step(s, new Map());
        opened = s.events.some((e) => e.kind === 'opened' && e.recipe === 'heavy');
      }
      expect(opened).toBe(true);
      expect(s.units.find((v) => v.id === u.id)!.gun?.kind).toBe('heavy');
    }
  });

  it('builder_survives_armed_switch_and_loaded_heavy_attacks', () => {
    for (const team of teams) {
      const s = createMatch(1, { humanUnit: null });
      const [a, b, c] = mates(s, team);
      a!.gun = { ammoCooldownTicks: 0 };
      b!.gun = { ammoCooldownTicks: 0 };
      expect(botGoal(s, a!.id)).toBe('fetch');
      a!.gun.kind = 'heavy';
      expect(botGoal(s, a!.id)).toBe('attack');
      expect(botGoal(s, b!.id)).toBe('fetch');
      b!.bombs = 1;
      expect(botGoal(s, b!.id)).toBe('attack');
      expect(botGoal(s, c!.id)).toBe('fetch');
      a!.carrying = 100;
      expect(botGoal(s, a!.id)).toBe('fetch'); // cargo overrides heavy role
      expect(botGoal(s, c!.id)).toBe('attack');
      s.commands[team] = 'guard';
      for (const u of mates(s, team)) expect(botGoal(s, u.id)).toBe('guard');
    }
  });

  it('reassigns_the_guard_when_its_default_unit_becomes_the_builder', () => {
    // Equipment-aware builder election must not silently remove base defence.
    for (const team of teams) {
      const s = createMatch(1, { humanUnit: null });
      grow(s, team, TEAM_CAP);
      const [heavy, builder, defender, attacker] = mates(s, team);
      heavy!.gun = { kind: 'heavy', ammoCooldownTicks: 0 };
      expect(teamNeeds(s, team)).toBe('bombs');
      expect(botGoal(s, heavy!.id)).toBe('attack');
      expect(botGoal(s, builder!.id)).toBe('fetch');
      expect(botGoal(s, defender!.id)).toBe('guard');
      expect(botGoal(s, attacker!.id)).toBe('attack');
      builder!.gun = { kind: 'heavy', ammoCooldownTicks: 0 };
      expect(botGoal(s, heavy!.id)).toBe('attack');
      expect(botGoal(s, builder!.id)).toBe('attack');
      expect(botGoal(s, defender!.id)).toBe('fetch');
      expect(botGoal(s, attacker!.id)).toBe('guard');
      s.commands[team] = 'attack';
      expect(botGoal(s, attacker!.id)).toBe('attack');
    }
  });

  it('heavy_and_super_ranges_match_combat', () => {
    for (const team of teams)
      for (const kind of ['gun', 'heavy'] as const) {
        const s = createMatch(1, { humanUnit: null });
        const u = mates(s, team)[0]!;
        s.units = [u];
        s.commands[team] = 'attack';
        u.gun = { kind, super: true, ammoCooldownTicks: 0 };
        const range = kind === 'heavy' ? HEAVY_RANGE : SUPER_GUN_RANGE;
        const canonical = { x: 35 - range + 0.1, y: 4 };
        u.pos = team === 'fruit' ? canonical : rotate(canonical);
        const input = botInput(s, u.id);
        expect(input.aim).toEqual(team === 'fruit' ? { x: 33, y: 4 } : { x: 7, y: 20 });
        const next = step(s, new Map());
        expect(next.projectiles[0]?.kind).toBe(kind === 'heavy' ? 'coconut' : 'bullet');
        expect(next.projectiles[0]?.super).toBe(true);
        expect(input.move.y).toBeCloseTo(0, 9); // hold/mill, don't close to the normal-gun distance
      }
  });

  it('new_loadouts_and_partial_pads_are_mirror_symmetric', () => {
    for (const count of [0, 1, 2, 3])
      for (const quality of [false, true])
        for (const cargo of [false, true])
          for (const heavyLoaded of [false, true]) {
            const s = createMatch(1, { humanUnit: null });
            grow(s, 'fruit', TEAM_CAP);
            grow(s, 'dessert', TEAM_CAP);
            for (const team of teams) {
              const group = mates(s, team);
              group[0]!.gun = { ammoCooldownTicks: 0, super: quality };
              if (heavyLoaded)
                group[1]!.gun = { kind: 'heavy', super: quality, ammoCooldownTicks: 0 };
              group[2]!.bombs = 1;
              group[2]!.bombsSuper = quality;
              group[3]!.superBuddy = quality;
              floor(s, team, count);
            }
            s.pads.dessert.cells.reverse();
            supply(s, BOT_HEAVY_MIN_SUPPLY);
            // Symmetric actual crates, independent IDs and team-index pairs.
            s.crates = s.crates.filter((c) => c.state === 'ground');
            s.crates.push(...s.crates.map((c) => ({ ...c, id: c.id + 1000, pos: rotate(c.pos) })));
            const f = mates(s, 'fruit'),
              d = mates(s, 'dessert');
            for (let i = 0; i < f.length; i++) {
              d[i]!.pos = rotate(f[i]!.pos);
              d[i]!.facing = { x: -f[i]!.facing.x, y: -f[i]!.facing.y };
            }
            if (cargo)
              for (const [team, actor, id] of [
                ['fruit', f[0]!, 900],
                ['dessert', d[0]!, 901],
              ] as const) {
                actor.carrying = id;
                actor.pos = padCellCenter(s.pads[team], team === 'fruit' ? 0 : 3);
                s.crates.push({
                  id,
                  kind: quality ? 'super' : 'normal',
                  state: 'carried',
                  pos: { ...actor.pos },
                  landTick: 0,
                });
              }
            for (const tick of [0, 61, 240]) {
              s.tick = tick;
              const before = structuredClone(s);
              for (let i = 0; i < f.length; i++) {
                const a = botInput(s, f[i]!.id),
                  b = botInput(s, d[i]!.id);
                expect(b.move.x, JSON.stringify({ count, quality, tick, i, a, b })).toBeCloseTo(
                  -a.move.x,
                  9,
                );
                expect(b.move.y).toBeCloseTo(-a.move.y, 9);
                expect(b.aim).toEqual(a.aim === null ? null : rotate(a.aim));
                expect([b.fire, b.open, b.pickDrop, b.throwBomb]).toEqual([
                  a.fire,
                  a.open,
                  a.pickDrop,
                  a.throwBomb,
                ]);
              }
              expect(s).toEqual(before);
              expect(stateHash(s)).toBe(stateHash(before));
            }
          }
  });

  it('finishes_a_ready_buddy_if_last_weapon_is_lost_before_opening', () => {
    for (const team of teams) {
      let s = createMatch(27, { humanUnit: null });
      const u = mates(s, team)[0]!;
      s.units = [u];
      s.commands[team] = 'fetch';
      floor(s, team, 1);
      s.pads[team].cells[0]![1] = 101;
      const cargo = { id: 102, state: 'carried' as const, pos: { ...u.pos }, landTick: 0 };
      s.crates.push(cargo);
      u.carrying = cargo.id;
      u.pos = padCellCenter(s.pads[team], 0);
      let opened = false;
      for (let t = 0; t < 600 && !opened; t++) {
        s = step(s, new Map());
        opened = s.events.some((e) => e.kind === 'opened' && e.recipe === 'buddy');
      }
      expect(opened).toBe(true);
      expect(s.crates.some((c) => c.id === cargo.id)).toBe(true); // safely drop, don't delete cargo
    }
  });

  it('six_natural_seeds_open_all_four_recipes_and_super', () => {
    const total: Record<Recipe, number> = { gun: 0, bombs: 0, buddy: 0, heavy: 0, class: 0 };
    let supers = 0;
    for (let seed = 1; seed <= 6; seed++) {
      let s = createMatch(seed, { humanUnit: null });
      const counts: Record<Recipe, number> = { gun: 0, bombs: 0, buddy: 0, heavy: 0, class: 0 };
      const quality = { normal: 0, super: 0 };
      const byRecipeQuality: Record<Recipe, { normal: number; super: number }> = {
        gun: { normal: 0, super: 0 },
        bombs: { normal: 0, super: 0 },
        buddy: { normal: 0, super: 0 },
        heavy: { normal: 0, super: 0 },
        class: { normal: 0, super: 0 },
      };
      while (s.winner === null && s.tick < 18000) {
        s = step(s, new Map());
        for (const e of s.events)
          if (e.kind === 'opened') {
            const recipe = e.recipe as Recipe;
            counts[recipe]++;
            total[recipe]++;
            byRecipeQuality[recipe][e.super === true ? 'super' : 'normal']++;
            if (e.super === true) {
              quality.super++;
              supers++;
            } else quality.normal++;
          }
      }
      console.log(
        JSON.stringify({ seed, tick: s.tick, winner: s.winner, counts, quality, byRecipeQuality }),
      );
      expect(s.winner).not.toBeNull();
    }
    console.log(JSON.stringify({ total, supers }));
    // This R1 oracle retains all four natural-use requirements; R2-6 owns class use.
    for (const recipe of ['gun', 'bombs', 'buddy', 'heavy'] as const)
      expect(total[recipe]).toBeGreaterThanOrEqual(1);
    expect(supers).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
