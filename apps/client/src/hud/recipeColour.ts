import type { Recipe } from '@talad/sim';

/**
 * R2d (owner choice B, playtest 2026-10-21: "พอผสมครบ ก็มีสีด้วย
 * จะได้เช็คง่ายๆ"): ONE colour per recipe, used by BOTH the mixing-label chip
 * (CSS hex) and the pad rim glow (Phaser int) so the two always match.
 * gun=sky blue, bombs=orange, heavy=brown/amber, buddy=pink, class=purple.
 */
export const RECIPE_COLOURS: Readonly<Record<Recipe, string>> = {
  gun: '#4dabf7',
  bombs: '#ff922b',
  heavy: '#c7893b',
  buddy: '#f783ac',
  class: '#9775fa',
};

/** The same colour as a Phaser-compatible 0xRRGGBB int. */
export function recipeGlowColour(recipe: Recipe): number {
  return parseInt(RECIPE_COLOURS[recipe].slice(1), 16);
}
