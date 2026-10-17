import Phaser from 'phaser';
import { autoAimTarget, controlledUnit } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { worldToStage } from '../render/world';

const FRUIT_COLOUR = 0x2f7bff;
const RADIUS = 16;

/** Small fruit-coloured ring at `autoAimTarget(state, <controlled id>)` (R2-9). */
export class AimMarker {
  private readonly ring: Phaser.GameObjects.Arc;

  constructor(scene: Phaser.Scene) {
    this.ring = scene.add.circle(0, 0, RADIUS, 0x000000, 0);
    this.ring.setStrokeStyle(3, FRUIT_COLOUR, 0.9);
    this.ring.setDepth(1500);
    this.ring.setVisible(false);
  }

  sync(state: MatchState): void {
    // R2-9: aim from the controlled body — its enemy is highlighted, never
    // the body it released (and never the marker's own target).
    const controlled = controlledUnit(state);
    const target =
      controlled && controlled.deadUntilTick === null && state.winner === null
        ? autoAimTarget(state, controlled.id)
        : null;
    if (!target) {
      this.ring.setVisible(false);
      return;
    }
    const at = worldToStage(target);
    this.ring.setPosition(at.x, Math.max(at.y, RADIUS));
    this.ring.setVisible(true);
  }
}
