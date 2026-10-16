import { describe, expect, it } from 'vitest';
import type { ItemId, Preview, Recipe, SquadCommand } from '@talad/sim';
import { commandName, itemName, qualityName, recipeName, t, th } from '../src/i18n/th';

/**
 * Enumerated from the sim unions, not a hand list: the `satisfies` clauses pin
 * every entry to a real sim member and the Record lines are the compile-time
 * exhaustiveness check — if the sim gains a recipe/reason/command, typecheck
 * fails here until the row is translated.
 */
const RECIPES = ['gun', 'bombs', 'buddy', 'heavy'] as const satisfies readonly Recipe[];
const ITEMS = ['unarmed', 'gun', 'heavy', 'bombs', 'crate'] as const satisfies readonly ItemId[];
const REASONS = ['notRecipe', 'teamFull', 'empty'] as const satisfies readonly PreviewReason[];
const COMMANDS = ['attack', 'guard', 'fetch'] as const satisfies readonly NonNullCommand[];

type PreviewReason = Extract<Preview, { openable: false }>['reason'];
type NonNullCommand = Exclude<SquadCommand, null>;

/** Thai script range — every UI string must actually be Thai (plan constraint). */
const THAI = /[\u0E00-\u0E7F]/;

describe('i18n coverage of sim unions', () => {
  it('maps every Recipe to a non-empty Thai string', () => {
    const exhaustive: Record<Recipe, true> = { gun: true, bombs: true, buddy: true, heavy: true };
    expect(Object.keys(exhaustive).length).toBe(RECIPES.length);
    for (const recipe of RECIPES) {
      const name = recipeName(recipe);
      expect(name, `recipe ${recipe}`).toBeTruthy();
      expect(name, `recipe ${recipe} is Thai`).toMatch(THAI);
    }
  });

  it('keeps exact recipe and item identities in normal and super Thai labels', () => {
    expect(recipeName('heavy')).toBe('บาซูก้ามะพร้าว');
    const recipeLabels: Record<Recipe, string> = {
      gun: 'ปืนฉีดน้ำ',
      bombs: 'ระเบิด',
      buddy: 'ลูกทีม',
      heavy: 'บาซูก้ามะพร้าว',
    };
    const itemLabels: Record<ItemId, string> = {
      unarmed: 'มือเปล่า',
      gun: 'ปืนฉีดน้ำ',
      heavy: 'บาซูก้ามะพร้าว',
      bombs: 'ระเบิด',
      crate: 'ลัง',
    };
    for (const recipe of RECIPES) {
      expect(recipeName(recipe)).toBe(recipeLabels[recipe]);
      expect(qualityName(recipeName(recipe), false)).toBe(recipeLabels[recipe]);
      expect(qualityName(recipeName(recipe), true)).toBe(`${recipeLabels[recipe]} พิเศษ`);
    }
    expect(Object.keys(itemLabels)).toHaveLength(ITEMS.length);
    for (const item of ITEMS) {
      expect(itemName(item)).toBe(itemLabels[item]);
      expect(itemName(item)).toMatch(THAI);
      expect(qualityName(itemName(item), false)).toBe(itemLabels[item]);
      expect(qualityName(itemName(item), true)).toBe(`${itemLabels[item]} พิเศษ`);
    }
    expect(th.howtoBuildBody).toBe(
      'บนแท่นของทีม: 1 ลังได้ปืน • 2 ลังข้างกันได้ระเบิด • 2 ลังซ้อนกันได้ลูกทีม • 4 ลังเต็มพื้นได้บาซูก้ามะพร้าว • ลังดาวทำให้ของพิเศษ',
    );
  });

  it('maps every Preview reason to a key; all non-empty except `empty`', () => {
    const exhaustive: Record<PreviewReason, true> = {
      notRecipe: true,
      teamFull: true,
      empty: true,
    };
    expect(Object.keys(exhaustive).length).toBe(REASONS.length);
    for (const reason of REASONS) {
      const key = `preview_${reason}` as keyof typeof th;
      const text = t(key);
      expect(typeof text, `reason ${reason} has a key`).toBe('string');
      if (reason === 'empty') {
        expect(text, 'empty intentionally maps to "" (preview hidden)').toBe('');
      } else {
        expect(text, `reason ${reason}`).toBeTruthy();
        expect(text, `reason ${reason} is Thai`).toMatch(THAI);
      }
    }
  });

  it('maps every non-null SquadCommand to a non-empty Thai label', () => {
    const exhaustive: Record<NonNullCommand, true> = { attack: true, guard: true, fetch: true };
    expect(Object.keys(exhaustive).length).toBe(COMMANDS.length);
    for (const cmd of COMMANDS) {
      const label = commandName(cmd);
      expect(label, `command ${cmd}`).toBeTruthy();
      expect(label, `command ${cmd} is Thai`).toMatch(THAI);
    }
  });

  it('keeps stall bar accessible names Thai', () => {
    expect(th.fruitStallName).toMatch(THAI);
    expect(th.dessertStallName).toMatch(THAI);
    expect(th.timerLabel).toMatch(THAI);
  });
});
