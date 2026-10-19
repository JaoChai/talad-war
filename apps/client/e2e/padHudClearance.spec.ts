import { expect, test, type Page } from '@playwright/test';
import { enterMatch } from './helpers';

/**
 * R2c acceptance: with both pads loaded the way real matches load them
 * (fruit: a 2-stack on col0 + cols 1,2,3; dessert: cols 0,1,3) at live match
 * time, NO HUD element covers any on-pad crate pixel — at 1280x800, 844x390
 * and 667x320. Crate boxes are the real Phaser sprite bounds (artFeedback)
 * mapped through the canvas rect; HUD boxes are the live DOM rects.
 */

const SIZES = [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
  { width: 667, height: 320 },
];

interface Rect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function stageLoadedPads(page: Page): Promise<void> {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await page.evaluate(() => {
    window.__talad.setPadLayout('fruit', [
      { col: 0, layer: 0 },
      { col: 0, layer: 1 },
      { col: 1, layer: 0 },
      { col: 2, layer: 0 },
      { col: 3, layer: 0 },
    ]);
    window.__talad.setPadLayout('dessert', [
      { col: 0, layer: 0 },
      { col: 1, layer: 0 },
      { col: 3, layer: 0 },
    ]);
    // Live match time, not 0:00 — the timer pill grows past its minimum.
    window.__talad.fastForward(25);
    const s = window.__talad.state() as unknown as import('@talad/sim').MatchState;
    window.__talad.renderSnapshot(s, s, 1);
  });
}

/** Every visible DOM HUD rect, named. Throws nothing for hidden/empty nodes. */
async function hudRects(page: Page): Promise<Rect[]> {
  return page.evaluate(() => {
    const selectors: [string, string][] = [
      ['fruitHp', '.tw-hp:not(.tw-hp--dessert)'],
      ['dessertHp', '.tw-hp--dessert'],
      ['timer', '.tw-timer'],
      ['loadout', '.tw-loadout'],
      ['preview', '.tw-preview'],
      ['switch', '#tw-btn-switch'],
      ['cmdAttack', '#tw-cmd-attack'],
      ['cmdGuard', '#tw-cmd-guard'],
      ['cmdFetch', '#tw-cmd-fetch'],
      ['btnFire', '#tw-btn-fire'],
      ['btnPick', '#tw-btn-pick'],
      ['btnThrow', '#tw-btn-throw'],
      ['btnOpen', '#tw-btn-open'],
    ];
    const out: Rect[] = [];
    for (const [name, sel] of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width <= 0 || r.height <= 0) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      out.push({ name, x: r.x, y: r.y, width: r.width, height: r.height });
    }
    return out;
  });
}

/** Screen-space boxes of every on-pad crate sprite (both teams). */
async function onPadCrateRects(page: Page): Promise<{ rects: Rect[]; onPadCount: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('canvas missing');
    const c = canvas.getBoundingClientRect();
    const st = window.__talad.state();
    const onPad = new Set<number>();
    for (const pad of [st.pads.fruit, st.pads.dessert]) {
      for (const col of pad!.cells) for (const id of col) if (id != null) onPad.add(id);
    }
    const sprites = window.__talad
      .artFeedback()
      .sprites.filter((s) => s.visible && onPad.has(Number(s.name.replace('crate-', ''))));
    return {
      onPadCount: onPad.size,
      rects: sprites.map((s) => ({
        name: s.name,
        x: c.x + ((s.x - s.width * s.originX) * c.width) / 1280,
        y: c.y + ((s.y - s.height * s.originY) * c.height) / 720,
        width: (s.width * c.width) / 1280,
        height: (s.height * c.height) / 720,
      })),
    };
  });
}

test.describe('R2c: HUD never covers on-pad crates', () => {
  for (const { width, height } of SIZES) {
    test(`${width}x${height}: loaded pads clear every HUD element`, async ({ page }, info) => {
      // Each size runs once across the two projects (mirrors r2Layout).
      test.skip((width === 1280) !== (info.project.name === 'desktop'));
      await page.setViewportSize({ width, height });
      await stageLoadedPads(page);
      await expect.poll(async () => page.locator('.tw-timer').textContent()).not.toBe('0:00');
      const { rects: crates, onPadCount } = await onPadCrateRects(page);
      expect(onPadCount).toBe(8); // 5 fruit + 3 dessert crates staged
      expect(crates).toHaveLength(8);
      const hud = await hudRects(page);
      // The loadout, preview and timer must all be live in this fixture.
      expect(hud.map((h) => h.name)).toEqual(
        expect.arrayContaining(['loadout', 'dessertHp', 'fruitHp', 'preview', 'timer']),
      );
      for (const h of hud) {
        for (const cr of crates) {
          const overlap =
            h.x < cr.x + cr.width &&
            h.x + h.width > cr.x &&
            h.y < cr.y + cr.height &&
            h.y + h.height > cr.y;
          expect(overlap, `${h.name} covers ${cr.name} at ${width}x${height}`).toBe(false);
        }
      }
    });
  }
});
