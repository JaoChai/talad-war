import Phaser from 'phaser';
import type { Unit } from '@talad/sim';
import type { ArtManifest } from './anims';
import { OVERHEAD_GAP } from './classGeometry';
import type { VisualBounds } from './classGeometry';

/** §5 control-marker metrics (logical stage px). */
const RING_W = 52;
const RING_H = 26;
const ARROW_SIZE = 20;
const ARROW_MIN_Y = ARROW_SIZE;
const BOB_MS = 250;
const BOB_PX = 3;
/** White marker + ink keyline — deliberately neither team colour nor the blue aim ring. */
const WHITE = 0xffffff;
const INK = 0x251414;
const ARROW_DEPTH = 2000;

/**
 * §5: the single white ring/arrow pair that marks the controlled body. The
 * ring sits at the drawn feet (52×26, ×1.20 on Giant); the down-arrow rides
 * 4 px above the unit's overhead union (head accessory, cargo, badge/star
 * kit) at 20×20. It draws no class adornments of its own — those belong to
 * ClassDecorations — and every sync reuses the same two game objects (art
 * image when the manifest art exists, primitive fallback when it does not),
 * so there is never a second marker.
 */
export class ControlledMarker {
  private readonly ring: Phaser.GameObjects.Image;
  private readonly ringFallback: Phaser.GameObjects.Ellipse;
  private readonly arrow: Phaser.GameObjects.Image;
  private readonly arrowFallback: Phaser.GameObjects.Triangle;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly manifest: ArtManifest | undefined,
  ) {
    this.ring = scene.add.image(0, 0, '__DEFAULT');
    this.ring.setName('control-ring');
    this.ring.setOrigin(0.5, 0.5);
    this.ring.setVisible(false);

    this.ringFallback = scene.add.ellipse(0, 0, RING_W, RING_H, WHITE, 1);
    this.ringFallback.setStrokeStyle(3, INK, 1);
    this.ringFallback.setName('control-ring-fallback');
    this.ringFallback.setVisible(false);

    this.arrow = scene.add.image(0, 0, '__DEFAULT');
    this.arrow.setName('control-arrow');
    this.arrow.setOrigin(0.5, 1);
    this.arrow.setVisible(false);

    this.arrowFallback = scene.add.triangle(
      0,
      0,
      0,
      ARROW_SIZE,
      ARROW_SIZE / 2,
      0,
      ARROW_SIZE,
      ARROW_SIZE,
      WHITE,
    );
    this.arrowFallback.setStrokeStyle(2, INK, 1);
    this.arrowFallback.setName('control-arrow-fallback');
    this.arrowFallback.setVisible(false);

    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /**
   * Bind the pair to one body. Null unit/body/bounds (all-bot state, dead or
   * unplaced controlled body) hides both objects.
   */
  sync(
    unit: Unit | null,
    body: Phaser.GameObjects.Sprite | null,
    overheadBounds: VisualBounds | null,
  ): void {
    if (this.destroyed) return;
    if (!unit || !body || !overheadBounds || unit.deadUntilTick !== null) {
      this.ring.setVisible(false);
      this.ringFallback.setVisible(false);
      this.arrow.setVisible(false);
      this.arrowFallback.setVisible(false);
      return;
    }
    const control = this.manifest?.classArt?.control;
    const scale = unit.classId
      ? (this.manifest?.classArt?.classes[unit.classId]?.bodyScale ?? 1)
      : 1;

    // Ground ring at the drawn feet — body.y is the drawn feet line minus the
    // 2 px the team rings ride, so both rings share one ground rule.
    const feet = body.y - 2;
    const useRing = !!control?.ring && this.scene.textures.exists(control.ring);
    if (useRing) {
      this.ring.setTexture(control!.ring);
      this.ring.setPosition(body.x, feet);
      this.ring.setDisplaySize(RING_W * scale, RING_H * scale);
      this.ring.setDepth(Math.floor(feet));
      this.ring.setVisible(true);
      this.ringFallback.setVisible(false);
    } else {
      this.ringFallback.setPosition(body.x, feet);
      this.ringFallback.setDisplaySize(RING_W * scale, RING_H * scale);
      this.ringFallback.setDepth(Math.floor(feet));
      this.ringFallback.setVisible(true);
      this.ring.setVisible(false);
    }

    // Down-arrow above the overhead union with a 4 px clearance; stays fully
    // on-canvas and keeps its position still under reduced motion.
    const bob = this.reducedMotion.matches ? 0 : Math.sin(this.scene.time.now / BOB_MS) * BOB_PX;
    const arrowY = Math.max(overheadBounds.top - OVERHEAD_GAP + bob, ARROW_MIN_Y);
    const useArrow = !!control?.arrow && this.scene.textures.exists(control.arrow);
    if (useArrow) {
      this.arrow.setTexture(control!.arrow);
      this.arrow.setPosition(body.x, arrowY);
      this.arrow.setDisplaySize(ARROW_SIZE, ARROW_SIZE);
      this.arrow.setDepth(ARROW_DEPTH);
      this.arrow.setVisible(true);
      this.arrowFallback.setVisible(false);
    } else {
      this.arrowFallback.setPosition(body.x, arrowY - ARROW_SIZE / 2);
      this.arrowFallback.setDisplaySize(ARROW_SIZE, ARROW_SIZE);
      this.arrowFallback.setDepth(ARROW_DEPTH);
      this.arrowFallback.setVisible(true);
      this.arrow.setVisible(false);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const obj of [this.ring, this.ringFallback, this.arrow, this.arrowFallback]) {
      obj.destroy();
    }
  }
}
