import type { Recipe } from '@talad/sim';

/**
 * R2d (owner choice B, playtest 2026-10-21: "พอผสมครบ ก็มีสีด้วย
 * จะได้เช็คง่ายๆ"): ONE colour per recipe, used by BOTH the mixing-label chip
 * (CSS hex) and the pad rim glow (Phaser int) so the two always match.
 * gun=sky blue, bombs=orange, heavy=saturated coconut-brown, buddy=pink, class=purple.
 */
export const RECIPE_COLOURS: Readonly<Record<Recipe, string>> = {
  gun: '#4dabf7',
  bombs: '#ff922b',
  heavy: '#a05a17',
  buddy: '#f783ac',
  class: '#9775fa',
};

/** The same colour as a Phaser-compatible 0xRRGGBB int. */
export function recipeGlowColour(recipe: Recipe): number {
  return parseInt(RECIPE_COLOURS[recipe].slice(1), 16);
}

/**
 * A lighter companion of the SAME hex (mixed 45% toward white) for the glow's
 * inner accent line — review round 1 #1: dark hues (coconut-brown) need a
 * bright line on the pad or they drown under the crates' warm glows. Derived,
 * never a second literal, so chip / glow / accent can never diverge.
 */
export function recipeGlowHighlight(recipe: Recipe): number {
  const hex = RECIPE_COLOURS[recipe];
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)!);
  const [r, g, b] = c.map((v) => Math.round(v + (255 - v) * 0.45));
  return ((r! << 16) | (g! << 8) | b!) >>> 0;
}
