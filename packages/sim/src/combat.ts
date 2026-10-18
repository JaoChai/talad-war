import {
  BOMB_FUSE_TICKS,
  BOMB_THROW_RANGE,
  DT,
  RESPAWN_TICKS,
  SLAP_COOLDOWN_TICKS,
  SLAP_RANGE,
  SPAWN_OFFSETS,
  STALL_RECTS,
  UNIT_RADIUS,
} from './constants';
import { tryNinjaKnock, unitBombDamageMult, unitSlapDamage } from './classes';
import { dropCrateAt } from './crates';
import { circleOverlapsRect, dist2, pointInRect } from './geometry';
import { bombStats, unitMaxHp, weaponStats } from './items';
import { OBSTACLES, stallCenter } from './map';
import { autoAimTarget } from './autoAim';
import { unitDead } from './open';
import type {
  GunSlot,
  MatchState,
  Projectile,
  Stall,
  Team,
  Unit,
  UnitInput,
  UnitId,
  Vec2,
  WeaponKind,
} from './types';

/**
 * Phase 7-8-10 combat. All functions mutate a fresh `step` clone.
 * Carrying disables attacks; damage drops the existing crate object. Dead
 * units do not act or get hit. Death clears equipment, not the super-buddy
 * trait. Respawn heals to the unit's own maximum after RESPAWN_TICKS.
 *
 * Guns/coconuts use explicit aim, auto-aim, then facing. Bullets preserve v1's
 * six samples per tick and lifetime. Coconuts use the same collision order
 * (obstacles, either stall, enemies), explode once on contact/range expiry,
 * and clamp their last travel step. Zero-direction coconuts expire harmlessly.
 * Bombs land immediately within throw range and explode after their fuse.
 * All blast damage uses centre distance / stall circle-rect overlap, without
 * friendly fire or splash line-of-sight occlusion. Projectile kind/quality,
 * never the current shooter/loadout, determines damage and event metadata.
 */
const IDLE_INPUT: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};

const BULLET_SUBSTEPS = 6; // v1: 0.15-unit samples at BULLET_SPEED

type DamageSource = WeaponKind | 'bombs' | 'slap';

function otherTeam(team: Team): Team {
  return team === 'fruit' ? 'dessert' : 'fruit';
}

/** Phase 7: cooldowns, attacks in unit-id order. Fresh shots act NEXT tick. */
export function processAttacks(s: MatchState, inputs: ReadonlyMap<UnitId, UnitInput>): Set<number> {
  const fresh = new Set<number>();
  for (const unit of s.units) {
    if (unitDead(unit)) continue;
    if (unit.attackCooldownTicks > 0) unit.attackCooldownTicks -= 1;
    if (unit.gun !== null && unit.gun.ammoCooldownTicks > 0) unit.gun.ammoCooldownTicks -= 1;

    const input = inputs.get(unit.id) ?? IDLE_INPUT;
    if (unit.carrying !== null) continue;

    if (input.fire) {
      if (unit.gun !== null) {
        if (unit.gun.ammoCooldownTicks === 0) {
          spawnShot(s, unit, unit.gun, input.aim, fresh);
          unit.gun.ammoCooldownTicks = weaponStats(unit.gun).cooldownTicks;
        }
      } else if (unit.attackCooldownTicks === 0) {
        if (!tryNinjaKnock(s, unit)) {
          slap(s, unit);
          unit.attackCooldownTicks = SLAP_COOLDOWN_TICKS;
        }
      }
    }
    if (input.throwBomb && unit.bombs > 0) {
      spawnBomb(s, unit, input.aim, fresh);
      unit.bombs -= 1;
      if (unit.bombs === 0) unit.bombsSuper = false;
    }
  }
  return fresh;
}

/** Phase 7: advance projectiles in id order, excluding this tick's shots. */
export function updateProjectiles(s: MatchState, fresh: ReadonlySet<number>): void {
  const alive: Projectile[] = [];
  for (const projectile of s.projectiles) {
    if (fresh.has(projectile.id)) {
      alive.push(projectile);
    } else if (projectile.kind !== 'bomb') {
      if (moveShot(s, projectile)) alive.push(projectile);
    } else {
      projectile.ttlTicks -= 1;
      if (projectile.ttlTicks <= 0) explode(s, projectile);
      else alive.push(projectile);
    }
  }
  s.projectiles = alive;
}

/** Phase 8: bring every unit whose deadUntilTick has arrived back at its stall. */
export function updateRespawns(s: MatchState): void {
  for (const unit of s.units) {
    if (unit.deadUntilTick === null || s.tick < unit.deadUntilTick) continue;
    const center = stallCenter(unit.team);
    const sign = unit.team === 'fruit' ? 1 : -1;
    const offset = SPAWN_OFFSETS[0];
    if (offset === undefined) throw new Error('updateRespawns: no spawn offsets defined');
    unit.pos = { x: center.x + sign * offset.x, y: center.y + sign * offset.y };
    unit.facing = unit.team === 'fruit' ? { x: 1, y: 0 } : { x: -1, y: 0 };
    unit.hp = unitMaxHp(unit);
    unit.gun = null;
    unit.bombs = 0;
    unit.bombsSuper = false;
    unit.carrying = null;
    unit.attackCooldownTicks = 0;
    if (unit.classId === 'ninja' || unit.ninjaKnockReadyTick !== undefined) {
      unit.ninjaKnockReadyTick = 0;
    }
    unit.deadUntilTick = null;
    s.events.push({
      tick: s.tick,
      kind: 'respawn',
      unitId: unit.id,
      team: unit.team,
      pos: { ...unit.pos },
    });
  }
}

/** Phase 10: both stalls reaching 0 HP in the same tick is a draw. */
export function updateWinner(s: MatchState): void {
  if (s.winner !== null) return;
  const fruitDown = s.stalls.fruit.hp <= 0;
  const dessertDown = s.stalls.dessert.hp <= 0;
  if (fruitDown && dessertDown) s.winner = 'draw';
  else if (fruitDown) s.winner = 'dessert';
  else if (dessertDown) s.winner = 'fruit';
  else return;
  s.events.push({ tick: s.tick, kind: 'matchOver', winner: s.winner });
}

function spawnShot(
  s: MatchState,
  unit: Unit,
  slot: GunSlot,
  aim: Vec2 | null,
  fresh: Set<number>,
): void {
  const stats = weaponStats(slot);
  const dir = attackDirection(s, unit, aim);
  const id = s.nextId++;
  const heavy = stats.kind === 'heavy';
  s.projectiles.push({
    id,
    team: unit.team,
    kind: heavy ? 'coconut' : 'bullet',
    super: slot.super === true,
    pos: { ...unit.pos },
    vel: { x: dir.x * stats.speed, y: dir.y * stats.speed },
    ttlTicks: Math.max(
      1,
      heavy
        ? Math.ceil(stats.range / (stats.speed * DT))
        : Math.round(stats.range / (stats.speed * DT)),
    ),
    ...(heavy ? { distanceLeft: stats.range } : {}),
  });
  fresh.add(id);
}

function spawnBomb(s: MatchState, unit: Unit, aim: Vec2 | null, fresh: Set<number>): void {
  const fallback = {
    x: unit.pos.x + unit.facing.x * BOMB_THROW_RANGE,
    y: unit.pos.y + unit.facing.y * BOMB_THROW_RANGE,
  };
  const target = aim ?? autoAimTarget(s, unit.id) ?? fallback;
  const dx = target.x - unit.pos.x;
  const dy = target.y - unit.pos.y;
  const len = Math.hypot(dx, dy);
  const pos =
    len <= BOMB_THROW_RANGE || len === 0
      ? { x: target.x, y: target.y }
      : {
          x: unit.pos.x + (dx / len) * BOMB_THROW_RANGE,
          y: unit.pos.y + (dy / len) * BOMB_THROW_RANGE,
        };
  const id = s.nextId++;
  s.projectiles.push({
    id,
    team: unit.team,
    kind: 'bomb',
    super: unit.bombsSuper === true,
    pos,
    vel: { x: 0, y: 0 },
    ttlTicks: BOMB_FUSE_TICKS,
  });
  fresh.add(id);
}

/** Unit direction of a shot: explicit aim, else auto-aim, else the facing. */
function attackDirection(s: MatchState, unit: Unit, aim: Vec2 | null): Vec2 {
  const target = aim ?? autoAimTarget(s, unit.id) ?? null;
  if (target !== null) {
    const dx = target.x - unit.pos.x;
    const dy = target.y - unit.pos.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) return { x: dx / len, y: dy / len };
  }
  const facingLen = Math.hypot(unit.facing.x, unit.facing.y);
  return facingLen === 0
    ? { x: 0, y: 0 }
    : { x: unit.facing.x / facingLen, y: unit.facing.y / facingLen };
}

/** Instant hit on the nearest enemy unit, else the enemy stall, within SLAP_RANGE. */
function slap(s: MatchState, unit: Unit): void {
  let target: Unit | null = null;
  let bestD2 = SLAP_RANGE * SLAP_RANGE;
  for (const enemy of s.units) {
    if (enemy.team === unit.team || unitDead(enemy)) continue;
    const d2 = dist2(unit.pos, enemy.pos);
    if (d2 > bestD2) continue;
    if (d2 === bestD2 && target !== null) continue;
    target = enemy;
    bestD2 = d2;
  }
  if (target !== null) {
    damageUnit(s, target, unitSlapDamage(unit), 'slap', false);
    return;
  }
  const enemyTeam = otherTeam(unit.team);
  const rect = STALL_RECTS[enemyTeam];
  const nx = Math.min(Math.max(unit.pos.x, rect.minX), rect.maxX);
  const ny = Math.min(Math.max(unit.pos.y, rect.minY), rect.maxY);
  if (dist2(unit.pos, { x: nx, y: ny }) <= SLAP_RANGE * SLAP_RANGE) {
    damageStall(s, s.stalls[enemyTeam], unitSlapDamage(unit), 'slap', false);
  }
}

/** Derive every fired weapon profile solely from its own kind and quality. */
function projectileWeaponStats(projectile: Projectile) {
  return weaponStats({
    ammoCooldownTicks: 0,
    kind: projectile.kind === 'coconut' ? 'heavy' : 'gun',
    super: projectile.super === true,
  });
}

/** Advance one tick; false removes the shot after its one contact/expiry. */
function moveShot(s: MatchState, shot: Projectile): boolean {
  const heavy = shot.kind === 'coconut';
  const stats = projectileWeaponStats(shot);
  const distance = Math.hypot(shot.vel.x, shot.vel.y) * DT;
  if (heavy && distance === 0) {
    shot.ttlTicks -= 1;
    return shot.ttlTicks > 0;
  }
  const travel = heavy
    ? Math.min(distance, Math.max(0, shot.distanceLeft ?? stats.range))
    : distance;
  const scale = heavy ? travel / distance : 1;
  const substeps = heavy ? Math.max(BULLET_SUBSTEPS, Math.ceil(travel / 0.15)) : BULLET_SUBSTEPS;
  const stepX = (shot.vel.x * DT * scale) / substeps;
  const stepY = (shot.vel.y * DT * scale) / substeps;
  for (let i = 0; i < substeps; i++) {
    shot.pos = { x: shot.pos.x + stepX, y: shot.pos.y + stepY };
    for (const rect of OBSTACLES) {
      if (pointInRect(shot.pos, rect)) {
        if (heavy) explode(s, shot);
        return false;
      }
    }
    for (const team of ['fruit', 'dessert'] as const) {
      if (pointInRect(shot.pos, STALL_RECTS[team])) {
        if (heavy) explode(s, shot);
        else if (team !== shot.team)
          damageStall(s, s.stalls[team], stats.damage, 'gun', shot.super === true);
        return false;
      }
    }
    for (const unit of s.units) {
      if (unit.team === shot.team || unitDead(unit)) continue;
      if (dist2(shot.pos, unit.pos) <= UNIT_RADIUS * UNIT_RADIUS) {
        if (heavy) explode(s, shot);
        else damageUnit(s, unit, stats.damage, 'gun', shot.super === true);
        return false;
      }
    }
  }
  shot.ttlTicks -= 1;
  if (heavy) {
    shot.distanceLeft = Math.max(0, (shot.distanceLeft ?? stats.range) - travel);
    if (shot.distanceLeft === 0 || shot.ttlTicks <= 0) {
      explode(s, shot);
      return false;
    }
  }
  return shot.ttlTicks > 0;
}

function explode(s: MatchState, projectile: Projectile): void {
  const stats =
    projectile.kind === 'bomb'
      ? bombStats(projectile.super === true)
      : projectileWeaponStats(projectile);
  const source = projectile.kind === 'bomb' ? 'bombs' : 'heavy';
  const quality = projectile.super === true;
  const enemyTeam = otherTeam(projectile.team);
  for (const unit of s.units) {
    if (unit.team === projectile.team || unitDead(unit)) continue;
    if (dist2(projectile.pos, unit.pos) <= stats.radius * stats.radius) {
      damageUnit(s, unit, stats.damage, source, quality);
    }
  }
  if (circleOverlapsRect(projectile.pos, stats.radius, STALL_RECTS[enemyTeam])) {
    damageStall(s, s.stalls[enemyTeam], stats.damage * stats.stallMult, source, quality);
  }
  s.events.push({
    tick: s.tick,
    kind: 'explosion',
    pos: { ...projectile.pos },
    source,
    super: quality,
  });
}

function damageUnit(
  s: MatchState,
  unit: Unit,
  dmg: number,
  source: DamageSource,
  quality: boolean,
): void {
  if (unitDead(unit)) return;
  if (source === 'bombs') dmg *= unitBombDamageMult(unit);
  unit.hp = Math.max(0, unit.hp - dmg);
  if (unit.carrying !== null) dropCrateAt(s, unit.carrying, unit.pos, unit.id);
  s.events.push({ tick: s.tick, kind: 'hit', target: unit.id, dmg, source, super: quality });
  if (unit.hp <= 0) killUnit(s, unit);
}

function killUnit(s: MatchState, unit: Unit): void {
  unit.carrying = null;
  unit.gun = null;
  unit.bombs = 0;
  unit.bombsSuper = false;
  unit.deadUntilTick = s.tick + RESPAWN_TICKS;
  s.events.push({
    tick: s.tick,
    kind: 'death',
    unitId: unit.id,
    team: unit.team,
    pos: { ...unit.pos },
  });
}

function damageStall(
  s: MatchState,
  stall: Stall,
  dmg: number,
  source: DamageSource,
  quality: boolean,
): void {
  stall.hp = Math.max(0, stall.hp - dmg);
  s.events.push({ tick: s.tick, kind: 'hit', target: stall.team, dmg, source, super: quality });
}
