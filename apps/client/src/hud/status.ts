import { PAD_CELL_SIZE, padPreview } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { th, recipeName } from '../i18n/th';
import { worldToStage } from '../render/world';

const STAGE_W = 1280;
const STAGE_H = 720;

/**
 * Minimal HUD overlay (Task 8): the pad preview text near the human team's pad
 * and the winner banner. Task 9 replaces this with the full HUD components.
 */
export class MatchHud {
  private readonly preview: HTMLDivElement;
  private readonly winner: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement | null;

  constructor(mount: HTMLElement) {
    this.canvas = mount.querySelector('canvas');
    this.preview = document.createElement('div');
    this.preview.className = 'tw-preview';
    this.preview.hidden = true;
    this.winner = document.createElement('div');
    this.winner.className = 'tw-winner';
    this.winner.hidden = true;
    mount.append(this.preview, this.winner);
  }

  sync(state: MatchState): void {
    // Preview text: what Open! would give at the human (fruit) pad right now.
    let text = '';
    if (state.winner === null) {
      const preview = padPreview(state, 'fruit');
      if (preview.recipe !== null) text = th.willGet + recipeName(preview.recipe);
      else if (preview.reason === 'notRecipe') text = th.notRecipe;
      else if (preview.reason === 'teamFull') text = th.teamFull;
    }
    this.preview.textContent = text;
    this.preview.hidden = text === '';
    this.positionPreview(state);

    if (state.winner !== null) {
      this.winner.textContent =
        state.winner === 'fruit' ? th.youWin : state.winner === 'dessert' ? th.youLose : th.draw;
      this.winner.hidden = false;
    }
  }

  private positionPreview(state: MatchState): void {
    if (!this.canvas) return;
    const origin = state.pads.fruit.origin;
    const at = worldToStage({ x: origin.x + 2 * PAD_CELL_SIZE, y: origin.y - 0.3 });
    const rect = this.canvas.getBoundingClientRect();
    this.preview.style.left = `${rect.left + (at.x * rect.width) / STAGE_W}px`;
    this.preview.style.top = `${rect.top + (at.y * rect.height) / STAGE_H}px`;
  }
}
