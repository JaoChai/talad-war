import {
  BOXER_MAX_HP,
  BOXER_SLAP_DMG,
  BOXER_SPEED_MULT,
  GIANT_BOMB_DAMAGE_MULT,
  GIANT_MAX_HP,
  GIANT_SPEED_MULT,
  DT,
  HEALER_AURA_HP_PER_SEC,
  HEALER_RADIUS,
  HEALER_SELF_HP_PER_SEC,
  HEALER_MAX_HP,
  HEALER_SPEED_MULT,
  NINJA_KNOCK_COOLDOWN_TICKS,
  NINJA_MAX_HP,
  NINJA_SPEED_MULT,
  SLAP_COOLDOWN_TICKS,
  SLAP_DMG,
} from './constants';
import { dropCrateAt } from './crates';
import { dist2 } from './geometry';
import { unitMaxHp } from './items';
import { unitDead } from './open';
import { liftTop, padCellAt, padCellCenter } from './pad';
import type { MatchState, Unit, UnitClass } from './types';

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

/** Phase 7, after projectiles: decide every heal before applying any HP change. */
export function updateClassHealing(s: MatchState): void {
  const living = s.units.filter((unit) => !unitDead(unit) && unit.hp > 0);
  const healers = living.filter((unit) => unit.classId === 'healer');
  const heals = living.map((unit) => {
    let rate = unit.classId === 'healer' ? HEALER_SELF_HP_PER_SEC : 0;
    for (const healer of healers) {
      if (
        healer.id !== unit.id &&
        healer.team === unit.team &&
        dist2(healer.pos, unit.pos) <= HEALER_RADIUS * HEALER_RADIUS
      ) {
        rate = Math.max(rate, HEALER_AURA_HP_PER_SEC);
      }
    }
    return { unit, hp: Math.min(unitMaxHp(unit), unit.hp + rate * DT) };
  });
  for (const { unit, hp } of heals) unit.hp = hp;
}

/** One unarmed attack: knock the occupied enemy column under the Ninja's centre. */
export function tryNinjaKnock(s: MatchState, unit: Unit): boolean {
  if (
    unit.classId !== 'ninja' ||
    unitDead(unit) ||
    unit.hp <= 0 ||
    unit.gun !== null ||
    unit.carrying !== null ||
    unit.attackCooldownTicks !== 0 ||
    s.tick < (unit.ninjaKnockReadyTick ?? 0)
  )
    return false;
  const padTeam = unit.team === 'fruit' ? 'dessert' : 'fruit';
  const pad = s.pads[padTeam];
  const col = padCellAt(pad, unit.pos);
  if (col === null) return false;
  const crateId = liftTop(pad, col);
  if (crateId === null) return false;
  dropCrateAt(s, crateId, padCellCenter(pad, col));
  unit.ninjaKnockReadyTick = s.tick + NINJA_KNOCK_COOLDOWN_TICKS;
  unit.attackCooldownTicks = SLAP_COOLDOWN_TICKS;
  s.events.push({
    tick: s.tick,
    kind: 'ninjaKnock',
    unitId: unit.id,
    team: unit.team,
    padTeam,
    col,
    crateId,
  });
  return true;
}
