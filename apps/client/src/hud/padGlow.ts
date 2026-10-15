import Phaser from 'phaser';
import { PAD_CELL_SIZE, padCellCenter } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { glowCellFor } from './padPreview';
import { STAGE_SCALE, worldToStage } from '../render/world';

/**
 * The `pad_tile_glow` sprite shown on the cell of the human's own pad that
 * unit 0 stands on. Phaser lives here — NOT in padPreview.ts — so the unit
 * test import graph stays engine-free (happy-dom has no 2d context).
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
    const col = glowCellFor(state);
    if (col === null || state.winner !== null) {
      this.img.setVisible(false);
      return;
    }
    const at = worldToStage(padCellCenter(state.pads.fruit, col));
    this.img.setPosition(at.x, at.y);
    this.img.setVisible(true);
  }
}
