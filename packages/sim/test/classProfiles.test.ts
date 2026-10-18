import { expect, it } from 'vitest';
import {
  BOXER_MAX_HP,
  BOXER_SLAP_DMG,
  BOXER_SPEED_MULT,
  CLASS_IDS,
  CLASS_SUPER_HP_MULT,
  CLASS_SUPER_SPEED_MULT,
  GIANT_BOMB_DAMAGE_MULT,
  GIANT_MAX_HP,
  GIANT_SPEED_MULT,
  HEALER_MAX_HP,
  HEALER_SPEED_MULT,
  NINJA_MAX_HP,
  NINJA_SPEED_MULT,
  bombStats,
  classStats,
  createMatch,
  unitBombDamageMult,
  unitMaxHp,
  unitMoveSpeed,
  unitSlapDamage,
  weaponStats,
} from '../src/index';
import type { ClassStats, Unit, UnitClass } from '../src/index';

// Expectations map class constants independently of the profile implementation.
const profiles: Record<UnitClass, ClassStats> = {
  boxer: {
    maxHp: BOXER_MAX_HP,
    speedMult: BOXER_SPEED_MULT,
    slapDamage: BOXER_SLAP_DMG,
    bombDamageMult: 1,
  },
  healer: { maxHp: HEALER_MAX_HP, speedMult: HEALER_SPEED_MULT, slapDamage: 8, bombDamageMult: 1 },
  ninja: { maxHp: NINJA_MAX_HP, speedMult: NINJA_SPEED_MULT, slapDamage: 8, bombDamageMult: 1 },
  giant: {
    maxHp: GIANT_MAX_HP,
    speedMult: GIANT_SPEED_MULT,
    slapDamage: 8,
    bombDamageMult: GIANT_BOMB_DAMAGE_MULT,
  },
};

it('class_order_and_profiles_use_exported_constants', () => {
  const basic = createMatch(1).units[0]!;
  expect(CLASS_IDS).toEqual(['boxer', 'healer', 'ninja', 'giant']);
  expect(Object.isFrozen(CLASS_IDS)).toBe(true);
  for (const classId of CLASS_IDS) {
    const unit: Unit = { ...basic, classId };
    const expected = profiles[classId];
    expect(classStats(classId)).toEqual(expected);
    expect(Object.isFrozen(classStats(classId))).toBe(true);
    expect(unitMaxHp(unit)).toBe(expected.maxHp);
    expect(unitMoveSpeed(unit)).toBe(6 * expected.speedMult);
    expect(unitSlapDamage(unit)).toBe(expected.slapDamage);
    expect(unitBombDamageMult(unit)).toBe(expected.bombDamageMult);
  }
  expect(unitMaxHp({ ...basic, classId: 'boxer' })).toBeGreaterThan(100);
  expect(unitMoveSpeed({ ...basic, classId: 'boxer' })).toBeGreaterThan(6);
  expect(unitSlapDamage({ ...basic, classId: 'boxer' })).toBeGreaterThan(8);
  expect(unitMaxHp({ ...basic, classId: 'ninja' })).toBeLessThan(100);
  expect(unitMoveSpeed({ ...basic, classId: 'ninja' })).toBeGreaterThan(6);
  expect(unitMaxHp({ ...basic, classId: 'giant' })).toBeGreaterThan(100);
  expect(unitMoveSpeed({ ...basic, classId: 'giant' })).toBeLessThan(6);
  expect(unitBombDamageMult({ ...basic, classId: 'giant' })).toBeLessThan(1);
});

it('super_class_profile_does_not_reuse_basic_super_profile', () => {
  const basic = createMatch(1).units[0]!;
  for (const classId of CLASS_IDS) {
    const unit: Unit = { ...basic, classId, superBuddy: true };
    const expected = profiles[classId];
    expect(unitMaxHp(unit)).toBe(Math.round(expected.maxHp * CLASS_SUPER_HP_MULT));
    expect(unitMoveSpeed(unit)).toBe(6 * expected.speedMult * CLASS_SUPER_SPEED_MULT);
    expect(unitSlapDamage(unit)).toBe(expected.slapDamage);
    expect(unitBombDamageMult(unit)).toBe(expected.bombDamageMult);
    expect(classStats(classId)).toEqual(expected);
  }
});

it('basic_profiles_and_equipment_are_unchanged', () => {
  const s = createMatch(1);
  const basic = s.units[0]!;
  for (const unit of s.units) {
    expect(unit).not.toHaveProperty('classId');
    expect(unit).not.toHaveProperty('ninjaKnockReadyTick');
    expect(unit).not.toHaveProperty('superBuddy');
  }
  for (const superBuddy of [undefined, false, true]) {
    const unit = { ...basic, superBuddy };
    expect(unitMaxHp(unit)).toBe(superBuddy ? 101 : 100);
    expect(unitMoveSpeed(unit)).toBe(superBuddy ? 6 * 1.01 : 6);
    expect(unitMoveSpeed({ ...unit, carrying: 900 })).toBe(superBuddy ? 4 * 1.01 : 4);
    expect(unitSlapDamage(unit)).toBe(8);
    expect(unitBombDamageMult(unit)).toBe(1);
  }
  const gun = {
    kind: 'gun',
    damage: 12,
    range: 9,
    cooldownTicks: 6,
    speed: 18,
    radius: 0,
    stallMult: 1,
  };
  const heavy = {
    kind: 'heavy',
    damage: 60,
    range: 9,
    cooldownTicks: 30,
    speed: 12,
    radius: 2.4,
    stallMult: 0.25,
  };
  expect(weaponStats({ ammoCooldownTicks: 0 })).toEqual(gun);
  expect(weaponStats({ kind: 'gun', super: true, ammoCooldownTicks: 0 })).toEqual({
    ...gun,
    range: 9.9,
    cooldownTicks: 5,
  });
  expect(weaponStats({ kind: 'heavy', ammoCooldownTicks: 0 })).toEqual(heavy);
  expect(weaponStats({ kind: 'heavy', super: true, ammoCooldownTicks: 0 })).toEqual({
    ...heavy,
    damage: 65,
  });
  expect(bombStats(false)).toEqual({ damage: 45, radius: 2.2, stallMult: 1.5 });
  expect(bombStats(true)).toEqual({ damage: 45, radius: 2.25, stallMult: 1.5 });
  for (const classId of CLASS_IDS) {
    for (const superBuddy of [false, true]) {
      const unit: Unit = { ...basic, classId, superBuddy, gun: { ammoCooldownTicks: 0 }, bombs: 3 };
      expect(weaponStats(unit.gun!)).toEqual(gun);
      expect(bombStats(unit.bombsSuper === true)).toEqual({
        damage: 45,
        radius: 2.2,
        stallMult: 1.5,
      });
    }
  }
});

it('class_carry_speed_uses_locked_base', () => {
  const basic = createMatch(1).units[0]!;
  for (const classId of CLASS_IDS) {
    for (const carrying of [0, 900]) {
      for (const superBuddy of [false, true]) {
        const unit: Unit = { ...basic, classId, carrying, superBuddy };
        expect(unitMoveSpeed(unit)).toBe(
          4 * profiles[classId].speedMult * (superBuddy ? CLASS_SUPER_SPEED_MULT : 1),
        );
      }
    }
  }
});
