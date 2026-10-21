import { describe, expect, it } from 'vitest';
import type { Recipe } from '@talad/sim';
import { RECIPE_COLOURS, recipeGlowColour } from '../src/hud/recipeColour';

/**
 * R2d (owner choice B, playtest 2026-10-21): one colour per recipe, shared by
 * the mixing-label chip AND the pad rim glow so the two always match.
 * gun=sky blue, bombs=orange, heavy=brown/amber, buddy=pink, class=purple.
 */
describe('recipe colours (owner choice B)', () => {
  it('maps exactly the five recipes to five distinct colours', () => {
    const keys = Object.keys(RECIPE_COLOURS).sort();
    expect(keys).toEqual(['bombs', 'buddy', 'class', 'gun', 'heavy']);
    const values = Object.values(RECIPE_COLOURS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('pins the owner-chosen hues', () => {
    expect(RECIPE_COLOURS.gun).toBe('#4dabf7'); // sky blue
    expect(RECIPE_COLOURS.bombs).toBe('#ff922b'); // orange
    expect(RECIPE_COLOURS.heavy).toBe('#c7893b'); // brown/amber
    expect(RECIPE_COLOURS.buddy).toBe('#f783ac'); // pink
    expect(RECIPE_COLOURS.class).toBe('#9775fa'); // purple
  });

  it('exposes the same colours as Phaser ints for the pad glow', () => {
    const recipes: Recipe[] = ['gun', 'bombs', 'buddy', 'heavy', 'class'];
    for (const recipe of recipes) {
      expect(recipeGlowColour(recipe)).toBe(parseInt(RECIPE_COLOURS[recipe]!.slice(1), 16));
    }
    expect(recipeGlowColour('gun')).toBe(0x4dabf7);
  });
});
