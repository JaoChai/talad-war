import { PAD_CELL_SIZE, padCellAt, padPreview } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { th, recipeName, qualityName } from '../i18n/th';
import { itemLabel } from './status';
import { STAGE_H, STAGE_W, worldToStage } from '../render/world';

/**
 * The pad cell unit 0 stands on when alive on its own pad, else null — the
 * glow cell's source of truth (pure, unit-tested). The Phaser sprite that
 * draws it lives in padGlow.ts so this module stays engine-free.
 */
export function glowCellFor(state: MatchState): number | null {
  const unit = state.units[0];
  if (!unit || unit.team !== 'fruit' || unit.deadUntilTick !== null) return null;
  return padCellAt(state.pads.fruit, unit.pos);
}

/**
 * Pad preview (Task 9 layout): the "จะได้: <recipe>" text floating above the
 * fruit pad — moved out of hud/status.ts with the same text rules
 * (จะได้: <recipe> / ยังไม่ใช่สูตร / ทีมเต็มแล้ว; an empty pad hides it).
 */
export class PreviewText {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement | null;
  private textKey = '';

  constructor(mount: HTMLElement) {
    this.canvas = mount.closest('#app')?.querySelector('canvas') ?? null;
    this.el = document.createElement('div');
    this.el.className = 'tw-preview';
    this.el.hidden = true;
    mount.appendChild(this.el);
  }

  sync(state: MatchState): void {
    let text = '';
    let quality = false;
    let heavy = false;
    if (state.winner === null) {
      const preview = padPreview(state, 'fruit');
      if (!preview.openable) {
        if (preview.reason === 'notRecipe') text = th.preview_notRecipe;
        else if (preview.reason === 'teamFull') text = th.preview_teamFull;
        // Empty is hidden, and errors must never promise a recipe or star.
      } else {
        quality = preview.super;
        heavy = preview.recipe === 'heavy';
        text = th.willGet + qualityName(recipeName(preview.recipe), quality);
      }
    }
    if (text !== this.textKey) {
      this.textKey = text;
      this.el.replaceChildren(...(text ? [itemLabel(text, quality, heavy)] : []));
    }
    this.el.hidden = text === '';
    this.position(state);
  }

  private position(state: MatchState): void {
    if (!this.canvas) return;
    const origin = state.pads.fruit.origin;
    const at = worldToStage({ x: origin.x + 2 * PAD_CELL_SIZE, y: origin.y - 0.3 });
    const rect = this.canvas.getBoundingClientRect();
    const half = this.el.getBoundingClientRect().width / 2;
    const x = rect.left + (at.x * rect.width) / STAGE_W;
    this.el.style.left = `${Math.max(8 + half, Math.min(window.innerWidth - 8 - half, x))}px`;
    this.el.style.top = `${rect.top + (at.y * rect.height) / STAGE_H}px`;
  }
}
