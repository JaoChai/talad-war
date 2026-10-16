import Phaser from 'phaser';
import {
  DROP_FALL_TICKS,
  DT,
  PAD_CELL_SIZE,
  PAD_FLOOR,
  STALL_MAX_HP,
  UNIT_SPEED,
  stallRect,
} from '@talad/sim';
import { playCharacterPose, type ArtManifest, type CharacterAnim } from './anims';
import type { Crate, MatchState, Team, Unit } from '@talad/sim';
import { STAGE_SCALE, clampDrawY, padCellOffset, padCenterOffset, worldToStage } from './world';

/** Team colour tokens approved in the Task 7 HUD mockup. */
const TEAM_COLOURS: Record<Team, number> = { fruit: 0x2f7bff, dessert: 0xff4a3d };

/** Three units per team at start; the buddy (4th member) uses the 4th skin. */
const SKINS: Record<Team, string[]> = {
  fruit: ['fruit_mangosteen', 'fruit_rambutan', 'fruit_durian', 'fruit_longan'],
  dessert: ['dessert_khanomkrok', 'dessert_thongyod', 'dessert_lookchup', 'dessert_khanomchan'],
};

/** Character strip frames are 256x256 with the feet at the manifest anchor. */
const UNIT_DISPLAY_HEIGHT = 92;
const UNIT_ANCHOR_Y = 0.984375;
const HURT_FLASH_MS = 220;
const STALL_FLASH_MS = 200;
const STALL_CUE_GAP_MS = 200;
const STALL_SHAKE_MS = 160;

interface UnitView {
  sprite: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Ellipse;
  hurtUntil: number;
  attackAt: number;
  attackTick: number;
  attackDir: { x: number; y: number };
}

interface CrateView {
  sprite: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Container;
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
  private readonly manifest: ArtManifest | undefined;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly crates = new Map<number, CrateView>();
  private readonly fallingShadows = new Map<number, Phaser.GameObjects.Ellipse>();
  private readonly projectiles = new Map<number, ProjectileView>();
  private readonly padSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly stallSprites: Partial<Record<Team, Phaser.GameObjects.Image>> = {};
  private lastEventTick = -1;
  private readonly damageNumbers = new Map<
    Team,
    { text: Phaser.GameObjects.Text; at: number; dmg: number }
  >();
  /** Small marker above the human unit (card Task mapping). */
  private readonly humanMarker: Phaser.GameObjects.Triangle;

  constructor(private readonly scene: Phaser.Scene) {
    this.manifest = scene.cache.json.get('art-manifest') as ArtManifest | undefined;
    const arena = scene.add.image(0, 0, 'arena');
    arena.setOrigin(0, 0);
    arena.setDisplaySize(scene.scale.width, scene.scale.height);
    arena.setDepth(-100);

    for (const team of ['fruit', 'dessert'] as const) {
      const stall = scene.add.image(0, 0, stallTexture(team, STALL_MAX_HP));
      stall.setName(`stall-${team}`);
      stall.setData({ flashUntil: 0, shakeAt: -Infinity });
      this.sizeProp(stall, 4.6 * STAGE_SCALE);
      stall.setOrigin(0.5, 0.72);
      this.stallSprites[team] = stall;
    }

    this.humanMarker = scene.add.triangle(0, 0, 0, 10, 10, 0, 20, 10, 0xffd75e);
    this.humanMarker.setDepth(2000);
  }

  sync(prev: MatchState, cur: MatchState, alpha: number): void {
    const prevUnits = new Map(prev.units.map((u) => [u.id, u]));
    const now = this.scene.time.now;
    this.syncEvents(cur, now);

    // Stalls.
    for (const team of ['fruit', 'dessert'] as const) {
      const sprite = this.stallSprites[team];
      const stall = cur.stalls[team];
      if (!sprite || !stall) continue;
      const at = worldToStage(stall.pos);
      const elapsed = now - (sprite.getData('shakeAt') as number);
      const shake =
        elapsed < STALL_SHAKE_MS
          ? 6 * Math.sin(elapsed * 0.15) * (1 - elapsed / STALL_SHAKE_MS)
          : 0;
      sprite.setPosition(at.x + shake, at.y);
      sprite.setTexture(stallTexture(team, stall.hp));
      this.sizeProp(sprite, 4.6 * STAGE_SCALE);
      if (now < (sprite.getData('flashUntil') as number))
        sprite.setTint(0x995544).setTintMode(Phaser.TintModes.MULTIPLY);
      else sprite.clearTint();
      sprite.setDepth(Math.floor(at.y) - 4);
    }

    // Pads: base sprite per team, crates rendered from the crate list.
    this.syncPads(cur);

    // Units.
    for (const unit of cur.units) {
      const view = this.ensureUnit(unit);
      const before = prevUnits.get(unit.id);
      const attacked =
        before &&
        (unit.attackCooldownTicks > before.attackCooldownTicks ||
          (unit.gun !== null &&
            before.gun !== null &&
            unit.gun.ammoCooldownTicks > before.gun.ammoCooldownTicks));
      if (cur.tick < view.attackTick) view.attackAt = -Infinity;
      if (attacked && cur.tick !== view.attackTick) {
        view.attackTick = cur.tick;
        view.attackAt = now;
        view.attackDir = { ...unit.facing };
        view.sprite.setData('attackAt', now);
        this.attackSlash(unit);
      }
      const x = before ? Phaser.Math.Linear(before.pos.x, unit.pos.x, alpha) : unit.pos.x;
      const y = before ? Phaser.Math.Linear(before.pos.y, unit.pos.y, alpha) : unit.pos.y;
      const at = worldToStage({ x, y });
      const speed = before
        ? Math.hypot(before.pos.x - unit.pos.x, before.pos.y - unit.pos.y) / DT
        : 0;
      const moving = speed > 0.2;
      const dead = unit.deadUntilTick !== null;
      view.sprite.setVisible(!dead);
      view.ring.setVisible(!dead);
      if (dead) continue;
      const drawY = this.unitDrawY(unit, at.y); // keep head and overhead cargo on-canvas
      // The existing lunge and the art's windup/slap share one attack clock.
      // Reduced motion keeps the pose feedback without a lunge/squash.
      const elapsed = now - view.attackAt;
      const attacking = elapsed >= 0 && elapsed < 220;
      const pulse =
        attacking && !this.reducedMotion.matches ? Math.sin((Math.PI * elapsed) / 220) : 0;
      view.sprite.setPosition(
        at.x + view.attackDir.x * 12 * pulse,
        drawY + view.attackDir.y * 12 * pulse,
      );
      view.sprite.setDisplaySize(
        UNIT_DISPLAY_HEIGHT * (1 + 0.08 * pulse),
        UNIT_DISPLAY_HEIGHT * (1 - 0.08 * pulse),
      );
      view.sprite.setDepth(Math.floor(drawY));
      view.ring.setPosition(at.x, drawY - 2);
      view.ring.setDepth(Math.floor(drawY) - 1);
      const hurt = now < view.hurtUntil;
      const pose: CharacterAnim = hurt
        ? 'hurt'
        : attacking
          ? elapsed < 80
            ? 'windup'
            : 'slap'
          : unit.carrying !== null
            ? 'carry'
            : moving
              ? 'run'
              : 'idle';
      view.sprite.anims.timeScale =
        pose === 'run' ? Phaser.Math.Clamp(speed / UNIT_SPEED, 0.6, 1.4) : 1;
      playCharacterPose(
        view.sprite,
        this.manifest?.characters[view.sprite.texture.key],
        pose,
        this.reducedMotion.matches || (pose === 'carry' && !moving),
      );
      view.sprite.setFlipX((pulse > 0 ? view.attackDir.x : unit.facing.x) < -0.01);
    }

    // Marker above the human unit (unit 0, fruit).
    const human = cur.units[0];
    if (human && human.deadUntilTick === null) {
      const hBefore = prevUnits.get(human.id);
      const hx = hBefore ? Phaser.Math.Linear(hBefore.pos.x, human.pos.x, alpha) : human.pos.x;
      const hy = hBefore ? Phaser.Math.Linear(hBefore.pos.y, human.pos.y, alpha) : human.pos.y;
      const at = worldToStage({ x: hx, y: hy });
      // Marker rides the clamped position and never leaves the canvas.
      const baseY = this.unitDrawY(human, at.y);
      this.humanMarker.setPosition(
        at.x,
        Math.max(
          baseY -
            UNIT_DISPLAY_HEIGHT -
            6 +
            (this.reducedMotion.matches ? 0 : Math.sin(now / 250) * 3),
          12,
        ),
      );
      this.humanMarker.setVisible(true);
    } else {
      this.humanMarker.setVisible(false);
    }

    this.syncCrates(prev, cur, alpha);
    this.syncProjectiles(prev, cur, alpha);
  }

  private ensureUnit(unit: Unit): UnitView {
    const existing = this.units.get(unit.id);
    if (existing) return existing;
    const teamMates = unit.team === 'fruit' ? unit.id : unit.id - 3;
    const skins = SKINS[unit.team];
    const skin = skins[Math.min(Math.max(teamMates, 0), skins.length - 1)] ?? skins[0]!;
    const sprite = this.scene.add.sprite(0, 0, skin, 0);
    sprite.setName(`unit-${unit.id}`);
    const anchor = this.manifest?.characters[skin]?.anchor;
    sprite.setOrigin(anchor?.[0] ?? 0.5, anchor?.[1] ?? UNIT_ANCHOR_Y);
    sprite.setDisplaySize(UNIT_DISPLAY_HEIGHT, UNIT_DISPLAY_HEIGHT);
    const ring = this.scene.add.ellipse(0, 0, 44, 15, TEAM_COLOURS[unit.team], 0.4);
    const view: UnitView = {
      sprite,
      ring,
      hurtUntil: 0,
      attackAt: -Infinity,
      attackTick: -1,
      attackDir: { x: 0, y: 0 },
    };
    this.units.set(unit.id, view);
    return view;
  }

  private attackSlash(unit: Unit): void {
    const name = `attack-slash-${unit.id}`;
    const old = this.scene.children.getByName(name);
    if (old) {
      this.scene.tweens.killTweensOf(old);
      old.destroy();
    }
    const at = worldToStage(unit.pos);
    const fx = this.scene.add.graphics({
      x: at.x + unit.facing.x * 30,
      y: clampDrawY(at.y) - 32 + unit.facing.y * 20,
    });
    fx.setName(name).setDepth(950).setRotation(Math.atan2(unit.facing.y, unit.facing.x));
    fx.setData({ kind: unit.gun ? 'gun' : 'slap', size: 96 });
    if (unit.gun) {
      const points = [
        32, 0, 12, 9, 10, 28, -1, 13, -24, 18, -11, 0, -24, -18, -1, -13, 10, -28, 12, -9,
      ];
      const vertices = points.reduce<Phaser.Math.Vector2[]>((out, _, i) => {
        if (i % 2 === 0) out.push(new Phaser.Math.Vector2(points[i]! * 1.5, points[i + 1]! * 1.5));
        return out;
      }, []);
      fx.fillStyle(0xffd75e, 1).lineStyle(7, 0x251414, 1);
      fx.fillPoints(vertices, true).strokePoints(vertices, true);
      fx.fillStyle(0xffffff, 1).fillCircle(4, 0, 10);
    } else {
      fx.lineStyle(18, 0x251414, 1).beginPath().arc(0, 0, 38, -1.9, 1.9).strokePath();
      fx.lineStyle(12, 0xffd75e, 1).beginPath().arc(0, 0, 38, -1.9, 1.9).strokePath();
      fx.lineStyle(5, 0xffffff, 1).beginPath().arc(0, 0, 38, -1.9, 1.9).strokePath();
    }
    // Hold the high-contrast silhouette through most of the attack, not just
    // its first frame. A linear fade from frame one was barely readable.
    this.scene.tweens.add({
      targets: fx,
      alpha: 0,
      delay: 160,
      duration: 60,
      onComplete: () => fx.destroy(),
    });
  }

  private damageNumber(team: Team, dmg: number, now: number, cur: MatchState): void {
    const previous = this.damageNumbers.get(team);
    if (previous && now - previous.at < 150) {
      previous.dmg += dmg;
      previous.text.setText(`-${Math.round(previous.dmg)}`);
      return;
    }
    const at = worldToStage(cur.stalls[team].pos);
    const text = this.scene.add
      .text(at.x - 16, Math.max(72, at.y - 60), `-${Math.round(dmg)}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#fff3b0',
        stroke: '#251414',
        strokeThickness: 6,
      })
      .setOrigin(0.5, 1)
      .setDepth(1000)
      .setName(`stall-damage-${team}`);
    // Phaser depth cannot overdraw the DOM HP bars. Reserve room for the
    // entire upward tween in screen pixels, accounting for letterboxing.
    const canvas = this.scene.game.canvas.getBoundingClientRect();
    const bounds = text.getBounds();
    const scaleX = canvas.width / this.scene.scale.width;
    const scaleY = canvas.height / this.scene.scale.height;
    const left = canvas.x + bounds.x * scaleX;
    const right = left + bounds.width * scaleX;
    for (const hud of document.querySelectorAll('.tw-hp')) {
      const rect = hud.getBoundingClientRect();
      if (left < rect.right && right > rect.left) {
        const safeTop = (rect.bottom + 8 - canvas.y) / scaleY;
        text.y = Math.max(text.y, safeTop + bounds.height + 24);
      }
    }
    const entry = { text, at: now, dmg };
    this.damageNumbers.set(team, entry);
    this.scene.tweens.add({
      targets: text,
      y: text.y - 24,
      alpha: 0,
      duration: 600,
      onComplete: () => {
        text.destroy();
        if (this.damageNumbers.get(team) === entry) this.damageNumbers.delete(team);
      },
    });
  }

  /** The raised crate extends above the 92px body: reserve its real height too. */
  private unitDrawY(unit: Unit, y: number): number {
    const base = clampDrawY(y);
    if (unit.carrying === null) return base;
    const art = this.manifest?.props.crate;
    const crateHeight = art ? (1.8 * STAGE_SCALE * art.height) / art.width : 0;
    return Math.max(base, (207 / 256) * UNIT_DISPLAY_HEIGHT + crateHeight + 2);
  }

  /** Width is a design choice; height always comes from the cached art manifest. */
  private sizeProp(
    sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
    width: number,
  ): void {
    const art = this.manifest?.props[sprite.texture.key];
    const ratio = art ? art.height / art.width : sprite.height / sprite.width;
    sprite.setDisplaySize(width, width * ratio);
  }

  /** Layered ellipses create a soft glow without a per-frame blur/filter cost. */
  private groundGlow(
    name: string,
    width: number,
    height: number,
    colour: number,
  ): Phaser.GameObjects.Container {
    const glow = this.scene.add.container(0, 0);
    glow.setName(name);
    for (const [scale, alpha] of [
      [1.3, 0.06],
      [1.1, 0.1],
      [0.85, 0.16],
    ]) {
      glow.add(this.scene.add.ellipse(0, 0, width * scale!, height * scale!, colour, alpha));
    }
    return glow;
  }

  private syncPads(cur: MatchState): void {
    for (const team of ['fruit', 'dessert'] as const) {
      const pad = cur.pads[team];
      const key = `pad_${team}`;
      let sprite = this.padSprites.get(key);
      if (!sprite) {
        sprite = this.scene.add.image(0, 0, key);
        const width = PAD_FLOOR * PAD_CELL_SIZE * STAGE_SCALE;
        this.sizeProp(sprite, width);
        // Painted top-surface centre is at 35% of the trimmed image height.
        sprite.setOrigin(0.5, 0.35);
        const glow = this.groundGlow(
          `pad-glow-${team}`,
          width * 1.2,
          width * 0.8,
          TEAM_COLOURS[team],
        );
        glow.setDepth(-6);
        sprite.setData('glow', glow);
        sprite.setDepth(-5);
        this.padSprites.set(key, sprite);
      }
      const center = worldToStage({
        x: pad.origin.x + padCenterOffset().x,
        y: pad.origin.y + padCenterOffset().y,
      });
      sprite.setPosition(center.x, center.y);
      (sprite.getData('glow') as Phaser.GameObjects.Container).setPosition(center.x, center.y);
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
        view = {
          sprite: this.scene.add.sprite(0, 0, 'crate'),
          glow: this.groundGlow(`crate-glow-${crate.id}`, 60, 22, 0xffce6b),
        };
        view.sprite.setName(`crate-${crate.id}`);
        this.crates.set(crate.id, view);
      }
      const before = prevCrates.get(crate.id);
      const x = before ? Phaser.Math.Linear(before.pos.x, crate.pos.x, alpha) : crate.pos.x;
      const y = before ? Phaser.Math.Linear(before.pos.y, crate.pos.y, alpha) : crate.pos.y;
      let at = worldToStage({ x, y });
      let depth = Math.floor(at.y) - 2;
      view.sprite.setOrigin(0.5, 0.5);
      view.glow
        .setPosition(at.x, at.y + 12)
        .setDepth(depth - 1)
        .setVisible(crate.state === 'ground');
      if (crate.state === 'falling') {
        const progress = Math.min(
          1,
          Math.max(0, 1 - (crate.landTick - cur.tick) / DROP_FALL_TICKS),
        );
        const texture = progress >= 1 ? 'crate' : 'crate_air';
        view.sprite.setTexture(texture);
        this.sizeProp(view.sprite, 1.8 * STAGE_SCALE);
        view.sprite.setY(at.y - (1 - progress) * 110);
        view.sprite.setX(at.x);
        view.sprite.setDepth(depth);
        // Shadow grows at the landing point as the crate drops.
        let shadow = this.fallingShadows.get(crate.id);
        if (!shadow) {
          shadow = this.scene.add.ellipse(at.x, at.y, 26, 9, 0x000000, 0.3);
          this.fallingShadows.set(crate.id, shadow);
        }
        shadow.setPosition(at.x, at.y);
        shadow.setSize(10 + 18 * progress, 4 + 6 * progress);
        shadow.setDepth(Math.floor(at.y) - 3);
        continue;
      }
      this.fallingShadows.get(crate.id)?.destroy();
      this.fallingShadows.delete(crate.id);
      view.sprite.setTexture('crate');
      if (crate.state === 'carried') {
        const carrier = cur.units.find((u) => u.carrying === crate.id);
        if (carrier) {
          const carried = prevUnitsCarrierPos(prev, cur, carrier.id, alpha);
          at = worldToStage(carried);
          const feetY = this.unitDrawY(carrier, at.y);
          // Carry cells have empty raised hands around y=45 (feet at y=252).
          at.y = feetY - (207 / 256) * UNIT_DISPLAY_HEIGHT;
          view.sprite.setOrigin(0.5, 1);
          depth = Math.floor(feetY) + 2;
        }
      } else if (crate.state === 'onPad') {
        const spot = padOf(crate);
        if (spot) {
          const pad = cur.pads[spot.team];
          const off = padCellOffset(spot.col); // mirrors sim pad.ts cell math
          at = worldToStage({ x: pad.origin.x + off.x, y: pad.origin.y + off.y });
          if (spot.layer === 1) {
            view.sprite.setTexture('crate_stack2');
            at.y -= 22;
          }
          depth = Math.floor(at.y) - 2;
        }
      }
      if (crate.state === 'ground' && !this.reducedMotion.matches) {
        at.y += Math.sin((this.scene.time.now / 1200) * Math.PI * 2 + crate.id) * 2.5;
      }
      this.sizeProp(view.sprite, crate.state === 'onPad' ? 34 : 1.8 * STAGE_SCALE);
      view.sprite.setPosition(at.x, at.y);
      view.sprite.setDepth(depth);
    }
    for (const [id, view] of this.crates) {
      if (!alive.has(id)) {
        view.sprite.destroy();
        view.glow.destroy();
        this.fallingShadows.get(id)?.destroy();
        this.fallingShadows.delete(id);
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
        this.sizeProp(view.sprite, p.kind === 'bomb' ? 26 : 34);
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
    // A sim tick is rendered several times. Replaying it extends flashes and
    // spawns duplicate sparks/explosions; a seed reset must release the guard.
    if (cur.tick === this.lastEventTick) return;
    if (cur.tick < this.lastEventTick) {
      for (const child of [...this.scene.children.list]) {
        if (child.name.startsWith('stall-damage-') || child.name.startsWith('attack-slash-')) {
          this.scene.tweens.killTweensOf(child);
          child.destroy();
        }
      }
      this.damageNumbers.clear();
      for (const sprite of Object.values(this.stallSprites)) {
        sprite.setData({ flashUntil: 0, shakeAt: -Infinity });
      }
    }
    this.lastEventTick = cur.tick;
    for (const event of cur.events) {
      if (event.kind === 'explosion') {
        const pos = event.pos as { x: number; y: number } | undefined;
        if (!pos) continue;
        const at = worldToStage(pos);
        const boom = this.scene.add.sprite(at.x, at.y, 'explosion');
        this.sizeProp(boom, 30);
        boom.setDepth(900);
        this.scene.tweens.add({
          targets: boom,
          scaleX: boom.scaleX * (110 / 30),
          scaleY: boom.scaleY * (110 / 30),
          alpha: 0,
          duration: 340,
          onComplete: () => boom.destroy(),
        });
      } else if (event.kind === 'hit' && typeof event.target === 'number') {
        const view = this.units.get(event.target);
        if (view) view.hurtUntil = now + HURT_FLASH_MS;
      } else if (event.kind === 'hit' && (event.target === 'fruit' || event.target === 'dessert')) {
        this.damageNumber(event.target, Number(event.dmg), now, cur);
        this.stallHit(cur, event.target, now);
      }
    }
  }

  private stallHit(cur: MatchState, team: Team, now: number): void {
    const stall = this.stallSprites[team];
    if (!stall || now - (stall.getData('shakeAt') as number) < STALL_CUE_GAP_MS) return;
    // One cue per stall per 200ms, including same-tick multi-hits. Do not extend
    // the flash on every gun hit: leave a quiet interval rather than strobing.
    stall.setData({ flashUntil: now + STALL_FLASH_MS, shakeAt: now });
    const rect = stallRect(team);
    let impact = cur.stalls[team].pos;
    let nearest = Infinity;
    // hit events carry no source/position. Project the nearest living attacker
    // onto the struck stall so the spark reads on the incoming side, not centre.
    for (const unit of cur.units) {
      if (unit.team === team || unit.deadUntilTick !== null) continue;
      const point = {
        x: Math.max(rect.minX, Math.min(rect.maxX, unit.pos.x)),
        y: Math.max(rect.minY, Math.min(rect.maxY, unit.pos.y)),
      };
      const distance = Math.hypot(point.x - unit.pos.x, point.y - unit.pos.y);
      if (distance < nearest) {
        nearest = distance;
        // Put the spark just outside the facade, not inside its bright canopy.
        impact = {
          x: point.x + ((unit.pos.x - point.x) / Math.max(distance, 0.001)) * 0.35,
          y: point.y + ((unit.pos.y - point.y) / Math.max(distance, 0.001)) * 0.35,
        };
      }
    }
    const at = worldToStage(impact);
    const spark = this.scene.add.sprite(at.x, at.y - 14, 'explosion');
    spark.setName(`stall-hit-${team}`);
    this.sizeProp(spark, 36);
    spark.setDepth(900);
    this.scene.tweens.add({
      targets: spark,
      scaleX: spark.scaleX * (46 / 36),
      scaleY: spark.scaleY * (46 / 36),
      alpha: 0,
      duration: 160,
      onComplete: () => spark.destroy(),
    });
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
