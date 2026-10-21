import { PAD_CELL_SIZE, padCellAt, padPreview, controlledUnit } from '@talad/sim';
import type { MatchState, Recipe, Vec2 } from '@talad/sim';
import { th, recipeName, qualityName } from '../i18n/th';
import { itemLabel } from './status';
import { RECIPE_COLOURS } from './recipeColour';
import { STAGE_H, STAGE_W, padPaintedCellStagePos, worldToStage } from '../render/world';

/** R2d greys for the not-a-recipe label (card: "Not a recipe: grey ยังไม่ใช่สูตร"). */
const NOT_RECIPE_TEXT = '#adb5bd';
const NOT_RECIPE_BORDER = '#868e96';

/**
 * R2d: the recipe currently mixed on the human's own pad, or null when nothing
 * valid sits there (empty / not a recipe / team full / match over). Pure
 * source of truth shared by the label chip and the pad rim glow (padGlow.ts)
 * so a weapon's label colour and glow colour can never diverge.
 */
export function activeRecipe(state: MatchState): Recipe | null {
  if (state.winner !== null) return null;
  const preview = padPreview(state, 'fruit');
  return preview.openable ? preview.recipe : null;
}

/**
 * The pad cell the controlled body stands on when alive on its own pad, else
 * null — the glow cell's source of truth (pure, unit-tested). R2-9: follows
 * `controlledUnit`, so a released body is a bot and never lights the glow.
 * The Phaser sprite that draws it lives in padGlow.ts so this module stays
 * engine-free (happy-dom has no 2d context).
 */
export function glowCellFor(state: MatchState): number | null {
  const unit = controlledUnit(state);
  if (!unit || unit.team !== 'fruit' || unit.deadUntilTick !== null) return null;
  return padCellAt(state.pads.fruit, unit.pos);
}

/**
 * R2c: the glow's stage position — the PAINTED tile centre of the glow cell,
 * not the world-rect cell centre (the x1.3 art grew away from the world rect,
 * so the old position glowed the skirt). Pure so the unit tests stay
 * engine-free; PadGlow (Phaser) is the only consumer.
 */
export function glowStagePos(state: MatchState): Vec2 | null {
  const col = glowCellFor(state);
  if (col === null) return null;
  return padPaintedCellStagePos(state.pads.fruit.origin, col);
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
    let weapon: Recipe | null = null;
    let notRecipe = false;
    if (state.winner === null) {
      const preview = padPreview(state, 'fruit');
      if (!preview.openable) {
        if (preview.reason === 'notRecipe') {
          text = th.preview_notRecipe;
          notRecipe = true;
        } else if (preview.reason === 'teamFull') text = th.preview_teamFull;
        // Empty is hidden, and errors must never promise a recipe or star.
      } else {
        quality = preview.super;
        heavy = preview.recipe === 'heavy';
        weapon = preview.recipe;
        // R2d (owner: "เวลาผสมก็ต้องบอกด้วย ว่ากำลังผสมอาวุธอะไร").
        text = th.mixing + qualityName(recipeName(preview.recipe), quality);
      }
    }
    if (text !== this.textKey) {
      this.textKey = text;
      if (!text) {
        this.el.replaceChildren();
      } else {
        const label = itemLabel(text, quality, heavy);
        if (weapon) {
          // R2d chip: same map as the pad rim glow, so the colours always match.
          const chip = document.createElement('span');
          chip.className = 'tw-chip';
          chip.setAttribute('aria-hidden', 'true');
          chip.style.background = RECIPE_COLOURS[weapon];
          label.prepend(chip);
        }
        this.el.replaceChildren(label);
      }
    }
    this.el.hidden = text === '';
    // R2d: weapon-colour border for a valid recipe, grey for not-a-recipe,
    // default panel border for team-full (unchanged look).
    this.el.style.borderColor = weapon
      ? RECIPE_COLOURS[weapon]
      : notRecipe
        ? NOT_RECIPE_BORDER
        : '';
    this.el.style.color = notRecipe ? NOT_RECIPE_TEXT : '';
    this.position(state);
  }

  private position(state: MatchState): void {
    if (!this.canvas) return;
    const origin = state.pads.fruit.origin;
    // R2c: the x1.3 art raised the 2-stack sprite, so the label needs a higher
    // anchor on desktop-scale canvases; on phone-landscape canvases the tray
    // (DOM-fixed px) binds instead. R2d: the 66px crates + 43px stack lift and
    // the taller 18px label raised the stack tops / label box into both the
    // class tray (docked top-left or bottom-41vh) and the stacks. The label
    // box is <=27px tall in the small band (<=34px desktop), and the 0.9 lift
    // centers it in the measured tray..stacks window at every padHudClearance
    // size (R2c round-3 probes: 800x304 tray bottom 174, stack top ~214).
    const lift = 0.9;
    const at = worldToStage({ x: origin.x + 2 * PAD_CELL_SIZE, y: origin.y - lift });
    const rect = this.canvas.getBoundingClientRect();
    const half = this.el.getBoundingClientRect().width / 2;
    const x = rect.left + (at.x * rect.width) / STAGE_W;
    this.el.style.left = `${Math.max(8 + half, Math.min(window.innerWidth - 8 - half, x))}px`;
    this.el.style.top = `${rect.top + (at.y * rect.height) / STAGE_H}px`;
  }
}
