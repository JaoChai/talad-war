import Phaser from 'phaser';
import { PAD_CELL_SIZE } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { glowStagePos } from './padPreview';
import { STAGE_SCALE } from '../render/world';

/**
 * The `pad_tile_glow` sprite shown on the cell of the human's own pad that
 * unit 0 stands on. Phaser lives here — NOT in padPreview.ts — so the unit
 * test import graph stays engine-free (happy-dom has no 2d context).
 * R2c: positioned on the PAINTED tile (glowStagePos), not the world-rect cell.
 */
export class PadGlow {
  private readonly img: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene) {
    this.img = scene.add.image(0, 0, 'pad_tile_glow');
    this.img.setDisplaySize(PAD_CELL_SIZE * STAGE_SCALE, PAD_CELL_SIZE * STAGE_SCALE * (116 / 214));
    this.img.setDepth(-4); // above the pad base (-5), below crates and units
    this.img.setVisible(false);
  }

  sync(state: MatchState): void {
    const at = glowStagePos(state);
    if (!at || state.winner !== null) {
      this.img.setVisible(false);
      return;
    }
    this.img.setPosition(at.x, at.y);
    this.img.setVisible(true);
  }
}
