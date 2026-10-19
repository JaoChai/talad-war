import { expect, test, type Page } from '@playwright/test';
import { enterMatch } from './helpers';

/**
 * R2c acceptance: with both pads loaded the way real matches load them
 * (fruit: a 2-stack on col0 + cols 1,2,3; dessert: cols 0,1,3) at live match
 * time, NO HUD element covers any on-pad crate pixel. Crate boxes are the
 * real Phaser sprite bounds (artFeedback) mapped through the canvas rect;
 * HUD boxes are the live DOM rects.
 *
 * Sizes: the three card sizes plus the small-phone landscapes from review
 * round 1 (comment #435/#444): 740x360 (dessert HP icon regression),
 * 700x360, 640x360, 690x390 (guard/loadout over dessert crates) and
 * 568x320 (guard/loadout + #tw-btn-switch over crates).
 *
 * Round 3 (review #449) adds a HUD-to-HUD contract: in the small-phone band
 * the loadout pill must keep an 8px gap from the command controls
 * (guard/attack/fetch/switch) so both labels stay readable.
 */

const SIZES = [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
  { width: 667, height: 320 },
  { width: 740, height: 360 },
  { width: 700, height: 360 },
  { width: 690, height: 390 },
  { width: 640, height: 360 },
  { width: 600, height: 340 },
  { width: 640, height: 320 },
  { width: 568, height: 320 },
];

/** Review #449: sizes where the loadout pill vs command row is pinned. */
const HUD_GAP_SIZES = [
  { width: 560, height: 320 },
  { width: 568, height: 320 },
  { width: 600, height: 340 },
  { width: 640, height: 320 },
  { width: 640, height: 360 },
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
      ['tray', '#tw-class-pick'],
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

test.describe('R2c round 3: loadout pill keeps an 8px gap to the command controls', () => {
  for (const { width, height } of HUD_GAP_SIZES) {
    test(`${width}x${height}: loadout clears guard/attack/fetch/switch by 8px`, async ({
      page,
    }, info) => {
      test.skip((width === 1280) !== (info.project.name === 'desktop'));
      await page.setViewportSize({ width, height });
      await stageLoadedPads(page);
      await expect.poll(async () => page.locator('.tw-timer').textContent()).not.toBe('0:00');
      const hud = await hudRects(page);
      const loadout = hud.find((r) => r.name === 'loadout');
      if (!loadout) throw new Error(`loadout missing at ${width}x${height}`);
      for (const name of ['cmdGuard', 'cmdAttack', 'cmdFetch', 'switch'] as const) {
        const btn = hud.find((r) => r.name === name);
        if (!btn) throw new Error(`${name} missing at ${width}x${height}`);
        const gapX = Math.max(btn.x - (loadout.x + loadout.width), loadout.x - (btn.x + btn.width));
        const gapY = Math.max(
          btn.y - (loadout.y + loadout.height),
          loadout.y - (btn.y + btn.height),
        );
        expect(
          gapX >= 8 || gapY >= 8,
          `loadout [${fmt(loadout)}] vs ${name} [${fmt(btn)}] at ${width}x${height}: ` +
            `gapX=${gapX.toFixed(1)} gapY=${gapY.toFixed(1)}`,
        ).toBe(true);
      }
    });
  }
});

const BAND_SIZES = [
  [560, 320],
  [568, 320],
  [600, 340],
  [640, 320],
  [640, 360],
  [667, 320],
  [680, 320],
  [690, 320],
  [700, 320],
  [700, 340],
  [740, 360],
  [800, 360],
  // Breakpoint edges and browser-bar heights independently exercise the band.
  [560, 400],
  [700, 400],
  [701, 351],
  [788, 351],
  [843, 390],
  [800, 304],
] as const;

function rectGap(a: Rect, b: Rect): number {
  return Math.max(
    b.x - a.x - a.width,
    a.x - b.x - b.width,
    b.y - a.y - a.height,
    a.y - b.y - b.height,
  );
}

// Regressions caught: moving the pill into ANY preview/action/tray slot, or
// growing a held-item row back across an obstacle. All painted sibling panels
// participate; children (HP fill, class buttons) are checked inside their panel.
for (const [width, height] of BAND_SIZES) {
  test(`${width}x${height}: whole-band HUD clearance in away, crafting and open states`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile-landscape');
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height });
    await stageLoadedPads(page);
    await page.evaluate(() => {
      window.__talad.setCommand('fruit', 'attack');
      for (const id of [1, 2]) window.__talad.placeUnit(id, 31 + id, 9 + id);
      window.__talad.setPadLayout('fruit', [
        { col: 0, layer: 0, kind: 'super' },
        { col: 1, layer: 0 },
      ]);
      const s = window.__talad.state();
      const cr = s.crates.find((c) => c.id === s.pads.fruit!.cells[0]![0])!;
      window.__talad.placeUnit(0, cr.pos.x, cr.pos.y);
      window.__talad.stepInputs([
        [
          0,
          {
            move: { x: 0, y: 0 },
            aim: null,
            fire: false,
            throwBomb: false,
            pickDrop: false,
            open: true,
          },
        ],
      ]);
      window.__talad.fastForward(25);
    });
    await expect(page.locator('#tw-btn-throw')).toBeVisible();
    const evidence: unknown[] = [];
    for (const staging of ['crafting', 'open', 'away'] as const) {
      await page.evaluate((staging) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        window.__talad.setPadLayout(
          'fruit',
          staging === 'crafting'
            ? [
                { col: 0, layer: 0 },
                { col: 0, layer: 1 },
                { col: 1, layer: 0 },
                { col: 1, layer: 1 },
              ]
            : staging === 'open'
              ? [{ col: 0, layer: 0 }]
              : [
                  { col: 0, layer: 0 },
                  { col: 0, layer: 1 },
                  { col: 1, layer: 0 },
                  { col: 2, layer: 0 },
                  { col: 3, layer: 0 },
                ],
        );
        const s = window.__talad.state();
        const cr = s.crates.find((c) => c.id === s.pads.fruit!.cells[0]![0])!;
        window.__talad.placeUnit(
          0,
          staging === 'away' ? 20 : cr.pos.x,
          staging === 'away' ? 12 : cr.pos.y,
        );
      }, staging);
      await expect(page.locator('#tw-class-pick')).toBeVisible({ visible: staging === 'crafting' });
      await expect(page.locator('#tw-btn-open')).toBeVisible({ visible: staging === 'open' });
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      });
      await page.evaluate(() => document.fonts.ready);
      for (const held of [
        'unarmed',
        'gun',
        'gun+',
        'heavy',
        'heavy+',
        ...(staging === 'away' ? ['crate', 'crate+'] : []),
      ]) {
        await page.evaluate((held) => {
          const s = window.__talad.state() as import('@talad/sim').MatchState;
          const u = s.units.find((u) => !u.isBot)!;
          const quality = held.endsWith('+');
          u.gun =
            held.startsWith('gun') || held.startsWith('heavy')
              ? {
                  kind: held.startsWith('heavy') ? 'heavy' : 'gun',
                  super: quality,
                  ammoCooldownTicks: 0,
                }
              : null;
          u.carrying = held.startsWith('crate') ? 9999 : null;
          if (u.carrying !== null) {
            s.crates.push({
              id: 9999,
              pos: { ...u.pos },
              state: 'carried',
              kind: quality ? 'super' : 'normal',
              landTick: 0,
            });
          }
          u.bombs = 5;
          u.bombsSuper = true;
          window.__talad.renderSnapshot(s, s, 1);
        }, held);
        const hud = await hudRects(page);
        const names = [
          'fruitHp',
          'dessertHp',
          'timer',
          'loadout',
          'preview',
          'switch',
          'cmdAttack',
          'cmdGuard',
          'cmdFetch',
          'btnFire',
          'btnPick',
          'btnThrow',
          ...(staging === 'crafting' ? ['tray'] : []),
          ...(staging === 'open' ? ['btnOpen'] : []),
        ];
        expect(
          hud.map((r) => r.name).sort(),
          `${staging}/${held}: no expected control silently omitted`,
        ).toEqual(names.sort());
        const { rects: crates, onPadCount } = await onPadCrateRects(page);
        expect(crates).toHaveLength(onPadCount);
        expect(onPadCount).toBe(staging === 'away' ? 8 : staging === 'crafting' ? 7 : 4);
        evidence.push({ staging, held, hud, crates });
        for (const a of hud) {
          expect(a.x).toBeGreaterThanOrEqual(0);
          expect(a.y).toBeGreaterThanOrEqual(0);
          expect(a.x + a.width).toBeLessThanOrEqual(width);
          expect(a.y + a.height).toBeLessThanOrEqual(height);
          for (const b of hud.slice(hud.indexOf(a) + 1)) {
            expect(
              rectGap(a, b),
              `${staging}/${held}: ${a.name} vs ${b.name}`,
            ).toBeGreaterThanOrEqual(8);
          }
          for (const cr of crates) {
            expect(
              rectGap(a, cr),
              `${staging}/${held}: ${a.name} covers ${cr.name}`,
            ).toBeGreaterThanOrEqual(0);
          }
        }
        const buttons = await page
          .locator('.tw-screen-hud button, .tw-hud-root button')
          .evaluateAll((elements) =>
            elements
              .filter((el) => el.getBoundingClientRect().width > 0)
              .map((el) => {
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return {
                  id: el.id || el.getAttribute('data-class'),
                  width: r.width,
                  height: r.height,
                  hittable: hit !== null && el.contains(hit),
                };
              }),
          );
        expect(buttons.length).toBeGreaterThanOrEqual(7);
        for (const b of buttons) {
          expect(b.width, `${b.id} width`).toBeGreaterThanOrEqual(44);
          expect(b.height, `${b.id} height`).toBeGreaterThanOrEqual(44);
          expect(b.hittable, `${b.id} centre hit`).toBe(true);
        }
      }
    }
    await info.attach('whole-hud-rects', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  });
}

function fmt(r: Rect): string {
  return `[${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}]`;
}
