import Phaser from 'phaser';
import { DROP_FALL_TICKS, PAD_CELL_SIZE, STALL_MAX_HP } from '@talad/sim';
import type { Crate, MatchState, Team, Unit } from '@talad/sim';
import { STAGE_SCALE, worldToStage } from './world';

/** Team colour tokens approved in the Task 7 HUD mockup. */
const TEAM_COLOURS: Record<Team, number> = { fruit: 0x2f7bff, dessert: 0xff4a3d };

/** Three units per team at start; the buddy (4th member) uses the 4th skin. */
const SKINS: Record<Team, string[]> = {
  fruit: ['fruit_mangosteen', 'fruit_rambutan', 'fruit_durian', 'fruit_longan'],
  dessert: ['dessert_khanomkrok', 'dessert_thongyod', 'dessert_lookchup', 'dessert_khanomchan'],
};

const IDLE_FRAME = 0;
const RUN_FRAME = 1;
const CARRY_FRAME = 2;
const HURT_FRAME = 3;

/** Character strip frames are 256x256 with the feet at the manifest anchor. */
const UNIT_DISPLAY_HEIGHT = 92;
const UNIT_ANCHOR_Y = 0.984375;
const HURT_FLASH_MS = 220;

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Ellipse;
  hurtUntil: number;
}

interface CrateView {
  sprite: Phaser.GameObjects.Sprite;
}

interface ProjectileView {
  sprite: Phaser.GameObjects.Sprite;
}

function stallTexture(team: Team, hp: number): string {
  if (hp <= 0) return `stall_${team}_destroyed`;
  if (hp < STALL_MAX_HP * 0.5) return `stall_${team}_damaged`;
  return `stall_${team}_ok`;
}

/**
 * Sprite views for every entity kind. sync() interpolates prev→cur by alpha and
 * y-sorts by stage depth so units walk in front of / behind props correctly.
 */
export class MatchView {
  private readonly units = new Map<number, UnitView>();
  private readonly crates = new Map<number, CrateView>();
  private readonly projectiles = new Map<number, ProjectileView>();
  private readonly padSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly stallSprites: Partial<Record<Team, Phaser.GameObjects.Image>> = {};

  constructor(private readonly scene: Phaser.Scene) {
    const arena = scene.add.image(0, 0, 'arena');
    arena.setOrigin(0, 0);
    arena.setDisplaySize(scene.scale.width, scene.scale.height);
    arena.setDepth(-100);

    for (const team of ['fruit', 'dessert'] as const) {
      const stall = scene.add.image(0, 0, stallTexture(team, STALL_MAX_HP));
      stall.setDisplaySize(4.6 * STAGE_SCALE, 4.6 * STAGE_SCALE * (218 / 358));
      stall.setOrigin(0.5, 0.72);
      this.stallSprites[team] = stall;
    }
  }

  sync(prev: MatchState, cur: MatchState, alpha: number): void {
    const prevUnits = new Map(prev.units.map((u) => [u.id, u]));
    const now = this.scene.time.now;

    // Stalls.
    for (const team of ['fruit', 'dessert'] as const) {
      const sprite = this.stallSprites[team];
      const stall = cur.stalls[team];
      if (!sprite || !stall) continue;
      const at = worldToStage(stall.pos);
      sprite.setPosition(at.x, at.y);
      sprite.setTexture(stallTexture(team, stall.hp));
      sprite.setDepth(Math.floor(at.y) - 4);
    }

    // Pads: base sprite per team, crates rendered from the crate list.
    this.syncPads(cur);

    // Units.
    for (const unit of cur.units) {
      const view = this.ensureUnit(unit);
      const before = prevUnits.get(unit.id);
      const x = before ? Phaser.Math.Linear(before.pos.x, unit.pos.x, alpha) : unit.pos.x;
      const y = before ? Phaser.Math.Linear(before.pos.y, unit.pos.y, alpha) : unit.pos.y;
      const at = worldToStage({ x, y });
      const moving =
        !before ||
        Math.hypot(before.pos.x - unit.pos.x, before.pos.y - unit.pos.y) > 0.01 ||
        alpha > 0;
      const dead = unit.deadUntilTick !== null;
      view.sprite.setVisible(!dead);
      view.ring.setVisible(!dead);
      if (dead) continue;
      view.sprite.setPosition(at.x, at.y);
      view.sprite.setDepth(Math.floor(at.y));
      view.ring.setPosition(at.x, at.y - 2);
      view.ring.setDepth(Math.floor(at.y) - 1);
      const hurt = now < view.hurtUntil;
      const frame = hurt
        ? HURT_FRAME
        : unit.carrying !== null
          ? CARRY_FRAME
          : moving
            ? RUN_FRAME
            : IDLE_FRAME;
      view.sprite.setFrame(frame);
      view.sprite.setFlipX(unit.facing.x < -0.01);
    }

    this.syncCrates(prev, cur, alpha);
    this.syncProjectiles(prev, cur, alpha);
    this.syncEvents(cur, now);
  }

  private ensureUnit(unit: Unit): UnitView {
    const existing = this.units.get(unit.id);
    if (existing) return existing;
    const teamMates = unit.team === 'fruit' ? unit.id : unit.id - 3;
    const skins = SKINS[unit.team];
    const skin = skins[Math.min(Math.max(teamMates, 0), skins.length - 1)] ?? skins[0]!;
    const sprite = this.scene.add.sprite(0, 0, skin, 0);
    sprite.setOrigin(0.5, UNIT_ANCHOR_Y);
    sprite.setDisplaySize(UNIT_DISPLAY_HEIGHT, UNIT_DISPLAY_HEIGHT);
    const ring = this.scene.add.ellipse(0, 0, 44, 15, TEAM_COLOURS[unit.team], 0.4);
    const view: UnitView = { sprite, ring, hurtUntil: 0 };
    this.units.set(unit.id, view);
    return view;
  }

  private syncPads(cur: MatchState): void {
    for (const team of ['fruit', 'dessert'] as const) {
      const pad = cur.pads[team];
      const key = `pad_${team}`;
      let sprite = this.padSprites.get(key);
      if (!sprite) {
        sprite = this.scene.add.image(0, 0, key);
        sprite.setDisplaySize(6.4 * STAGE_SCALE, 6.4 * STAGE_SCALE * (153 / 311));
        sprite.setOrigin(0.5, 0.6);
        sprite.setDepth(-5);
        this.padSprites.set(key, sprite);
      }
      const center = worldToStage({
        x: pad.origin.x + 2 * PAD_CELL_SIZE,
        y: pad.origin.y + 2 * PAD_CELL_SIZE,
      });
      sprite.setPosition(center.x, center.y);
    }
  }

  private syncCrates(prev: MatchState, cur: MatchState, alpha: number): void {
    const prevCrates = new Map(prev.crates.map((c) => [c.id, c]));
    const padOf = (crate: Crate) => {
      for (const team of ['fruit', 'dessert'] as const) {
        const pad = cur.pads[team];
        for (let col = 0; col < pad.cells.length; col++) {
          for (let layer = 0; layer < pad.cells[col]!.length; layer++) {
            if (pad.cells[col]![layer] === crate.id) return { team, col, layer };
          }
        }
      }
      return null;
    };
    const alive = new Set<number>();
    for (const crate of cur.crates) {
      alive.add(crate.id);
      let view = this.crates.get(crate.id);
      if (!view) {
        view = { sprite: this.scene.add.sprite(0, 0, 'crate') };
        view.sprite.setDisplaySize(34, 26);
        this.crates.set(crate.id, view);
      }
      const before = prevCrates.get(crate.id);
      const x = before ? Phaser.Math.Linear(before.pos.x, crate.pos.x, alpha) : crate.pos.x;
      const y = before ? Phaser.Math.Linear(before.pos.y, crate.pos.y, alpha) : crate.pos.y;
      let at = worldToStage({ x, y });
      let depth = Math.floor(at.y) - 2;
      if (crate.state === 'falling') {
        const progress = Math.min(
          1,
          Math.max(0, 1 - (crate.landTick - cur.tick) / DROP_FALL_TICKS),
        );
        const texture = progress >= 1 ? 'crate' : 'crate_air';
        view.sprite.setTexture(texture);
        view.sprite.setY(at.y - (1 - progress) * 110);
        view.sprite.setX(at.x);
        view.sprite.setDepth(depth);
        continue;
      }
      view.sprite.setTexture('crate');
      if (crate.state === 'carried') {
        const carrier = cur.units.find((u) => u.carrying === crate.id);
        if (carrier) {
          const carried = prevUnitsCarrierPos(prev, cur, carrier.id, alpha);
          at = worldToStage(carried);
          at.y -= 40; // above the carrier's head
          depth = Math.floor(at.y) + 2;
        }
      } else if (crate.state === 'onPad') {
        const spot = padOf(crate);
        if (spot) {
          const pad = cur.pads[spot.team];
          const cx = pad.origin.x + (spot.col % 4) * PAD_CELL_SIZE + PAD_CELL_SIZE / 2;
          const cy = pad.origin.y + Math.floor(spot.col / 4) * PAD_CELL_SIZE + PAD_CELL_SIZE / 2;
          at = worldToStage({ x: cx, y: cy });
          if (spot.layer === 1) {
            view.sprite.setTexture('crate_stack2');
            at.y -= 22;
          }
          depth = Math.floor(at.y) - 2;
        }
      }
      view.sprite.setPosition(at.x, at.y);
      view.sprite.setDepth(depth);
    }
    for (const [id, view] of this.crates) {
      if (!alive.has(id)) {
        view.sprite.destroy();
        this.crates.delete(id);
      }
    }
  }

  private syncProjectiles(prev: MatchState, cur: MatchState, alpha: number): void {
    const prevById = new Map(prev.projectiles.map((p) => [p.id, p]));
    const alive = new Set<number>();
    for (const p of cur.projectiles) {
      alive.add(p.id);
      let view = this.projectiles.get(p.id);
      if (!view) {
        const texture = p.kind === 'bomb' ? 'bomb' : `shot_${p.team}`;
        view = { sprite: this.scene.add.sprite(0, 0, texture) };
        view.sprite.setDisplaySize(p.kind === 'bomb' ? 26 : 34, p.kind === 'bomb' ? 26 : 12);
        this.projectiles.set(p.id, view);
      }
      const before = prevById.get(p.id);
      const x = before ? Phaser.Math.Linear(before.pos.x, p.pos.x, alpha) : p.pos.x;
      const y = before ? Phaser.Math.Linear(before.pos.y, p.pos.y, alpha) : p.pos.y;
      const at = worldToStage({ x, y });
      view.sprite.setPosition(at.x, at.y);
      view.sprite.setDepth(Math.floor(at.y) + 3);
      if (p.kind === 'bullet') {
        view.sprite.setRotation(Math.atan2(p.vel.y, p.vel.x));
      }
    }
    for (const [id, view] of this.projectiles) {
      if (!alive.has(id)) {
        view.sprite.destroy();
        this.projectiles.delete(id);
      }
    }
  }

  /** FX from the latest tick's events: explosions and hurt flashes. */
  private syncEvents(cur: MatchState, now: number): void {
    for (const event of cur.events) {
      if (event.kind === 'explosion') {
        const pos = event.pos as { x: number; y: number } | undefined;
        if (!pos) continue;
        const at = worldToStage(pos);
        const boom = this.scene.add.sprite(at.x, at.y, 'explosion');
        boom.setDisplaySize(30, 20);
        boom.setDepth(900);
        this.scene.tweens.add({
          targets: boom,
          displayWidth: 110,
          displayHeight: 70,
          alpha: 0,
          duration: 340,
          onComplete: () => boom.destroy(),
        });
      } else if (event.kind === 'hit' && typeof event.target === 'number') {
        const view = this.units.get(event.target);
        if (view) view.hurtUntil = now + HURT_FLASH_MS;
      }
    }
  }
}

/** Carried crate follows the carrier's interpolated position. */
function prevUnitsCarrierPos(
  prev: MatchState,
  cur: MatchState,
  unitId: number,
  alpha: number,
): { x: number; y: number } {
  const curUnit = cur.units.find((u) => u.id === unitId);
  const prevUnit = prev.units.find((u) => u.id === unitId);
  if (!curUnit) return { x: 0, y: 0 };
  if (!prevUnit) return curUnit.pos;
  return {
    x: Phaser.Math.Linear(prevUnit.pos.x, curUnit.pos.x, alpha),
    y: Phaser.Math.Linear(prevUnit.pos.y, curUnit.pos.y, alpha),
  };
}
