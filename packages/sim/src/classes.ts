import {
  BOXER_MAX_HP,
  BOXER_SLAP_DMG,
  BOXER_SPEED_MULT,
  GIANT_BOMB_DAMAGE_MULT,
  GIANT_MAX_HP,
  GIANT_SPEED_MULT,
  HEALER_MAX_HP,
  HEALER_SPEED_MULT,
  NINJA_MAX_HP,
  NINJA_SPEED_MULT,
  SLAP_DMG,
} from './constants';
import type { Unit, UnitClass } from './types';

/** Stable shared pick order; never depend on object iteration or team identity. */
export const CLASS_IDS: readonly UnitClass[] = Object.freeze(['boxer', 'healer', 'ninja', 'giant']);

export interface ClassStats {
  maxHp: number;
  speedMult: number;
  slapDamage: number;
  bombDamageMult: number;
}

const PROFILES: Readonly<Record<UnitClass, ClassStats>> = Object.freeze({
  boxer: Object.freeze({
    maxHp: BOXER_MAX_HP,
    speedMult: BOXER_SPEED_MULT,
    slapDamage: BOXER_SLAP_DMG,
    bombDamageMult: 1,
  }),
  healer: Object.freeze({
    maxHp: HEALER_MAX_HP,
    speedMult: HEALER_SPEED_MULT,
    slapDamage: SLAP_DMG,
    bombDamageMult: 1,
  }),
  ninja: Object.freeze({
    maxHp: NINJA_MAX_HP,
    speedMult: NINJA_SPEED_MULT,
    slapDamage: SLAP_DMG,
    bombDamageMult: 1,
  }),
  giant: Object.freeze({
    maxHp: GIANT_MAX_HP,
    speedMult: GIANT_SPEED_MULT,
    slapDamage: SLAP_DMG,
    bombDamageMult: GIANT_BOMB_DAMAGE_MULT,
  }),
});

/** Shared immutable base profile; quality and equipment are handled separately. */
export function classStats(classId: UnitClass): ClassStats {
  return PROFILES[classId];
}

export function unitSlapDamage(unit: Unit): number {
  return unit.classId === undefined ? SLAP_DMG : classStats(unit.classId).slapDamage;
}

export function unitBombDamageMult(unit: Unit): number {
  return unit.classId === undefined ? 1 : classStats(unit.classId).bombDamageMult;
}
