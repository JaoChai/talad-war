import { describe, expect, it } from 'vitest';
import type { Recipe } from '@talad/sim';
import {
  RECIPE_COLOURS,
  recipeGlowColour,
  recipeGlowHighlight,
  recipeGlowShadow,
} from '../src/hud/recipeColour';

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
    expect(RECIPE_COLOURS.heavy).toBe('#8a4d15'); // dark coconut-brown
    expect(RECIPE_COLOURS.buddy).toBe('#f783ac'); // pink
    expect(RECIPE_COLOURS.class).toBe('#9775fa'); // purple
  });

  it('keeps heavy clearly separable from bombs (review round 1 #1)', () => {
    // The old tan #c7893b read as the same warm haze as bombs over the dark
    // floor (RGB distance ~59). The rim must name the weapon at a glance.
    const distance = (a: string, b: string) => {
      const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const [ra, ga, ba] = rgb(a);
      const [rb, gb, bb] = rgb(b);
      return Math.sqrt((ra! - rb!) ** 2 + (ga! - gb!) ** 2 + (ba! - bb!) ** 2);
    };
    expect(distance(RECIPE_COLOURS.heavy, RECIPE_COLOURS.bombs)).toBeGreaterThanOrEqual(100);
  });

  it('exposes the same colours as Phaser ints for the pad glow', () => {
    const recipes: Recipe[] = ['gun', 'bombs', 'buddy', 'heavy', 'class'];
    for (const recipe of recipes) {
      expect(recipeGlowColour(recipe)).toBe(parseInt(RECIPE_COLOURS[recipe]!.slice(1), 16));
    }
    expect(recipeGlowColour('gun')).toBe(0x4dabf7);
  });

  it('derives a lighter glow accent per recipe (review round 1 #1: heavy must not sink)', () => {
    // The dark coconut-brown needs a bright companion line on the pad or it
    // drowns under the crates' warm glows. Derived from the SAME hex — never a
    // second literal.
    for (const recipe of Object.keys(RECIPE_COLOURS) as Recipe[]) {
      const base = RECIPE_COLOURS[recipe]!;
      const hi = recipeGlowHighlight(recipe);
      expect(hi, recipe).toBeGreaterThan(parseInt(base.slice(1), 16));
    }
    expect(recipeGlowHighlight('heavy')).toBe(0xbf9d7e); // lighten(#8a4d15, 45%)
  });

  it('derives a darker glow frame per recipe (heavy must not bleed into the crate gold)', () => {
    // Four crates carry warm golden glows; without a dark frame the brown rim
    // bleeds into that gold and reads "amber". Derived from the SAME hex.
    for (const recipe of Object.keys(RECIPE_COLOURS) as Recipe[]) {
      const base = RECIPE_COLOURS[recipe]!;
      const shadow = recipeGlowShadow(recipe);
      expect(shadow, recipe).toBeLessThan(parseInt(base.slice(1), 16));
    }
    expect(recipeGlowShadow('heavy')).toBe(0x5a320e); // darken(#8a4d15, 35%)
  });
});
