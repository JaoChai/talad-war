import type { Unit } from '@talad/sim';
import Phaser from 'phaser';
import type { ArtManifest, ClassArtEntry, HeadFrame } from './anims';
import {
  BADGE_SIZE,
  STAR_SIZE,
  bodyBounds,
  classVisualGeometry,
  kitAnchor,
  kitLayout,
  unionBounds,
  type BodyTransform,
  type KitLayout,
  type VisualBounds,
} from './classGeometry';

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
    const transform = this.transformOf(body);
    const frame = entry ? this.headFrame(body, entry) : null;
    const headVisible = !!entry && !!frame && this.scene.textures.exists(entry.head);
    // §4.3: the badge/star anchor on the union of body, head accessory and
    // cargo — the same kitAnchor the view's feet clamp reserves headroom for.
    const anchor = kitAnchor(
      transform,
      headVisible && frame ? classVisualGeometry(transform, frame).bounds : null,
      cargoBounds,
    );
    const starVisible = unit.superBuddy === true && this.scene.textures.exists('badge_super');
    const badgeVisible = !!entry && this.scene.textures.exists(entry.badge);
    const kit = kitLayout(anchor, badgeVisible, starVisible);
    // Depth stays on the body bottom so stacking order against other units is
    // unchanged; only the kit's position and bounds follow the anchor union.
    const kitDepth = Math.floor(bodyBounds(transform).bottom) + KIT_DEPTH_OFFSET;
    this.placeHead(set, body, entry, frame, transform);
    this.placeBadge(set, kit, entry, kitDepth);
    this.placeStar(set, kit, starVisible, kitDepth);
    return unionBounds(unionBounds(bodyBounds(transform), cargoBounds), kit ? kit.bounds : null);
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
    frame: HeadFrame | null,
    transform: BodyTransform,
  ): void {
    if (!entry || !frame || !this.scene.textures.exists(entry.head)) {
      set.head.setVisible(false);
      return;
    }
    const geom = classVisualGeometry(transform, frame);
    set.head
      .setTexture(entry.head)
      .setPosition(geom.x, geom.y)
      .setDisplaySize(geom.width, geom.height)
      .setOrigin(0.5, 0.5)
      .setFlipX(body.flipX)
      .setDepth(body.depth + HEAD_DEPTH_OFFSET)
      .setVisible(true);
  }

  private placeBadge(
    set: DecorSet,
    kit: KitLayout | null,
    entry: ClassArtEntry | undefined,
    depth: number,
  ): void {
    if (!kit || !entry || !this.scene.textures.exists(entry.badge)) {
      set.badge.setVisible(false);
      return;
    }
    set.badge
      .setTexture(entry.badge)
      .setPosition(kit.centreX, kit.badgeY)
      .setDisplaySize(BADGE_SIZE, BADGE_SIZE)
      .setOrigin(0.5, 0.5)
      .setDepth(depth)
      .setVisible(true);
  }

  private placeStar(set: DecorSet, kit: KitLayout | null, visible: boolean, depth: number): void {
    if (!kit || !visible) {
      set.star.setVisible(false);
      return;
    }
    set.star
      .setTexture('badge_super')
      .setPosition(kit.starX, kit.starY)
      .setDisplaySize(STAR_SIZE, STAR_SIZE)
      .setOrigin(0.5, 0.5)
      .setDepth(depth)
      .setVisible(true);
  }

  private setVisible(set: DecorSet, visible: boolean): void {
    set.head.setVisible(visible);
    set.badge.setVisible(visible);
    set.star.setVisible(visible);
  }
}
