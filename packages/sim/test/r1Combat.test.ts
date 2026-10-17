import { describe, expect, it } from 'vitest';
import {
  autoAimTarget,
  bombStats,
  createMatch,
  processAttacks,
  step,
  unitMaxHp,
  unitMoveSpeed,
  updateProjectiles,
  weaponStats,
} from '../src/index';
import type { MatchState, Projectile, Unit, UnitInput, Vec2 } from '../src/index';

const idle: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};

function arena(): MatchState {
  const s = createMatch(1);
  for (const u of s.units) {
    u.isBot = false;
    u.pos = { x: 2, y: 2 + u.id };
  }
  unit(s, 0).pos = { x: 12, y: 12 };
  return s;
}

function unit(s: MatchState, id: number): Unit {
  const u = s.units.find((u) => u.id === id);
  if (!u) throw new Error(`Missing unit ${id}`);
  return u;
}

function shot(s: MatchState, patch: Partial<UnitInput> = { fire: true }): Projectile {
  const fresh = processAttacks(s, new Map([[0, { ...idle, ...patch }]]));
  updateProjectiles(s, fresh);
  const p = s.projectiles.at(-1);
  if (!p) throw new Error('Expected a projectile');
  return p;
}

function advance(s: MatchState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    s.tick++;
    updateProjectiles(s, new Set());
  }
}

function heavy(s: MatchState, quality = false): void {
  unit(s, 0).gun = { kind: 'heavy', super: quality, ammoCooldownTicks: 0 };
}

function explosions(s: MatchState) {
  return s.events.filter((e) => e.kind === 'explosion');
}

describe('R1 combat profiles and independent perks', () => {
  it('normal_stats_equal_v1', () => {
    expect(weaponStats({ ammoCooldownTicks: 0 })).toEqual({
      kind: 'gun',
      damage: 12,
      range: 9,
      cooldownTicks: 6,
      speed: 18,
      radius: 0,
      stallMult: 1,
    });
    expect(weaponStats({ kind: 'gun', super: false, ammoCooldownTicks: 0 })).toEqual(
      weaponStats({ ammoCooldownTicks: 0 }),
    );
    expect(weaponStats({ kind: 'heavy', ammoCooldownTicks: 0 })).toEqual({
      kind: 'heavy',
      damage: 60,
      range: 9,
      cooldownTicks: 30,
      speed: 12,
      radius: 2.4,
      stallMult: 0.25,
    });
    expect(weaponStats({ kind: 'heavy', super: true, ammoCooldownTicks: 0 })).toEqual({
      kind: 'heavy',
      damage: 65,
      range: 9,
      cooldownTicks: 30,
      speed: 12,
      radius: 2.4,
      stallMult: 0.25,
    });
    expect(bombStats(false)).toEqual({ damage: 45, radius: 2.2, stallMult: 1.5 });
    expect(bombStats(true)).toEqual({ damage: 45, radius: 2.25, stallMult: 1.5 });
    const s = arena();
    expect(unitMaxHp(unit(s, 0))).toBe(100);
    expect(unitMoveSpeed(unit(s, 0))).toBe(6);
    unit(s, 0).carrying = 900;
    expect(unitMoveSpeed(unit(s, 0))).toBe(4);
    // Super-buddy is not an equipment upgrade.
    unit(s, 0).superBuddy = true;
    expect(weaponStats({ ammoCooldownTicks: 0 }).damage).toBe(12);
    expect(bombStats(unit(s, 0).bombsSuper === true).radius).toBe(2.2);
  });

  it('super_gun_fires_after_5_ticks_and_aims_to_10_8', () => {
    const s = arena();
    unit(s, 0).pos = { x: 0, y: 0 };
    unit(s, 0).gun = { ammoCooldownTicks: 0, super: true };
    unit(s, 3).pos = { x: 9.9, y: 0 };
    unit(s, 4).pos = { x: 0, y: 9.9 }; // equal distance; lower ID wins
    unit(s, 5).pos = { x: 35, y: 22 }; // outside both aim ranges
    expect(weaponStats(unit(s, 0).gun!)).toMatchObject({
      range: 9.9,
      cooldownTicks: 5,
      damage: 12,
    });
    expect(autoAimTarget(s, 0)).toEqual({ x: 9.9, y: 0 });
    unit(s, 3).pos.x += 0.0001;
    unit(s, 4).pos.y += 0.0001;
    expect(autoAimTarget(s, 0)).toBeNull();
    unit(s, 3).pos = { x: 9.9, y: 0 };
    const p = shot(s);
    expect(p).toMatchObject({ kind: 'bullet', super: true, ttlTicks: 11, vel: { x: 18, y: 0 } });
    advance(s, 11);
    expect(unit(s, 3).hp).toBe(88);
    expect(s.events).toContainEqual(
      expect.objectContaining({ kind: 'hit', source: 'gun', super: true, dmg: 12 }),
    );
    for (let t = 1; t < 5; t++) {
      expect(processAttacks(s, new Map([[0, { ...idle, fire: true }]])).size).toBe(0);
    }
    expect(processAttacks(s, new Map([[0, { ...idle, fire: true }]])).size).toBe(1);
    unit(s, 0).gun = { ammoCooldownTicks: 0 };
    expect(autoAimTarget(s, 0)).toBeNull(); // ordinary gun still stops at 9
  });

  it('coconut_fires_after_30_ticks_and_uses_gun_target_priority', () => {
    const s = arena();
    heavy(s);
    unit(s, 0).pos = { x: 31, y: 7 };
    unit(s, 3).pos = { x: 31, y: 16 }; // unit preferred over closer stall
    unit(s, 4).pos = { x: 22, y: 7 }; // tie at exactly 9; ID 3 wins
    expect(autoAimTarget(s, 0)).toEqual({ x: 31, y: 16 });
    const p = shot(s);
    expect(p).toMatchObject({
      kind: 'coconut',
      super: false,
      distanceLeft: 9,
      ttlTicks: 15,
      vel: { x: 0, y: 12 },
    });
    for (let t = 1; t < 30; t++)
      expect(processAttacks(s, new Map([[0, { ...idle, fire: true }]])).size).toBe(0);
    expect(processAttacks(s, new Map([[0, { ...idle, fire: true }]])).size).toBe(1);
    unit(s, 3).pos.y += 0.001;
    unit(s, 4).pos.x -= 0.001;
    expect(autoAimTarget(s, 0)).toEqual({ x: 35, y: 4 });
    const explicit = arena();
    heavy(explicit);
    unit(explicit, 3).pos = { x: 14, y: 12 };
    expect(shot(explicit, { fire: true, aim: { x: 12, y: 16 } }).vel).toEqual({ x: 0, y: 12 });
    const fallback = arena();
    heavy(fallback);
    unit(fallback, 0).facing = { x: -2, y: 0 };
    expect(shot(fallback).vel).toEqual({ x: -12, y: 0 });
  });

  it('coconut_contact_and_range_expiry_explode_once', () => {
    const contact = arena();
    heavy(contact);
    unit(contact, 3).pos = { x: 13, y: 12 };
    shot(contact);
    advance(contact, 20);
    expect(explosions(contact)).toHaveLength(1);
    expect(contact.projectiles).toHaveLength(0);
    expect(unit(contact, 3).hp).toBe(40);
    const throughFriend = arena();
    heavy(throughFriend);
    unit(throughFriend, 1).pos = { x: 13, y: 12 };
    unit(throughFriend, 3).pos = { x: 16, y: 12 };
    shot(throughFriend);
    advance(throughFriend, 20);
    expect(unit(throughFriend, 1).hp).toBe(100);
    expect(unit(throughFriend, 3).hp).toBe(40);
    expect(explosions(throughFriend)).toHaveLength(1);
    expect((explosions(throughFriend)[0]!.pos as Vec2).x).toBeCloseTo(15.6, 9);
    for (const remaining of [9, 1.37, 0.23]) {
      const s = arena();
      heavy(s);
      const p = shot(s, { fire: true, aim: { x: 30, y: 12 } });
      p.distanceLeft = remaining; // non-integral final tick/substep, independent of configured range
      advance(s, Math.ceil(remaining / 0.6) - 1);
      expect(explosions(s)).toHaveLength(0);
      advance(s, 1);
      expect(s.projectiles).toHaveLength(0);
      expect(explosions(s)).toHaveLength(1);
      const pos = explosions(s)[0]!.pos as Vec2;
      expect(pos.x).toBeCloseTo(12 + remaining, 10);
      expect(pos.y).toBe(12);
      advance(s, 20);
      expect(explosions(s)).toHaveLength(1);
    }
  });

  it('blast_hits_all_enemies_not_friends_and_stall_for_60_or_84', () => {
    for (const quality of [false, true]) {
      const s = arena();
      heavy(s, quality);
      unit(s, 0).pos = { x: 31, y: 4 };
      const p = shot(s, { fire: true, aim: { x: 35, y: 4 } });
      p.pos = { x: 32.4, y: 4 };
      p.distanceLeft = 0.1; // expires at 32.5; enemy stall in splash radius
      unit(s, 1).pos = { x: 32.5, y: 4 }; // friendly cannot block/take damage
      unit(s, 3).pos = { x: 32.5, y: 1.6 }; // exact radius edge
      unit(s, 4).pos = { x: 32.5, y: 5 }; // second victim
      unit(s, 5).pos = { x: 32.5, y: 1.5999 }; // just outside
      advance(s, 1);
      expect(unit(s, 3).hp).toBe(quality ? 35 : 40);
      expect(unit(s, 4).hp).toBe(quality ? 35 : 40);
      expect(unit(s, 5).hp).toBe(100);
      expect(unit(s, 1).hp).toBe(100);
      expect(s.stalls.fruit.hp).toBe(6500);
      expect(s.stalls.dessert.hp).toBe(6500 - (quality ? 16.25 : 15));
      expect(explosions(s)).toEqual([expect.objectContaining({ source: 'heavy', super: quality })]);
      expect(s.events.filter((e) => e.kind === 'hit')).toEqual([
        expect.objectContaining({
          target: 3,
          dmg: quality ? 65 : 60,
          source: 'heavy',
          super: quality,
        }),
        expect.objectContaining({
          target: 4,
          dmg: quality ? 65 : 60,
          source: 'heavy',
          super: quality,
        }),
        expect.objectContaining({
          target: 'dessert',
          dmg: quality ? 16.25 : 15,
          source: 'heavy',
          super: quality,
        }),
      ]);
    }
    // Either stall stops travel; the own stall takes no friendly damage.
    for (const [pos, aim] of [
      [
        { x: 35, y: 7 },
        { x: 35, y: 4 },
      ],
      [
        { x: 5, y: 17 },
        { x: 5, y: 20 },
      ],
    ] as const) {
      const s = arena();
      heavy(s);
      unit(s, 0).pos = { ...pos };
      shot(s, { fire: true, aim });
      advance(s, 20);
      expect(explosions(s)).toHaveLength(1);
      expect(s.stalls.fruit.hp).toBe(6500);
      expect(s.stalls.dessert.hp).toBe(pos.x === 35 ? 6485 : 6500);
    }
  });

  it('walls_stop_coconut_and_zero_direction_is_harmless', () => {
    const s = arena();
    heavy(s);
    unit(s, 0).pos = { x: 12.05, y: 4.5 };
    unit(s, 3).pos = { x: 19, y: 4.5 };
    shot(s, { fire: true, aim: { x: 24, y: 4.5 } });
    advance(s, 20);
    expect(explosions(s)).toHaveLength(1);
    expect((explosions(s)[0]!.pos as Vec2).x).toBeCloseTo(14.05, 9); // first 0.1-unit sample inside wall
    expect(unit(s, 3).hp).toBe(100);
    expect(s.projectiles).toHaveLength(0);
    const zero = arena();
    heavy(zero);
    unit(zero, 0).facing = { x: 0, y: 0 };
    const p = shot(zero, { fire: true, aim: { x: 12, y: 12 } });
    expect(p.vel).toEqual({ x: 0, y: 0 });
    unit(zero, 3).pos = { x: 12, y: 12 };
    advance(zero, 15);
    expect(zero.projectiles).toHaveLength(0);
    expect(zero.events).toHaveLength(0);
    expect(unit(zero, 3).hp).toBe(100);
  });

  it('fresh_projectiles_wait_one_tick', () => {
    for (const kind of ['gun', 'heavy', 'bombs'] as const) {
      const s = arena();
      unit(s, 0).gun = kind === 'bombs' ? null : { kind, super: true, ammoCooldownTicks: 0 };
      unit(s, 0).bombs = 1;
      unit(s, 0).bombsSuper = true;
      const p = shot(s, {
        fire: kind !== 'bombs',
        throwBomb: kind === 'bombs',
        aim: { x: 20, y: 12 },
      });
      expect(p.pos).toEqual({ x: kind === 'bombs' ? 19 : 12, y: 12 });
      expect(p.ttlTicks).toBe(kind === 'bombs' ? 24 : kind === 'gun' ? 11 : 15);
      advance(s, 1);
      expect(p.ttlTicks).toBe(kind === 'bombs' ? 23 : kind === 'gun' ? 10 : 14);
      expect(p.pos.x).toBeCloseTo(kind === 'bombs' ? 19 : kind === 'gun' ? 12.9 : 12.6, 9);
    }
  });

  it('projectile_super_survives_shooter_death_or_replacement', () => {
    for (const kind of ['gun', 'heavy', 'bombs'] as const) {
      for (const dies of [false, true]) {
        let s = arena();
        const u = unit(s, 0);
        u.gun = kind === 'bombs' ? null : { kind, super: true, ammoCooldownTicks: 0 };
        u.bombs = 1;
        u.bombsSuper = true;
        u.hp = 8;
        unit(s, 3).pos = { x: 16, y: 12 };
        const p = shot(s, {
          fire: kind !== 'bombs',
          throwBomb: kind === 'bombs',
          aim: { x: 16, y: 12 },
        });
        expect(p.super).toBe(true);
        if (dies) {
          unit(s, 4).pos = { x: 12, y: 13 };
          s = step(s, new Map([[4, { ...idle, fire: true }]]));
          expect(unit(s, 0).deadUntilTick).toBe(101);
        } else {
          u.gun = { ammoCooldownTicks: 0 }; // downgrade after firing
          u.bombs = 3;
          u.bombsSuper = false;
        }
        advance(s, 25);
        expect(unit(s, 3).hp).toBe(kind === 'gun' ? 88 : kind === 'heavy' ? 35 : 55);
        expect(s.events).toContainEqual(
          expect.objectContaining({ kind: 'hit', target: 3, source: kind, super: true }),
        );
      }
    }
  });

  it('super_bomb_radius_2_8_and_last_throw_snapshots_quality', () => {
    const s = arena();
    const u = unit(s, 0);
    u.bombs = 1;
    u.bombsSuper = true;
    u.gun = { kind: 'heavy', ammoCooldownTicks: 17 };
    unit(s, 0).pos = { x: 4, y: 12 };
    unit(s, 3).pos = { x: 2.25, y: 12 };
    unit(s, 4).pos = { x: 2.2501, y: 12 };
    unit(s, 1).pos = { x: 0, y: 12 };
    const p = shot(s, { throwBomb: true, aim: { x: 0, y: 12 } });
    expect(p.super).toBe(true);
    expect(u.bombs).toBe(0);
    expect(u.bombsSuper).toBe(false);
    expect(u.gun).toEqual({ kind: 'heavy', ammoCooldownTicks: 16 });
    advance(s, 23);
    expect(explosions(s)).toHaveLength(0);
    advance(s, 1);
    expect(unit(s, 3).hp).toBe(55);
    expect(unit(s, 4).hp).toBe(100);
    expect(unit(s, 1).hp).toBe(100);
    expect(explosions(s)).toEqual([expect.objectContaining({ source: 'bombs', super: true })]);
    // Heavy quality and super-buddy do not upgrade a normal bomb stock.
    u.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    u.superBuddy = true;
    u.bombs = 1;
    expect(shot(s, { throwBomb: true, aim: { x: 0, y: 12 } }).super).toBe(false);
    advance(s, 24);
    expect(unit(s, 3).hp).toBe(55);
  });

  it('death_clears_slots_not_superBuddy_and_respawn_hp_125', () => {
    let s = arena();
    const u = unit(s, 0);
    u.superBuddy = true;
    u.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    u.bombs = 5;
    u.bombsSuper = true;
    u.carrying = 900;
    u.hp = 8;
    s.crates.push({ id: 900, kind: 'super', state: 'carried', pos: { ...u.pos }, landTick: 0 });
    // Carrying blocks both attacks without consuming or changing slot quality.
    s = step(s, new Map([[0, { ...idle, fire: true, throwBomb: true }]]));
    expect(s.projectiles).toHaveLength(0);
    expect(unit(s, 0)).toMatchObject({
      bombs: 5,
      bombsSuper: true,
      gun: { kind: 'heavy', super: true },
    });
    unit(s, 3).pos = { x: 13, y: 12 };
    s = step(s, new Map([[3, { ...idle, fire: true }]]));
    expect(unit(s, 0)).toMatchObject({
      hp: 0,
      gun: null,
      bombs: 0,
      bombsSuper: false,
      carrying: null,
      superBuddy: true,
      deadUntilTick: 102,
    });
    expect(s.crates.find((c) => c.id === 900)).toEqual({
      id: 900,
      kind: 'super',
      state: 'ground',
      pos: { x: 12, y: 12 },
      landTick: 0,
    });
    expect(s.events).toContainEqual(
      expect.objectContaining({ kind: 'hit', source: 'slap', super: false, dmg: 8 }),
    );
    for (let i = 0; i < 99; i++) s = step(s, new Map());
    expect(unit(s, 0).deadUntilTick).toBe(102);
    s = step(s, new Map());
    expect(unit(s, 0)).toMatchObject({
      hp: 101,
      gun: null,
      bombs: 0,
      bombsSuper: false,
      carrying: null,
      superBuddy: true,
      deadUntilTick: null,
      pos: { x: 5, y: 17.2 },
    });
    expect(unitMaxHp(unit(s, 0))).toBe(101);
  });

  it('superBuddy_moves_1_1_times_base_and_carry_speed', () => {
    for (const superBuddy of [false, true]) {
      for (const carrying of [null, 900]) {
        const s = arena();
        unit(s, 0).superBuddy = superBuddy;
        unit(s, 0).carrying = carrying;
        // Equipment does not grant the persistent speed/HP perk.
        unit(s, 0).gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
        unit(s, 0).bombsSuper = true;
        expect(unitMaxHp(unit(s, 0))).toBe(superBuddy ? 101 : 100);
        expect(unitMoveSpeed(unit(s, 0))).toBe(
          (carrying === null ? 6 : 4) * (superBuddy ? 1.01 : 1),
        );
        const next = step(s, new Map([[0, { ...idle, move: { x: 1, y: 0 } }]]));
        expect(unit(next, 0).pos.x - 12).toBeCloseTo(
          (carrying === null ? 0.3 : 0.2) * (superBuddy ? 1.01 : 1),
          10,
        );
        expect(unit(s, 0).pos).toEqual({ x: 12, y: 12 }); // step remains pure
      }
    }
  });
});
