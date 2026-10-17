import { describe, expect, it } from 'vitest';
import * as sim from '../src/index';
import type { MatchState, Team, Unit, UnitInput } from '../src/index';

const idle: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};

function arena(): MatchState {
  const s = sim.createMatch(1);
  for (const u of s.units) {
    u.isBot = false;
    u.pos = { x: 2, y: 2 + u.id };
  }
  s.units[0]!.pos = { x: 12, y: 12 };
  return s;
}

function fire(s: MatchState, id = 0): void {
  sim.processAttacks(s, new Map([[id, { ...idle, fire: true }]]));
}

function wall(s: MatchState, team: Team): void {
  const pad = s.pads[team];
  for (const col of [0, 1]) {
    for (const layer of [0, 1]) {
      const id = 100 + col * 2 + layer;
      pad.cells[col]![layer] = id;
      s.crates.push({
        id,
        pos: sim.padCellCenter(pad, col),
        state: 'onPad',
        kind: layer ? 'super' : 'normal',
        landTick: 0,
      });
    }
  }
}

function ninjaMatch(team: Team = 'fruit'): MatchState {
  const s = arena();
  const u = s.units[0]!;
  u.team = team;
  u.classId = 'ninja';
  const enemy = team === 'fruit' ? 'dessert' : 'fruit';
  wall(s, enemy);
  u.pos = sim.padCellCenter(s.pads[enemy], 0);
  return s;
}

function incoming(
  s: MatchState,
  target: Unit,
  kind: 'bomb' | 'bullet' | 'coconut',
  quality = false,
): void {
  s.projectiles.push({
    id: 900,
    team: target.team === 'fruit' ? 'dessert' : 'fruit',
    kind,
    super: quality,
    pos: { ...target.pos },
    vel: { x: kind === 'coconut' ? 12 : 0, y: 0 },
    ttlTicks: 1,
    ...(kind === 'coconut' ? { distanceLeft: 0 } : {}),
  });
  sim.updateProjectiles(s, new Set());
}

function hitDamage(s: MatchState, target: number | Team): number[] {
  return s.events
    .filter((e) => e.kind === 'hit' && e.target === target)
    .map((e) => e.dmg as number);
}

describe('R2 class abilities', () => {
  it('boxer_slaps_units_and_stalls_not_guns', () => {
    for (const quality of [false, true]) {
      const s = arena();
      const boxer = s.units[0]!;
      boxer.classId = 'boxer';
      boxer.superBuddy = quality;
      const enemy = s.units[3]!;
      enemy.pos = { x: 12 + sim.SLAP_RANGE, y: 12 };
      fire(s);
      expect(enemy.hp).toBeCloseTo(100 - sim.BOXER_SLAP_DMG);
      expect(hitDamage(s, enemy.id)).toEqual([sim.BOXER_SLAP_DMG]);
      expect(boxer.attackCooldownTicks).toBe(10);
      for (let i = 1; i < 10; i++) fire(s);
      expect(hitDamage(s, enemy.id)).toHaveLength(1);
      fire(s);
      expect(hitDamage(s, enemy.id)).toHaveLength(2);
      enemy.pos.x += 0.0001;
      boxer.attackCooldownTicks = 0;
      fire(s);
      expect(hitDamage(s, enemy.id)).toHaveLength(2);
      boxer.pos = { x: 32, y: 4 };
      boxer.attackCooldownTicks = 0;
      fire(s);
      expect(hitDamage(s, 'dessert')).toEqual([sim.BOXER_SLAP_DMG]);
      expect(s.stalls.dessert.hp).toBe(sim.STALL_MAX_HP - sim.BOXER_SLAP_DMG);

      for (const kind of ['gun', 'heavy'] as const) {
        const armed = arena();
        const a = armed.units[0]!;
        a.classId = 'boxer';
        a.superBuddy = quality;
        a.gun = { kind, super: quality, ammoCooldownTicks: 0 };
        armed.units[3]!.pos = { x: 13, y: 12 };
        fire(armed);
        for (let tick = 0; tick < 4; tick++) sim.updateProjectiles(armed, new Set());
        expect(hitDamage(armed, 3)).toEqual([kind === 'gun' ? 12 : quality ? 65 : 60]);
      }
      const bomber = arena();
      bomber.units[0]!.classId = 'boxer';
      bomber.units[0]!.bombs = 1;
      bomber.units[0]!.bombsSuper = quality;
      bomber.units[3]!.pos = { x: 13, y: 12 };
      sim.processAttacks(
        bomber,
        new Map([[0, { ...idle, throwBomb: true, aim: { x: 13, y: 12 } }]]),
      );
      for (let t = 0; t < sim.BOMB_FUSE_TICKS; t++) sim.updateProjectiles(bomber, new Set());
      expect(hitDamage(bomber, 3)).toEqual([45]);
    }
  });

  it('healing_is_max_not_sum_and_never_revives', () => {
    const s = arena();
    const healer = s.units[0]!;
    Object.assign(healer, { classId: 'healer', hp: 50, superBuddy: true });
    Object.assign(s.units[1]!, {
      hp: 50,
      pos: { x: 12 + sim.HEALER_RADIUS, y: 12 },
      carrying: 700,
    });
    Object.assign(s.units[2]!, { hp: 50, pos: { x: 12 + sim.HEALER_RADIUS + 0.0001, y: 12 } });
    Object.assign(s.units[3]!, { hp: 50, pos: { x: 12, y: 12 } });
    Object.assign(s.units[4]!, {
      team: 'fruit',
      hp: 0,
      deadUntilTick: 100,
      classId: 'healer',
      pos: { x: 12, y: 12 },
    });
    s.pads.fruit.opening = { byUnit: 1, snapshot: 'test', doneTick: 100 };
    s.stalls.fruit.hp = 50;
    const before = structuredClone(s);
    for (let t = 0; t < 20; t++) sim.updateClassHealing(s);
    expect(healer.hp).toBeCloseTo(50 + sim.HEALER_SELF_HP_PER_SEC);
    expect(s.units[1]!.hp).toBeCloseTo(50 + sim.HEALER_AURA_HP_PER_SEC);
    expect(s.units[2]!.hp).toBe(50);
    expect(s.units[3]!.hp).toBe(50);
    expect(s.units[4]!.hp).toBe(0);
    expect(s.stalls).toEqual(before.stalls);
    expect(s.pads).toEqual(before.pads);
    expect(s.crates).toEqual(before.crates);
    expect(s.events).toEqual([]);
    expect(s.rng).toBe(before.rng);

    const overlap = arena();
    for (const u of overlap.units.slice(0, 3)) Object.assign(u, { pos: { x: 12, y: 12 }, hp: 50 });
    overlap.units[0]!.classId = 'healer';
    overlap.units[1]!.classId = 'healer';
    for (let t = 0; t < 20; t++) sim.updateClassHealing(overlap);
    for (const u of overlap.units.slice(0, 3))
      expect(u.hp).toBeCloseTo(50 + sim.HEALER_AURA_HP_PER_SEC);
    for (const classId of sim.CLASS_IDS) {
      const target = overlap.units[2]!;
      target.classId = classId;
      target.superBuddy = true;
      target.hp = sim.unitMaxHp(target) - 0.01;
      sim.updateClassHealing(overlap);
      expect(target.hp).toBe(sim.unitMaxHp(target));
    }
  });

  it('healer_provider_order_is_irrelevant_and_dead_providers_offer_nothing', () => {
    const s = arena();
    for (const u of s.units) Object.assign(u, { team: 'fruit', pos: { x: 12, y: 12 }, hp: 50 });
    s.units[0]!.classId = 'healer';
    s.units[1]!.classId = 'healer';
    Object.assign(s.units[2]!, { classId: 'healer', hp: 0, deadUntilTick: 100 });
    const reversed = structuredClone(s);
    reversed.units.reverse();
    sim.updateClassHealing(s);
    sim.updateClassHealing(reversed);
    const hps = (state: MatchState) => Object.fromEntries(state.units.map((u) => [u.id, u.hp]));
    expect(hps(s)).toEqual(hps(reversed));
    expect(s.units[3]!.hp).toBeCloseTo(50 + sim.HEALER_AURA_HP_PER_SEC * sim.DT);
    s.units[0]!.deadUntilTick = 100;
    s.units[1]!.deadUntilTick = 100;
    const hp = s.units[3]!.hp;
    sim.updateClassHealing(s);
    expect(s.units[3]!.hp).toBe(hp);
  });

  it('healing_ignores_line_of_sight_and_preserves_fractional_hp', () => {
    const s = arena();
    // Opposite sides of the y=3..4 obstacle; both positions are walkable.
    Object.assign(s.units[0]!, { classId: 'healer', pos: { x: 20, y: 2.5 }, hp: 50 });
    Object.assign(s.units[1]!, { pos: { x: 20, y: 4.5 }, hp: 50 });
    expect(sim.isUnitWalkable(s.units[0]!.pos)).toBe(true);
    expect(sim.isUnitWalkable(s.units[1]!.pos)).toBe(true);
    sim.updateClassHealing(s);
    expect(s.units[1]!.hp).toBeCloseTo(50 + sim.HEALER_AURA_HP_PER_SEC * sim.DT);
    expect(s.units[0]!.hp).toBeCloseTo(50 + sim.HEALER_SELF_HP_PER_SEC * sim.DT);
  });

  it('healing_runs_after_lethal_projectiles_before_respawn_without_reviving', () => {
    const s = arena();
    // Exact lethal boundary: healing first would incorrectly keep both alive.
    Object.assign(s.units[0]!, { classId: 'healer', hp: 45 });
    Object.assign(s.units[1]!, { pos: { x: 12, y: 12 }, hp: 45 });
    Object.assign(s.units[2]!, { pos: { x: 12, y: 14.5 }, hp: 50 });
    // The dead provider must not heal this ally outside the blast but inside the aura.
    // The lethal bomb acts before healing; neither corpse can provide or receive it.
    s.projectiles.push({
      id: 900,
      team: 'dessert',
      kind: 'bomb',
      pos: { x: 12, y: 12 },
      vel: { x: 0, y: 0 },
      ttlTicks: 1,
    });
    const next = sim.step(s, new Map());
    expect(next.units[2]!.hp).toBe(50);
    for (const id of [0, 1])
      expect(next.units[id]).toMatchObject({ hp: 0, deadUntilTick: 1 + sim.RESPAWN_TICKS });
    const respawning = arena();
    Object.assign(respawning.units[0]!, { classId: 'healer', hp: 0, deadUntilTick: 1 });
    const spawnPos = { x: 5, y: 17.2 };
    Object.assign(respawning.units[1]!, { pos: spawnPos, hp: 50 });
    const first = sim.step(respawning, new Map());
    expect(first.units[1]!.hp).toBe(50); // newly respawned provider was absent from this pass
    const second = sim.step(first, new Map());
    expect(second.units[1]!.hp).toBeCloseTo(50 + sim.HEALER_AURA_HP_PER_SEC * sim.DT);
  });

  it.each(['fruit', 'dessert'] as const)(
    'ninja_knocks_top_of_occupied_enemy_column_only (%s)',
    (team) => {
      const s = ninjaMatch(team);
      const ninja = s.units[0]!;
      const padTeam = team === 'fruit' ? 'dessert' : 'fruit';
      const rng = s.rng;
      const nextId = s.nextId;
      const upper = s.crates.find((c) => c.id === 101)!;
      const original = structuredClone(upper);
      const enemy = s.units.find((u) => u.team !== team)!;
      enemy.pos = { ...ninja.pos };
      fire(s);
      expect(s.pads[padTeam].cells).toEqual([
        [100, null],
        [102, 103],
        [null, null],
        [null, null],
      ]);
      expect(upper).toMatchObject({ id: original.id, kind: original.kind, state: 'ground' });
      expect(sim.isCrateGroundPoint(upper.pos)).toBe(true);
      expect(ninja.carrying).toBeNull();
      expect(enemy.hp).toBe(100); // knock wins; no simultaneous slap
      expect(s.events.filter((e) => e.kind === 'ninjaKnock')).toEqual([
        { tick: 0, kind: 'ninjaKnock', unitId: 0, team, padTeam, col: 0, crateId: 101 },
      ]);
      expect(s.events).toContainEqual({ tick: 0, kind: 'crateDrop', crateId: 101, unitId: null });
      expect(s.rng).toBe(rng);
      expect(s.nextId).toBe(nextId);
      s.tick = sim.NINJA_KNOCK_COOLDOWN_TICKS;
      ninja.attackCooldownTicks = 0;
      fire(s);
      expect(s.pads[padTeam].cells[0]).toEqual([null, null]);
      expect(s.crates.find((c) => c.id === 100)).toMatchObject({ state: 'ground', kind: 'normal' });
      expect(s.crates).toHaveLength(4);
    },
  );

  it('ninja_cooldowns_and_opening_phase_boundary', () => {
    let s = ninjaMatch();
    const opener = s.units[3]!;
    opener.pos = sim.padCellCenter(s.pads.dessert, 1);
    sim.startOpen(s, opener.id, {
      classId: 'boxer',
      snapshot: JSON.stringify(s.pads.dessert.cells),
    });
    s = sim.step(s, new Map([[0, { ...idle, fire: true }]]));
    expect(s.pads.dessert.opening).not.toBeNull(); // phase 6 preceded knock
    expect(s.units[0]!.ninjaKnockReadyTick).toBe(1 + sim.NINJA_KNOCK_COOLDOWN_TICKS);
    expect(s.units[0]!.attackCooldownTicks).toBe(10);
    s = sim.step(s, new Map());
    expect(s.pads.dessert.opening).toBeNull();
    expect(s.events).toContainEqual({ tick: 2, kind: 'openCancelled', team: 'dessert' });
    expect(s.pads.dessert.cells).toEqual([
      [100, null],
      [102, 103],
      [null, null],
      [null, null],
    ]);
    expect(s.crates.map((c) => c.id).sort()).toEqual([100, 101, 102, 103]);
    const ninja = s.units[0]!;
    const currentOpener = s.units[3]!; // step clones units; do not move the source-state opener
    s.tick = ninja.ninjaKnockReadyTick! - 1;
    ninja.attackCooldownTicks = 0;
    currentOpener.pos = { ...ninja.pos };
    fire(s); // knock unavailable falls back to ordinary slap
    expect(hitDamage(s, opener.id)).toEqual([8]);
    expect(s.pads.dessert.cells[0]).toEqual([100, null]);
    s.tick++;
    ninja.attackCooldownTicks = 0;
    fire(s);
    expect(s.pads.dessert.cells[0]).toEqual([null, null]);
    expect(hitDamage(s, opener.id)).toEqual([8]);

    const completing = ninjaMatch();
    completing.units[3]!.pos = sim.padCellCenter(completing.pads.dessert, 1);
    sim.startOpen(completing, 3, {
      classId: 'giant',
      snapshot: JSON.stringify(completing.pads.dessert.cells),
    });
    completing.tick = sim.OPEN_TICKS - 1;
    const done = sim.step(completing, new Map([[0, { ...idle, fire: true }]]));
    expect(done.events.filter((e) => e.kind === 'opened')).toEqual([
      expect.objectContaining({ recipe: 'class', classId: 'giant' }),
    ]);
    expect(done.events.some((e) => e.kind === 'openCancelled' || e.kind === 'ninjaKnock')).toBe(
      false,
    );
    expect(done.units.filter((u) => u.classId === 'giant')).toHaveLength(1);
    expect(done.crates).toHaveLength(0);
    expect(done.pads.dessert.opening).toBeNull();
  });

  it.each([
    'ownPad',
    'emptyColumn',
    'offPad',
    'gun',
    'crate',
    'knockCooldown',
    'slapCooldown',
    'dead',
    'otherClass',
  ])('ninja_cannot_knock_when_%s', (condition) => {
    const s = ninjaMatch();
    const ninja = s.units[0]!;
    if (condition === 'ownPad') ninja.pos = sim.padCellCenter(s.pads.fruit, 0);
    if (condition === 'emptyColumn') ninja.pos = sim.padCellCenter(s.pads.dessert, 2);
    if (condition === 'offPad') ninja.pos = { x: 28.9999, y: 3.75 };
    if (condition === 'gun') ninja.gun = { ammoCooldownTicks: 0 };
    if (condition === 'crate') ninja.carrying = 800;
    if (condition === 'knockCooldown') ninja.ninjaKnockReadyTick = 1;
    if (condition === 'slapCooldown') ninja.attackCooldownTicks = 1;
    if (condition === 'dead') ninja.deadUntilTick = 100;
    if (condition === 'otherClass') ninja.classId = 'boxer';
    const before = structuredClone(s);
    expect(sim.tryNinjaKnock(s, ninja)).toBe(false);
    expect(s).toEqual(before);
  });

  it('ninja_uses_post_movement_column_and_normal_slap_fallback', () => {
    const s = ninjaMatch();
    const ninja = s.units[0]!;
    ninja.pos = { x: 28.9, y: 3.75 };
    const moved = sim.step(s, new Map([[0, { ...idle, move: { x: 1, y: 0 }, fire: true }]]));
    expect(moved.events).toContainEqual(expect.objectContaining({ kind: 'ninjaKnock', col: 0 }));
    const empty = ninjaMatch();
    empty.units[0]!.pos = sim.padCellCenter(empty.pads.dessert, 2);
    empty.units[3]!.pos = { ...empty.units[0]!.pos };
    fire(empty);
    expect(hitDamage(empty, 3)).toEqual([8]);
    expect(empty.events.some((e) => e.kind === 'ninjaKnock')).toBe(false);
    // Pick/drop remains unable to lift enemy columns for any class.
    for (const classId of sim.CLASS_IDS) {
      const picking = ninjaMatch();
      picking.units[0]!.classId = classId;
      const next = sim.step(picking, new Map([[0, { ...idle, pickDrop: true }]]));
      expect(next.pads.dessert.cells).toEqual(picking.pads.dessert.cells);
      expect(next.units[0]!.carrying).toBeNull();
    }
  });

  it('giant_reduces_bombs_only', () => {
    for (const quality of [false, true]) {
      for (const kind of ['bomb', 'bullet', 'coconut'] as const) {
        const s = arena();
        const giant = s.units[0]!;
        giant.classId = 'giant';
        giant.superBuddy = quality;
        giant.hp = sim.unitMaxHp(giant);
        const beforeHp = giant.hp;
        incoming(s, giant, kind, quality);
        const damage =
          kind === 'bomb'
            ? 45 * sim.GIANT_BOMB_DAMAGE_MULT
            : kind === 'bullet'
              ? 12
              : quality
                ? 65
                : 60;
        expect(giant.hp).toBeCloseTo(beforeHp - damage);
        expect(s.events).toContainEqual({
          tick: 0,
          kind: 'hit',
          target: 0,
          dmg: damage,
          source: kind === 'bomb' ? 'bombs' : kind === 'bullet' ? 'gun' : 'heavy',
          super: quality,
        });
      }
      const s = arena();
      const giant = s.units[0]!;
      giant.classId = 'giant';
      giant.hp = sim.unitMaxHp(giant);
      s.units[3]!.pos = { ...giant.pos };
      fire(s, 3);
      expect(hitDamage(s, 0)).toEqual([8]);
      const stall = arena();
      stall.units[0]!.classId = 'giant';
      stall.units[0]!.pos = { x: 32, y: 4 };
      stall.units[0]!.bombs = 1;
      stall.units[0]!.bombsSuper = quality;
      sim.processAttacks(stall, new Map([[0, { ...idle, throwBomb: true, aim: { x: 35, y: 4 } }]]));
      for (let t = 0; t < sim.BOMB_FUSE_TICKS; t++) sim.updateProjectiles(stall, new Set());
      expect(hitDamage(stall, 'dessert')).toEqual([67.5]);
    }
  });

  it('all_classes_respawn_with_traits_without_items', () => {
    for (const classId of sim.CLASS_IDS)
      for (const quality of [false, true])
        for (const isBot of [false, true]) {
          const s = arena();
          const u = s.units[0]!;
          Object.assign(u, {
            classId,
            superBuddy: quality,
            isBot,
            hp: 1,
            carrying: 800,
            gun: { kind: 'heavy', super: true, ammoCooldownTicks: 5 },
            bombs: 5,
            bombsSuper: true,
            ninjaKnockReadyTick: 999,
          });
          s.crates.push({
            id: 800,
            pos: { ...u.pos },
            state: 'carried',
            kind: 'super',
            landTick: 0,
          });
          const speed = sim.unitMoveSpeed({ ...u, carrying: null });
          incoming(s, u, 'bullet');
          expect(u).toMatchObject({
            classId,
            superBuddy: quality,
            isBot,
            team: 'fruit',
            id: 0,
            hp: 0,
            deadUntilTick: sim.RESPAWN_TICKS,
            carrying: null,
            gun: null,
            bombs: 0,
            bombsSuper: false,
          });
          expect(s.crates[0]).toMatchObject({ id: 800, kind: 'super', state: 'ground' });
          s.tick = sim.RESPAWN_TICKS - 1;
          sim.updateRespawns(s);
          expect(u.hp).toBe(0);
          s.tick++;
          sim.updateRespawns(s);
          expect(u).toMatchObject({
            classId,
            superBuddy: quality,
            isBot,
            team: 'fruit',
            id: 0,
            hp: sim.unitMaxHp(u),
            deadUntilTick: null,
            carrying: null,
            gun: null,
            bombs: 0,
            bombsSuper: false,
            attackCooldownTicks: 0,
            ninjaKnockReadyTick: 0,
          });
          expect(sim.unitMoveSpeed(u)).toBe(speed);
          expect(s.units).toHaveLength(6);
          expect(s.events.filter((e) => e.kind === 'respawn')).toHaveLength(1);
        }
  });
});
