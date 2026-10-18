import {
  BOMB_DMG,
  BOMB_RADIUS,
  BOMB_STALL_MULT,
  BULLET_SPEED,
  CARRY_SPEED,
  CLASS_SUPER_HP_MULT,
  CLASS_SUPER_SPEED_MULT,
  COCONUT_SPEED,
  GUN_COOLDOWN_TICKS,
  GUN_DMG,
  GUN_RANGE,
  HEAVY_COOLDOWN_TICKS,
  HEAVY_DMG,
  HEAVY_RADIUS,
  HEAVY_RANGE,
  HEAVY_STALL_MULT,
  SUPER_BOMB_RADIUS,
  SUPER_BUDDY_MAX_HP,
  SUPER_BUDDY_SPEED_MULT,
  SUPER_GUN_COOLDOWN_TICKS,
  SUPER_GUN_RANGE,
  SUPER_HEAVY_DMG,
  UNIT_MAX_HP,
  UNIT_SPEED,
} from './constants';
import { classStats } from './classes';
import type { GunSlot, Unit, WeaponKind } from './types';

/** Equipment quality is local to its slot, never inherited from the unit. */
export function weaponStats(slot: GunSlot): {
  kind: WeaponKind;
  damage: number;
  range: number;
  cooldownTicks: number;
  speed: number;
  radius: number;
  stallMult: number;
} {
  if (slot.kind === 'heavy') {
    return {
      kind: 'heavy',
      damage: slot.super === true ? SUPER_HEAVY_DMG : HEAVY_DMG,
      range: HEAVY_RANGE,
      cooldownTicks: HEAVY_COOLDOWN_TICKS,
      speed: COCONUT_SPEED,
      radius: HEAVY_RADIUS,
      stallMult: HEAVY_STALL_MULT,
    };
  }
  return {
    kind: 'gun',
    damage: GUN_DMG,
    range: slot.super === true ? SUPER_GUN_RANGE : GUN_RANGE,
    cooldownTicks: slot.super === true ? SUPER_GUN_COOLDOWN_TICKS : GUN_COOLDOWN_TICKS,
    speed: BULLET_SPEED,
    radius: 0,
    stallMult: 1,
  };
}

export function bombStats(superBomb: boolean): {
  damage: number;
  radius: number;
  stallMult: number;
} {
  return {
    damage: BOMB_DMG,
    radius: superBomb ? SUPER_BOMB_RADIUS : BOMB_RADIUS,
    stallMult: BOMB_STALL_MULT,
  };
}

export function unitMaxHp(unit: Unit): number {
  if (unit.classId !== undefined) {
    return Math.round(
      classStats(unit.classId).maxHp * (unit.superBuddy === true ? CLASS_SUPER_HP_MULT : 1),
    );
  }
  return unit.superBuddy === true ? SUPER_BUDDY_MAX_HP : UNIT_MAX_HP;
}

export function unitMoveSpeed(unit: Unit): number {
  const base = unit.carrying === null ? UNIT_SPEED : CARRY_SPEED;
  if (unit.classId !== undefined) {
    return (
      base *
      classStats(unit.classId).speedMult *
      (unit.superBuddy === true ? CLASS_SUPER_SPEED_MULT : 1)
    );
  }
  return base * (unit.superBuddy === true ? SUPER_BUDDY_SPEED_MULT : 1);
}
