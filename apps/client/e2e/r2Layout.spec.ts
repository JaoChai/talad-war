import { expect, test, type Page } from '@playwright/test';
import { enterMatch, getState } from './helpers';

/**
 * R2-11 layout contract (plan §5): tray + switch positions, sizes and pairwise
 * clearances at 844×390, 667×320 and 1280×800; Thai labels, focus ring,
 * sim-tick progress without motion; blocked-icon fallback; portrait pause.
 */

interface Box {
  name: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const tray = (page: Page) => page.locator('#tw-class-pick');
const trayButtons = (page: Page) => page.locator('#tw-class-pick button.tw-class-btn');

async function stageTray(page: Page, seed = 1): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await enterMatch(page);
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'attack');
    for (const id of [1, 2]) {
      const u = window.__talad.state().units.find((x) => x.id === id);
      if (u && u.deadUntilTick === null) window.__talad.placeUnit(id, 31 + id, 9 + id);
    }
    window.__talad.setPadLayout('fruit', [
      { col: 0, layer: 0 },
      { col: 0, layer: 1 },
      { col: 1, layer: 0 },
      { col: 1, layer: 1 },
    ]);
    const st = window.__talad.state();
    const crate = st.crates.find((c) => c.id === st.pads.fruit!.cells[0]![0]);
    window.__talad.placeUnit(0, crate!.pos.x, crate!.pos.y);
  });
  await expect(tray(page)).toBeVisible();
}

async function measure(page: Page, names: [string, string][]): Promise<Box[]> {
  return page.evaluate(
    (pairs) =>
      pairs
        .map(([name, selector]) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return null;
          return {
            name,
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        })
        .filter((b): b is Box => b !== null),
    names,
  );
}

/** §5 contract: inside the viewport, pairwise disjoint (siblings only), sizes per breakpoint. */
function assertLayout(boxes: Box[], vw: number, vh: number, narrow: boolean): void {
  const byName = new Map(boxes.map((b) => [b.name, b]));
  for (const b of boxes) {
    expect(b.x, `${b.name} left edge`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${b.name} top edge`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${b.name} right edge`).toBeLessThanOrEqual(vw);
    expect(b.bottom, `${b.name} bottom edge`).toBeLessThanOrEqual(vh);
  }
  const trayBox = byName.get('tray');
  const classBtn = byName.get('classBtn');
  if (trayBox && classBtn) {
    // The button lives INSIDE the tray: assert containment, not disjointness.
    expect(classBtn.x).toBeGreaterThanOrEqual(trayBox.x);
    expect(classBtn.right).toBeLessThanOrEqual(trayBox.right);
    expect(classBtn.bottom).toBeLessThanOrEqual(trayBox.bottom);
    expect(classBtn.y).toBeGreaterThanOrEqual(trayBox.y);
  }
  if (trayBox) {
    expect(trayBox.width).toBe(narrow ? 280 : 336);
    if (classBtn) expect([classBtn.width, classBtn.height]).toEqual(narrow ? [60, 72] : [72, 76]);
  }
  const switchBox = byName.get('switch');
  if (switchBox) expect([switchBox.width, switchBox.height]).toEqual([112, 56]);
  const siblings = boxes.filter((b) => b.name !== 'classBtn');
  for (let i = 0; i < siblings.length; i++) {
    for (let j = i + 1; j < siblings.length; j++) {
      const a = siblings[i]!;
      const b = siblings[j]!;
      const overlap = a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
    }
  }
}

const MATCH_CONTROLS: [string, string][] = [
  ['tray', '#tw-class-pick'],
  ['switch', '#tw-btn-switch'],
  ['commands', '.tw-commands'],
  ['loadout', '.tw-loadout'],
  ['timer', '.tw-timer'],
];

test('844×390: tray and switch sizes, clearances and Thai names', async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 844, 'runs on the native mobile-landscape project');
  await stageTray(page);
  const boxes = await measure(page, [
    ...MATCH_CONTROLS,
    ['classBtn', '#tw-class-pick button.tw-class-btn'],
    ['fire', '#tw-btn-fire'],
    ['pick', '#tw-btn-pick'],
    ['throw', '#tw-btn-throw'],
  ]);
  assertLayout(boxes, 844, 390, false);
  // The four Thai class names with their digit hints are visible.
  const names = ['นักมวย', 'หมอยา', 'นินจา', 'ยักษ์'];
  for (const [i, name] of names.entries()) {
    await expect(trayButtons(page).nth(i)).toContainText(name);
    await expect(trayButtons(page).nth(i).locator('.tw-class-key')).toHaveText(String(i + 1));
  }
  await expect(page.locator('#tw-btn-switch')).toContainText('สลับตัว');
});

test('667×320: narrow tray (280px), 60×72 buttons and ≥8 px clearance to Pick', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch controls must be present');
  await stageTray(page);
  await page.setViewportSize({ width: 667, height: 320 });
  await page.waitForTimeout(300); // Phaser refit + HUD reflow
  await expect(tray(page)).toBeVisible();
  const boxes = await measure(page, [
    ...MATCH_CONTROLS,
    ['classBtn', '#tw-class-pick button.tw-class-btn'],
    ['fire', '#tw-btn-fire'],
    ['pick', '#tw-btn-pick'],
    ['throw', '#tw-btn-throw'],
  ]);
  assertLayout(boxes, 667, 320, true);
  const byName = new Map(boxes.map((b) => [b.name, b]));
  const pickBtn = byName.get('pick');
  const trayBox = byName.get('tray');
  expect(pickBtn, 'Pick button present at 667×320').toBeDefined();
  expect(trayBox).toBeDefined();
  // §5: the narrow tray must clear the existing Pick button by ≥8px — the
  // nearest-edge distance across both axes (the boxes are already disjoint).
  // At 667px the clearance is horizontal: Pick is ~90px wide with its Thai
  // label, wider than the 64px min-width the plan's numbers assumed.
  const gapX = Math.max(trayBox!.x - pickBtn!.right, pickBtn!.x - trayBox!.right);
  const gapY = Math.max(trayBox!.y - pickBtn!.bottom, pickBtn!.y - trayBox!.bottom);
  expect(Math.max(gapX, gapY), 'tray↔Pick clearance ≥8px').toBeGreaterThanOrEqual(8);
});

test('1280×800 desktop: switch visible (not hidden by the touch rule) and no overlaps', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop-only layout');
  await stageTray(page);
  const boxes = await measure(page, MATCH_CONTROLS);
  assertLayout(boxes, 1280, 800, false);
  await expect(page.locator('#tw-btn-switch')).toBeVisible();
  // Desktop has no touch action buttons at all.
  await expect(page.locator('#tw-btn-fire')).toHaveCount(0);
});

test('focus ring and reduced-motion progress follow the sim ticks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stageTray(page);
  // Keyboard focus reaches the tray; the focus ring is 3px gold, offset 3px.
  let focused = false;
  for (let i = 0; i < 20 && !focused; i++) {
    focused = await page.evaluate(() => document.activeElement?.closest('#tw-class-pick') != null);
    if (!focused) await page.keyboard.press('Tab');
  }
  expect(focused, 'Tab reaches a tray button').toBe(true);
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return { width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset };
  });
  expect(ring.width).toBe('3px');
  expect(ring.color).toBe('rgb(255, 215, 94)');
  expect(ring.offset).toBe('3px');
  // Start the channel on the focused button and check the motion-free progress.
  await page.keyboard.press('Enter');
  await expect(page.locator('#tw-class-pick .tw-class-status')).toBeVisible();
  const progress = await page.evaluate(() => {
    const bar = document.querySelector('.tw-class-progress');
    if (!bar) return null;
    const cs = getComputedStyle(bar, '::after');
    return {
      transition: cs.transitionDuration,
      matrix: new DOMMatrixReadOnly(cs.transform),
      now: bar.getAttribute('aria-valuenow'),
    };
  });
  expect(progress).not.toBeNull();
  expect(progress!.transition).toBe('0s'); // reduced motion: no animated fill
  expect(progress!.matrix.a).toBeGreaterThanOrEqual(0);
  expect(progress!.matrix.a).toBeLessThanOrEqual(1);
  expect(Number(progress!.now)).toBeGreaterThan(0);
  // The fill is sim-tick driven: two reads one tick apart shrink it monotonically.
  const first = progress!.matrix.a;
  await page.waitForTimeout(120);
  const second = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.tw-class-progress')!, '::after');
    return new DOMMatrixReadOnly(cs.transform).a;
  });
  expect(second).toBeLessThan(first);
});

test('a blocked class icon hides itself and the Thai choice stays usable', async ({ page }) => {
  await page.route('**/class_pick_boxer.webp', (route) => route.abort());
  await stageTray(page);
  const icons = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#tw-class-pick button.tw-class-btn')];
    return btns.map((b) => ({
      cls: (b as HTMLElement).dataset.class,
      iconHidden: (b.querySelector('img') as HTMLImageElement | null)?.hidden ?? null,
      label: b.querySelector('.tw-class-label')?.textContent ?? null,
    }));
  });
  expect(icons).toHaveLength(4);
  expect(icons.find((i) => i.cls === 'boxer')?.iconHidden).toBe(true);
  expect(icons.find((i) => i.cls === 'boxer')?.label).toBe('นักมวย');
  expect(icons.find((i) => i.cls === 'healer')?.iconHidden).toBe(false);
  // The blocked choice still works end to end.
  await trayButtons(page).first().click();
  await expect(page.locator('#tw-class-pick .tw-class-status')).toBeVisible();
  await page.evaluate(() => window.__talad.fastForward(20));
  expect((await getState(page)).units.find((u) => u.classId === 'boxer')).toBeDefined();
});

test('portrait pauses behind the rotate overlay; a queued pick is never replayed', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch rotation path');
  await stageTray(page);
  // Freeze ticks, queue a real pick through the tray, then check it never fires.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  await trayButtons(page).first().click();
  await page.waitForTimeout(300);
  expect((await getState(page)).pads.fruit!.opening).toBeNull();
  // Portrait: the rotate overlay covers the match; the tray is behind it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await expect(page.locator('.tw-rotate')).toBeVisible();
  const cover = await page.evaluate(() => {
    const overlay = document.querySelector('.tw-rotate')!.getBoundingClientRect();
    const t = document.querySelector('#tw-class-pick')!.getBoundingClientRect();
    return (
      overlay.x <= t.x && overlay.y <= t.y && overlay.right >= t.right && overlay.bottom >= t.bottom
    );
  });
  expect(cover, 'rotate overlay covers the tray').toBe(true);
  // Resume landscape: the overlay hides, the pick was cleared, the tray is fresh.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
  });
  await page.waitForTimeout(400);
  await expect(page.locator('.tw-rotate')).toBeHidden();
  expect((await getState(page)).pads.fruit!.opening).toBeNull(); // no replayed pick
  await expect(trayButtons(page).first()).toBeVisible();
  await trayButtons(page).first().click();
  await expect(page.locator('#tw-class-pick .tw-class-status')).toBeVisible(); // fresh pick works
});
