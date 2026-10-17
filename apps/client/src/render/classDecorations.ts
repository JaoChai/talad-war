import type { Unit } from '@talad/sim';
import Phaser from 'phaser';
import type { ArtManifest, ClassArtEntry, HeadFrame } from './anims';
import {
  bodyBounds,
  classVisualGeometry,
  unionBounds,
  type BodyTransform,
  type VisualBounds,
} from './classGeometry';

const BADGE_SIZE = 24; // §4.3: logical stage px
const STAR_SIZE = 16; // §4.3: logical stage px, right of the badge
const OVERHEAD_GAP = 4;
const HEAD_DEPTH_OFFSET = 0.2; // §4.3: accessory sits just in front of the body
const KIT_DEPTH_OFFSET = 3; // above cargo (floor + 2), below screen-space HUD

interface DecorSet {
  head: Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Image;
  star: Phaser.GameObjects.Image;
}

interface LastSync {
  unit: Unit;
  body: Phaser.GameObjects.Sprite;
  cargoBounds: VisualBounds | null;
}

/**
 * Frame-attached class rendering (§4.3): head accessory, class badge and the
 * super star for one match. Owns no control marker and no motion of its own —
 * every sprite is placed from the body's live transform each sync, plus a
 * Phaser `animationupdate` rebind so an auto-advanced frame cannot leave a
 * one-frame offset between sim syncs.
 */
export class ClassDecorations {
  private readonly scene: Phaser.Scene;
  private readonly art: ArtManifest['classArt'];
  private readonly decos = new Map<number, DecorSet>();
  private readonly last = new Map<number, LastSync>();

  constructor(scene: Phaser.Scene, manifest: ArtManifest | undefined) {
    this.scene = scene;
    // Boot.ts already validated the block; tolerate direct/undefined too.
    this.art = manifest?.classArt;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  /**
   * Place one unit's accessories from its live body sprite. `cargoBounds` is
   * the carried crate's drawn rectangle (null when empty-handed). Returns the
   * union bounds of body/head/cargo/badge/star for overhead markers, or null
   * for dead units (their art is hidden by the existing dead branch).
   */
  sync(
    unit: Unit,
    body: Phaser.GameObjects.Sprite,
    cargoBounds: VisualBounds | null,
  ): VisualBounds | null {
    this.last.set(unit.id, { unit, body, cargoBounds });
    const deco = this.decos.get(unit.id);
    if (unit.deadUntilTick !== null) {
      if (deco) this.setVisible(deco, false);
      return null;
    }
    const entry = unit.classId ? this.art?.classes[unit.classId] : undefined;
    const set = deco ?? this.create(unit.id, body);
    const drawn = bodyBounds(this.transformOf(body));
    let union = unionBounds(drawn, cargoBounds);
    const starVisible = unit.superBuddy === true && this.scene.textures.exists('badge_super');
    this.placeHead(set, body, entry);
    this.placeBadge(set, drawn, entry);
    this.placeStar(set, drawn, starVisible);
    union = unionBounds(union, this.kitBounds(drawn, entry !== undefined, starVisible));
    return union;
  }

  /** Remove every sprite and listener; safe to call twice. */
  destroy(): void {
    for (const set of this.decos.values()) {
      set.head.destroy();
      set.badge.destroy();
      set.star.destroy();
    }
    this.decos.clear();
    this.last.clear();
  }

  private create(id: number, body: Phaser.GameObjects.Sprite): DecorSet {
    const set: DecorSet = {
      head: this.scene.add.image(0, 0, '__DEFAULT').setName(`unit-${id}-head`).setVisible(false),
      badge: this.scene.add.image(0, 0, '__DEFAULT').setName(`unit-${id}-badge`).setVisible(false),
      star: this.scene.add.image(0, 0, '__DEFAULT').setName(`unit-${id}-star`).setVisible(false),
    };
    this.decos.set(id, set);
    // A destroyed body (scene shutdown) takes its decorations with it.
    body.once('destroy', () => {
      const owned = this.decos.get(id);
      if (owned === set) {
        this.decos.delete(id);
        this.last.delete(id);
        owned.head.destroy();
        owned.badge.destroy();
        owned.star.destroy();
      }
    });
    // §4.3: an auto-advanced frame must not leave a one-frame offset between
    // view syncs — replay the placement immediately from the live transform.
    body.on(Phaser.Animations.Events.ANIMATION_UPDATE, () => {
      const prev = this.last.get(id);
      if (prev && prev.unit.deadUntilTick === null)
        this.sync(prev.unit, prev.body, prev.cargoBounds);
    });
    return set;
  }

  private transformOf(body: Phaser.GameObjects.Sprite): BodyTransform {
    return {
      x: body.x,
      y: body.y,
      width: body.displayWidth,
      height: body.displayHeight,
      originX: body.originX,
      originY: body.originY,
      flipX: body.flipX,
    };
  }

  private headFrame(body: Phaser.GameObjects.Sprite, entry: ClassArtEntry): HeadFrame | null {
    if (!this.art || !entry) return null;
    const frames = this.art.headFrames[body.texture.key];
    if (!frames) return null;
    const index = Number(body.frame.name);
    if (!Number.isInteger(index) || index < 0 || index >= frames.length) return null;
    return frames[index] ?? null;
  }

  private placeHead(
    set: DecorSet,
    body: Phaser.GameObjects.Sprite,
    entry: ClassArtEntry | undefined,
  ): void {
    const frame = entry ? this.headFrame(body, entry) : null;
    if (!entry || !frame || !this.scene.textures.exists(entry.head)) {
      set.head.setVisible(false);
      return;
    }
    const geom = classVisualGeometry(this.transformOf(body), frame);
    set.head
      .setTexture(entry.head)
      .setPosition(geom.x, geom.y)
      .setDisplaySize(geom.width, geom.height)
      .setOrigin(0.5, 0.5)
      .setFlipX(body.flipX)
      .setDepth(body.depth + HEAD_DEPTH_OFFSET)
      .setVisible(true);
  }

  private placeBadge(set: DecorSet, drawn: VisualBounds, entry: ClassArtEntry | undefined): void {
    if (!entry || !this.scene.textures.exists(entry.badge)) {
      set.badge.setVisible(false);
      return;
    }
    set.badge
      .setTexture(entry.badge)
      .setPosition((drawn.left + drawn.right) / 2, drawn.top - OVERHEAD_GAP - BADGE_SIZE / 2)
      .setDisplaySize(BADGE_SIZE, BADGE_SIZE)
      .setOrigin(0.5, 0.5)
      .setDepth(Math.floor(drawn.bottom) + KIT_DEPTH_OFFSET)
      .setVisible(true);
  }

  private placeStar(set: DecorSet, drawn: VisualBounds, visible: boolean): void {
    if (!visible) {
      set.star.setVisible(false);
      return;
    }
    set.star
      .setTexture('badge_super')
      .setPosition(
        (drawn.left + drawn.right) / 2 + BADGE_SIZE / 2 + OVERHEAD_GAP + STAR_SIZE / 2,
        drawn.top - OVERHEAD_GAP - BADGE_SIZE / 2,
      )
      .setDisplaySize(STAR_SIZE, STAR_SIZE)
      .setOrigin(0.5, 0.5)
      .setDepth(Math.floor(drawn.bottom) + KIT_DEPTH_OFFSET)
      .setVisible(true);
  }

  /** Rectangle of the overhead band that is actually drawn, if any. */
  private kitBounds(drawn: VisualBounds, badge: boolean, star: boolean): VisualBounds | null {
    if (!badge && !star) return null;
    const centreX = (drawn.left + drawn.right) / 2;
    return {
      left: centreX - BADGE_SIZE / 2,
      top: drawn.top - OVERHEAD_GAP - BADGE_SIZE,
      right: star ? centreX + BADGE_SIZE / 2 + OVERHEAD_GAP + STAR_SIZE : centreX + BADGE_SIZE / 2,
      bottom: drawn.top - OVERHEAD_GAP,
    };
  }

  private setVisible(set: DecorSet, visible: boolean): void {
    set.head.setVisible(visible);
    set.badge.setVisible(visible);
    set.star.setVisible(visible);
  }
}
