import {
  BOMB_DMG,
  BOMB_FUSE_TICKS,
  BOMB_RADIUS,
  BOMB_STALL_MULT,
  BOMB_THROW_RANGE,
  BULLET_SPEED,
  DT,
  GUN_COOLDOWN_TICKS,
  GUN_DMG,
  GUN_RANGE,
  RESPAWN_TICKS,
  SLAP_COOLDOWN_TICKS,
  SLAP_DMG,
  SLAP_RANGE,
  SPAWN_OFFSETS,
  STALL_RECTS,
  UNIT_MAX_HP,
  UNIT_RADIUS,
} from './constants';
import { dropCrateAt } from './crates';
import { circleOverlapsRect, dist2 } from './geometry';
import { OBSTACLES, stallCenter } from './map';
import { autoAimTarget } from './autoAim';
import { unitDead } from './open';
import type { MatchState, Projectile, Stall, Team, Unit, UnitInput, UnitId, Vec2 } from './types';

/**
 * Phase 7-8-10 combat (Task 4). All functions mutate a fresh `step` clone.
 *
 * Rules pinned here:
 * - A carrying unit cannot fire or throw (Q9: hands are full); damage while
 *   carrying drops the crate via the Task 2 `dropCrateAt` rule.
 * - Unarmed fire is a slap (nearest enemy unit or enemy stall within
 *   SLAP_RANGE, instant); armed fire spawns a bullet toward the explicit aim,
 *   `autoAimTarget` when aim is null, or the facing direction.
 * - Bullets hit the first living enemy unit they touch (sampling in 0.15-unit
 *   substeps — a graze band of at most ~0.01 units around UNIT_RADIUS is
 *   treated as a miss), stop at obstacle rects, and stop at both stall rects
 *   while only damaging the ENEMY stall. Friendly units never block or take
 *   bullet damage.
 * - Bombs land at the aim/auto-aim/facing target clamped to BOMB_THROW_RANGE
 *   and explode BOMB_FUSE_TICKS after the throw, damaging every living enemy
 *   unit within BOMB_RADIUS and the enemy stall (×BOMB_STALL_MULT) when its
 *   rect is inside the radius. No friendly fire anywhere.
 * - hp <= 0: deadUntilTick = tick + RESPAWN_TICKS, gun/bombs cleared, carried
 *   crate dropped. Dead units do not move, act, block or get hit. Phase 8
 *   respawns them at their stall's first spawn slot, healed and unarmed.
 * - Q5: a stall at 0 HP ends the match for the other team; Q10: both stalls
 *   reaching 0 HP in the same tick is a draw; `step` then only advances the
 *   tick.
 *
 * Event conventions: `hit` {target, dmg} — target is a unit id (number) or a
 * stall team ('fruit' | 'dessert'); `explosion` {pos}; `death`/`respawn`
 * {unitId, team, pos}; `matchOver` {winner}.
 */
const IDLE_INPUT: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};

const BULLET_TTL_TICKS = Math.max(1, Math.round(GUN_RANGE / (BULLET_SPEED * DT)));
const BULLET_SUBSTEPS = 6; // 0.15-unit samples at BULLET_SPEED — walls are never tunneled

function otherTeam(team: Team): Team {
  return team === 'fruit' ? 'dessert' : 'fruit';
}

/**
 * Phase 7 (first half): cooldowns tick down, then fire/throwBomb per unit in
 * ascending id. Carrying units do nothing. Returns the ids of projectiles
 * spawned this tick — they first move/fuse on the NEXT tick, so a bullet
 * covers exactly GUN_RANGE and a bomb explodes exactly BOMB_FUSE_TICKS after
 * its throw.
 */
export function processAttacks(s: MatchState, inputs: ReadonlyMap<UnitId, UnitInput>): Set<number> {
  const fresh = new Set<number>();
  for (const unit of s.units) {
    if (unitDead(unit)) continue;
    if (unit.attackCooldownTicks > 0) unit.attackCooldownTicks -= 1;
    if (unit.gun !== null && unit.gun.ammoCooldownTicks > 0) unit.gun.ammoCooldownTicks -= 1;

    const input = inputs.get(unit.id) ?? IDLE_INPUT;
    if (unit.carrying !== null) continue; // hands are full (Q9)

    if (input.fire) {
      if (unit.gun !== null) {
        if (unit.gun.ammoCooldownTicks === 0) {
          spawnBullet(s, unit, input.aim, fresh);
          unit.gun.ammoCooldownTicks = GUN_COOLDOWN_TICKS;
        }
      } else if (unit.attackCooldownTicks === 0) {
        slap(s, unit);
        unit.attackCooldownTicks = SLAP_COOLDOWN_TICKS;
      }
    }
    if (input.throwBomb && unit.bombs > 0) {
      spawnBomb(s, unit, input.aim, fresh);
      unit.bombs -= 1;
    }
  }
  return fresh;
}

/** Phase 7 (second half): move bullets, then tick bomb fuses, in id order. */
export function updateProjectiles(s: MatchState, fresh: ReadonlySet<number>): void {
  const alive: Projectile[] = [];
  for (const projectile of s.projectiles) {
    if (fresh.has(projectile.id)) {
      alive.push(projectile);
    } else if (projectile.kind === 'bullet') {
      if (moveBullet(s, projectile)) alive.push(projectile);
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
    unit.hp = UNIT_MAX_HP;
    unit.gun = null; // still unarmed after respawn
    unit.bombs = 0;
    unit.carrying = null;
    unit.attackCooldownTicks = 0;
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

/** Phase 10: Q5 — a stall at 0 HP ends the match for the other team; Q10 — both
 * stalls reaching 0 HP in the same tick is a draw. */
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

function spawnBullet(s: MatchState, unit: Unit, aim: Vec2 | null, fresh: Set<number>): void {
  const dir = attackDirection(s, unit, aim);
  const id = s.nextId++;
  s.projectiles.push({
    id,
    team: unit.team,
    kind: 'bullet',
    pos: { ...unit.pos },
    vel: { x: dir.x * BULLET_SPEED, y: dir.y * BULLET_SPEED },
    ttlTicks: BULLET_TTL_TICKS,
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
    pos,
    vel: { x: 0, y: 0 }, // the client animates the arc from the thrower to pos
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
  // A zero facing (unit never moved or aimed) yields a motionless bullet that
  // simply expires — deterministic and harmless.
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
    if (d2 === bestD2 && target !== null) continue; // lower id already won
    target = enemy;
    bestD2 = d2;
  }
  if (target !== null) {
    damageUnit(s, target, SLAP_DMG);
    return;
  }
  const enemyTeam = otherTeam(unit.team);
  const rect = STALL_RECTS[enemyTeam];
  const nx = Math.min(Math.max(unit.pos.x, rect.minX), rect.maxX);
  const ny = Math.min(Math.max(unit.pos.y, rect.minY), rect.maxY);
  if (dist2(unit.pos, { x: nx, y: ny }) <= SLAP_RANGE * SLAP_RANGE) {
    damageStall(s, s.stalls[enemyTeam], SLAP_DMG);
  }
}

/** Advance one tick; returns false when the bullet died (wall, stall or unit). */
function moveBullet(s: MatchState, bullet: Projectile): boolean {
  const stepX = (bullet.vel.x * DT) / BULLET_SUBSTEPS;
  const stepY = (bullet.vel.y * DT) / BULLET_SUBSTEPS;
  for (let i = 0; i < BULLET_SUBSTEPS; i++) {
    bullet.pos = { x: bullet.pos.x + stepX, y: bullet.pos.y + stepY };
    // Obstacles stop the bullet silently.
    for (const rect of OBSTACLES) {
      if (
        bullet.pos.x >= rect.minX &&
        bullet.pos.x <= rect.maxX &&
        bullet.pos.y >= rect.minY &&
        bullet.pos.y <= rect.maxY
      ) {
        return false;
      }
    }
    // Stall rects stop the bullet; only the ENEMY stall takes damage (no
    // friendly fire on the own stall).
    for (const team of ['fruit', 'dessert'] as const) {
      const rect = STALL_RECTS[team];
      if (
        bullet.pos.x >= rect.minX &&
        bullet.pos.x <= rect.maxX &&
        bullet.pos.y >= rect.minY &&
        bullet.pos.y <= rect.maxY
      ) {
        if (team !== bullet.team) damageStall(s, s.stalls[team], GUN_DMG);
        return false;
      }
    }
    for (const unit of s.units) {
      if (unit.team === bullet.team || unitDead(unit)) continue;
      if (dist2(bullet.pos, unit.pos) <= UNIT_RADIUS * UNIT_RADIUS) {
        damageUnit(s, unit, GUN_DMG);
        return false;
      }
    }
  }
  bullet.ttlTicks -= 1;
  return bullet.ttlTicks > 0;
}

function explode(s: MatchState, bomb: Projectile): void {
  const enemyTeam = otherTeam(bomb.team);
  for (const unit of s.units) {
    if (unit.team === bomb.team || unitDead(unit)) continue;
    if (dist2(bomb.pos, unit.pos) <= BOMB_RADIUS * BOMB_RADIUS) damageUnit(s, unit, BOMB_DMG);
  }
  if (circleOverlapsRect(bomb.pos, BOMB_RADIUS, STALL_RECTS[enemyTeam])) {
    damageStall(s, s.stalls[enemyTeam], BOMB_DMG * BOMB_STALL_MULT);
  }
  s.events.push({ tick: s.tick, kind: 'explosion', pos: { ...bomb.pos } });
}

function damageUnit(s: MatchState, unit: Unit, dmg: number): void {
  if (unitDead(unit)) return; // the dead do not get hit
  unit.hp = Math.max(0, unit.hp - dmg);
  // Any damage while carrying drops the crate at the unit's feet (the Task 2
  // drop rule resolves non-walkable points, e.g. on a pad or at the edge).
  if (unit.carrying !== null) dropCrateAt(s, unit.carrying, unit.pos, unit.id);
  s.events.push({ tick: s.tick, kind: 'hit', target: unit.id, dmg });
  if (unit.hp <= 0) killUnit(s, unit);
}

function killUnit(s: MatchState, unit: Unit): void {
  unit.carrying = null; // dropped by damageUnit above when set
  unit.gun = null;
  unit.bombs = 0;
  unit.deadUntilTick = s.tick + RESPAWN_TICKS;
  s.events.push({
    tick: s.tick,
    kind: 'death',
    unitId: unit.id,
    team: unit.team,
    pos: { ...unit.pos },
  });
}

function damageStall(s: MatchState, stall: Stall, dmg: number): void {
  stall.hp = Math.max(0, stall.hp - dmg);
  s.events.push({ tick: s.tick, kind: 'hit', target: stall.team, dmg });
}
