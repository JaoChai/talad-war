import Phaser from 'phaser';
import { PAD_CELL_SIZE } from '@talad/sim';
import type { MatchState, Recipe } from '@talad/sim';
import { activeRecipe, glowStagePos } from './padPreview';
import { padArtStageWidth, padCenterOffset, STAGE_SCALE, worldToStage } from '../render/world';
import { recipeGlowColour, recipeGlowHighlight } from './recipeColour';

/**
 * The `pad_tile_glow` sprite shown on the cell of the human's own pad that
 * unit 0 stands on. Phaser lives here — NOT in padPreview.ts — so the unit
 * test import graph stays engine-free (happy-dom has no 2d context).
 * R2c: positioned on the PAINTED tile (glowStagePos), not the world-rect cell.
 *
 * R2d (owner choice B, playtest 2026-10-21): while a valid recipe sits on the
 * human's pad, the pad glows in that weapon's colour. Review round 1 #1: the
 * first pass drew only floor haloes BEHIND the art (depth -6) and they read as
 * haze. Now the colour is drawn ON the pad art itself — a saturated stroked
 * outline ring sitting at depth -4 (above the pad art at -5, below the crates,
 * which render at their floor y >= 0) — plus two soft halo ellipses behind for
 * the bloom. Not-a-recipe / empty / team full / match over: no colour glow.
 * The pulse is OFF under prefers-reduced-motion (static rim remains).
 */

/** Soft bloom haloes behind the pad art: [ellipse scale vs the art width, fill alpha]. */
const HALO_LAYERS: ReadonlyArray<readonly [scale: number, alpha: number]> = [
  [1.3, 0.3],
  [1.12, 0.45],
];
/**
 * The saturated outline rings ON the art: [scale vs art width, line width in
 * stage px, stroke alpha, colour kind]. The 0.99x ring is the derived
 * HIGHLIGHT (a light line on the pad surface — the part that makes the dark
 * coconut-brown readable); the 1.07x ring is the weapon colour hugging the
 * outer edge; the 1.18x one softens the step to the floor.
 */
const RIM_RINGS: ReadonlyArray<
  readonly [scale: number, width: number, alpha: number, kind: 'base' | 'highlight']
> = [
  [0.99, 5, 0.95, 'highlight'],
  [1.07, 12, 1, 'base'],
  [1.18, 4, 0.5, 'base'],
];
/** The pad art frame is ~370x220 — keep the rim's iso-squashed proportions. */
const PAD_ART_RATIO = 220 / 370;
const PULSE_MS = 900;

export class PadGlow {
  private readonly scene: Phaser.Scene;
  private readonly img: Phaser.GameObjects.Image;
  /** Soft bloom, behind the pad art (-5). */
  private readonly halos: Phaser.GameObjects.Container;
  private readonly haloRings: Phaser.GameObjects.Ellipse[] = [];
  /** Saturated outline ON the pad art, below the crates. */
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
    const artWidth = padArtStageWidth();
    this.halos = scene.add.container(0, 0);
    this.halos.setName('pad-recipe-halos');
    for (const [scale, alpha] of HALO_LAYERS) {
      const halo = scene.add.ellipse(
        0,
        0,
        artWidth * scale,
        artWidth * scale * PAD_ART_RATIO,
        0xffffff,
        alpha,
      );
      this.haloRings.push(halo);
      this.halos.add(halo);
    }
    this.halos.setDepth(-6); // with the team glow, behind the pad art
    this.halos.setVisible(false);
    this.rim = scene.add.container(0, 0);
    this.rim.setName('pad-recipe-glow');
    for (const [scale, width, alpha] of RIM_RINGS) {
      const ring = scene.add.ellipse(0, 0, artWidth * scale, artWidth * scale * PAD_ART_RATIO);
      // Fillless stroked outline — the colour ON the pad art's edge.
      ring.setStrokeStyle(width, 0xffffff, alpha);
      this.rimRings.push(ring);
      this.rim.add(ring);
    }
    // Above the pad art (-5) and the tile glow (-4, added earlier so it sorts
    // below), below every crate/unit (they render at floor(y) >= 0).
    this.rim.setDepth(-4);
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
      this.halos.setVisible(false);
      this.pulse?.remove();
      this.pulse = null;
      this.recipe = null;
      return;
    }
    if (recipe !== this.recipe) {
      const colour = recipeGlowColour(recipe);
      const highlight = recipeGlowHighlight(recipe);
      this.rimRings.forEach((ring, i) => {
        const [, width, alpha, kind] = RIM_RINGS[i]!;
        ring.setStrokeStyle(width, kind === 'highlight' ? highlight : colour, alpha);
      });
      this.haloRings.forEach((halo, i) => halo.setFillStyle(colour, HALO_LAYERS[i]![1]));
      this.recipe = recipe;
    }
    const centre = worldToStage({
      x: state.pads.fruit.origin.x + padCenterOffset().x,
      y: state.pads.fruit.origin.y + padCenterOffset().y,
    });
    this.rim.setPosition(centre.x, centre.y);
    this.halos.setPosition(centre.x, centre.y);
    this.rim.setVisible(true);
    this.halos.setVisible(true);
    if (this.reducedMotion.matches) {
      this.pulse?.remove();
      this.pulse = null;
      this.rim.setAlpha(1);
      this.halos.setAlpha(1);
    } else if (!this.pulse) {
      this.pulse = this.scene.tweens.add({
        targets: [this.rim, this.halos],
        alpha: { from: 0.8, to: 1 },
        duration: PULSE_MS,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }
}
