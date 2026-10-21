import Phaser from 'phaser';
import { PAD_CELL_SIZE } from '@talad/sim';
import type { MatchState, Recipe } from '@talad/sim';
import { activeRecipe, glowStagePos } from './padPreview';
import { padArtStageWidth, padCenterOffset, STAGE_SCALE, worldToStage } from '../render/world';
import { recipeGlowColour } from './recipeColour';

/**
 * The `pad_tile_glow` sprite shown on the cell of the human's own pad that
 * unit 0 stands on. Phaser lives here — NOT in padPreview.ts — so the unit
 * test import graph stays engine-free (happy-dom has no 2d context).
 * R2c: positioned on the PAINTED tile (glowStagePos), not the world-rect cell.
 *
 * R2d (owner choice B, playtest 2026-10-21): while a valid recipe sits on the
 * human's pad, a soft rim glow in that weapon's colour pulses around the pad
 * art — layered ellipses behind the pad sprite, the same technique as the
 * view's groundGlow. Not-a-recipe / empty / team full / match over: no colour
 * glow. The pulse is OFF under prefers-reduced-motion (static rim remains).
 */

/** Rim layers: [ellipse scale vs the pad art width, fill alpha]. */
const RIM_LAYERS: ReadonlyArray<readonly [scale: number, alpha: number]> = [
  [1.3, 0.1],
  [1.12, 0.16],
  [0.92, 0.22],
];
/** The pad art frame is ~370x220 — keep the rim's iso-squashed proportions. */
const PAD_ART_RATIO = 220 / 370;
const PULSE_MS = 900;

export class PadGlow {
  private readonly scene: Phaser.Scene;
  private readonly img: Phaser.GameObjects.Image;
  private readonly rim: Phaser.GameObjects.Container;
  private readonly rimRings: Phaser.GameObjects.Ellipse[] = [];
  private pulse: Phaser.Tweens.Tween | null = null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private recipe: Recipe | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.img = scene.add.image(0, 0, 'pad_tile_glow');
    this.img.setDisplaySize(PAD_CELL_SIZE * STAGE_SCALE, PAD_CELL_SIZE * STAGE_SCALE * (116 / 214));
    this.img.setDepth(-4); // above the pad base (-5), below crates and units
    this.img.setVisible(false);
    this.rim = scene.add.container(0, 0);
    this.rim.setName('pad-recipe-glow');
    const artWidth = padArtStageWidth();
    for (const [scale, alpha] of RIM_LAYERS) {
      const ring = scene.add.ellipse(
        0,
        0,
        artWidth * scale,
        artWidth * scale * PAD_ART_RATIO,
        0xffffff,
        alpha,
      );
      this.rimRings.push(ring);
      this.rim.add(ring);
    }
    this.rim.setDepth(-6); // with the team glow, behind the pad art (-5)
    this.rim.setVisible(false);
  }

  sync(state: MatchState): void {
    const at = glowStagePos(state);
    if (!at || state.winner !== null) {
      this.img.setVisible(false);
    } else {
      this.img.setPosition(at.x, at.y);
      this.img.setVisible(true);
    }

    // R2d: recipe rim — valid recipe only, own (fruit) pad only.
    const recipe = activeRecipe(state);
    if (recipe === null) {
      this.rim.setVisible(false);
      this.pulse?.remove();
      this.pulse = null;
      this.recipe = null;
      return;
    }
    if (recipe !== this.recipe) {
      const colour = recipeGlowColour(recipe);
      this.rimRings.forEach((ring, i) => ring.setFillStyle(colour, RIM_LAYERS[i]![1]));
      this.recipe = recipe;
    }
    const centre = worldToStage({
      x: state.pads.fruit.origin.x + padCenterOffset().x,
      y: state.pads.fruit.origin.y + padCenterOffset().y,
    });
    this.rim.setPosition(centre.x, centre.y);
    this.rim.setVisible(true);
    if (this.reducedMotion.matches) {
      this.pulse?.remove();
      this.pulse = null;
      this.rim.setAlpha(1);
    } else if (!this.pulse) {
      this.pulse = this.scene.tweens.add({
        targets: this.rim,
        alpha: { from: 0.8, to: 1 },
        duration: PULSE_MS,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }
}
