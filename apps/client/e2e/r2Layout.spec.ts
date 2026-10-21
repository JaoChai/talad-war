import { expect, test, type Page } from '@playwright/test';
import { controlledHookUnit, enterMatch, getState } from './helpers';
import { padPaintedCellStagePos } from '../src/render/world';

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
      pairs.map(([name, selector]) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`Expected control missing: ${name} (${selector})`);
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) {
          throw new Error(`Expected control has an empty box: ${name} (${selector})`);
        }
        return {
          name,
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      }),
    names,
  );
}

function gap(a: Box, b: Box): number {
  return Math.max(b.x - a.right, a.x - b.right, b.y - a.bottom, a.y - b.bottom);
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

/** Screen positions of the fruit pad's crates (stage 1280×720 canvas mapping). */
async function padCratePoints(
  page: Page,
): Promise<{ id: number; kind: string; x: number; y: number }[]> {
  // R2c fixture migration (reason): crates render on the PAINTED tiles of the
  // pad art (padPaintedCellStagePos), not at the world-rect cell centres —
  // the art grew to PAD_ART_SCALE 1.3 and the world-rect points no longer
  // describe where crate pixels are.
  const st = await getState(page);
  const origin = st.pads.fruit!.origin;
  const cols = st.pads.fruit!.cells.map((col) =>
    col.map((id) => (id == null ? null : st.crates.find((c) => c.id === id))),
  );
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const out: { id: number; kind: string; x: number; y: number }[] = [];
  cols.forEach((col, colIndex) => {
    const at = padPaintedCellStagePos(origin, colIndex);
    for (const cr of col) {
      if (!cr) continue;
      out.push({
        id: cr.id,
        kind: cr.kind,
        x: canvas.x + (at.x * canvas.w) / 1280,
        y: canvas.y + (at.y * canvas.h) / 720,
      });
    }
  });
  return out;
}

const boxesOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * A tray that measures right but is painted under another layer (or at
 * opacity 0) is invisible to the player: each button's centre must resolve to
 * that button (or a child) and no ancestor may hide the chain.
 */
async function assertTrayHittable(page: Page): Promise<void> {
  const rows = await page.evaluate(() => {
    const buttons = [
      ...document.querySelectorAll('#tw-class-pick button.tw-class-btn'),
    ] as HTMLElement[];
    return buttons.map((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const hidden: string[] = [];
      for (let n: HTMLElement | null = b; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
          hidden.push(
            `${n.id || String(n.className)}(${cs.display}/${cs.visibility}/${cs.opacity})`,
          );
        }
      }
      return {
        cls: b.dataset.class ?? '',
        inside: hit !== null && (hit === b || b.contains(hit)),
        hidden,
      };
    });
  });
  expect(rows, 'four tray buttons present').toHaveLength(4);
  for (const row of rows) {
    expect(row.inside, `${row.cls}: elementFromPoint at the button centre misses it`).toBe(true);
    expect(row.hidden, `${row.cls}: hidden ancestor ${row.hidden.join(', ')}`).toEqual([]);
  }
}

const MATCH_CONTROLS: [string, string][] = [
  ['tray', '#tw-class-pick'],
  ['switch', '#tw-btn-switch'],
  ['attack', '#tw-cmd-attack'],
  ['guard', '#tw-cmd-guard'],
  ['fetch', '#tw-cmd-fetch'],
  ['loadout', '.tw-loadout'],
  ['timer', '.tw-timer'],
];

/** Throw is legitimately hidden without bombs; expected controls are never dropped. */
async function touchControls(page: Page): Promise<[string, string][]> {
  const controls: [string, string][] = [
    ['fire', '#tw-btn-fire'],
    ['pick', '#tw-btn-pick'],
  ];
  const source = controlledHookUnit(await getState(page));
  expect(source, 'controlled unit present').toBeDefined();
  if (source!.bombs > 0) controls.push(['throw', '#tw-btn-throw']);
  else await expect(page.locator('#tw-btn-throw')).toBeHidden();
  return controls;
}

async function assertCommandsHittable(page: Page): Promise<void> {
  for (const cmd of ['attack', 'guard', 'fetch']) {
    const button = page.locator(`#tw-cmd-${cmd}`);
    await expect(button).toBeVisible();
    const hit = await button.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const target = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { inside: target !== null && el.contains(target), target: target?.outerHTML };
    });
    expect(hit.inside, `${cmd} command centre blocked by ${hit.target}`).toBe(true);
  }
}

test('switch label stays on one line inside its button at all three sizes', async ({
  page,
}, info) => {
  for (const [width, height] of info.project.name === 'desktop'
    ? [[1280, 800]]
    : [
        [844, 390],
        [667, 320],
      ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await stageTray(page);
    await page.evaluate(() => document.fonts.ready);
    const label = await page.locator('.tw-switch-label').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      const button = el.closest('button')!.getBoundingClientRect();
      return {
        text: el.textContent,
        lines: new Set(rects.map((r) => r.top)).size,
        inside: rects.every((r) => r.left >= button.left && r.right <= button.right),
        childrenInside: [...el.parentElement!.children].every((child) => {
          const r = child.getBoundingClientRect();
          return r.left >= button.left && r.right <= button.right;
        }),
      };
    });
    expect(label.text).toBe('สลับตัว');
    expect(label.lines, `${width}: switch label must not wrap`).toBe(1);
    expect(label.inside, `${width}: full Thai label inside switch`).toBe(true);
    expect(label.childrenInside, `${width}: icon, label and R hint inside switch`).toBe(true);
  }
});

// Give each viewport/primary an independent render-fixture budget. The old
// mobile test combined two six-fixture matrices (CI 32.8/33.0s at timeout).
// All original 18 fixtures remain; the browser-bar sizes add 12 more.
for (const [width, height] of [
  [1280, 800],
  [844, 390],
  [667, 320],
  [800, 304],
  [812, 330],
] as const) {
  for (const primary of ['gun', 'heavy', 'crate'] as const) {
    test(`loaded tray clears every real control at ${width}×${height} with ${primary}`, async ({
      page,
    }, info) => {
      // Measured rate4 + two-CPU contention: setup/crafting alone consumes
      // ~16s; a quality pair takes ~34s. The 60s render-only budget leaves
      // measured headroom without changing any gameplay deadline.
      test.setTimeout(60_000);
      test.skip(
        (width === 1280) !== (info.project.name === 'desktop'),
        'one normal/super primary pair per matching viewport',
      );
      await page.setViewportSize({ width, height });
      await stageTray(page);
      // Craft bombs through the real channel: renderSnapshot updates the HUD,
      // but deliberately does not mutate the live touch-control bomb count.
      await page.evaluate(() =>
        window.__talad.setPadLayout('fruit', [
          { col: 0, layer: 0, kind: 'super' },
          { col: 1, layer: 0 },
        ]),
      );
      await page.keyboard.press('KeyE');
      await expect.poll(async () => (await getState(page)).pads.fruit!.opening !== null).toBe(true);
      await page.evaluate(() => window.__talad.fastForward(25));
      await expect.poll(async () => controlledHookUnit(await getState(page))!.bombs).toBe(5);
      await page.evaluate(() =>
        window.__talad.setPadLayout('fruit', [
          { col: 0, layer: 0, kind: 'super' },
          { col: 0, layer: 1 },
          { col: 1, layer: 0 },
          { col: 1, layer: 1 },
        ]),
      );
      // Visual fixtures only: exercise the real HUD with all independent slot
      // combinations, not synthetic gameplay events. Pause before renderSnapshot
      // so live sync cannot overwrite the fixture between measurements.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      });
      for (const quality of [false, true]) {
        await page.evaluate(
          ({ primary, quality }) => {
            const s = window.__talad.state() as import('@talad/sim').MatchState;
            const u = s.units.find((u) => !u.isBot)!;
            u.gun =
              primary === 'crate' ? null : { kind: primary, super: quality, ammoCooldownTicks: 0 };
            u.bombs = quality ? 5 : 3;
            u.bombsSuper = quality;
            u.carrying = primary === 'crate' ? s.crates[0]!.id : null;
            if (primary === 'crate') s.crates[0]!.kind = quality ? 'super' : 'normal';
            window.__talad.renderSnapshot(s, s, 1);
          },
          { primary, quality },
        );
        const choosing = primary !== 'crate'; // carrying prevents opening a recipe
        if (!choosing) await expect(tray(page)).toBeHidden();
        const boxes = await measure(page, [
          ...MATCH_CONTROLS.filter(([name]) => choosing || name !== 'tray'),
          ...(choosing
            ? ([['classBtn', '#tw-class-pick button.tw-class-btn']] as [string, string][])
            : []),
          ...(info.project.name === 'mobile-landscape'
            ? ([
                ['fire', '#tw-btn-fire'],
                ['pick', '#tw-btn-pick'],
                ['throw', '#tw-btn-throw'],
              ] as [string, string][])
            : []),
        ]);
        assertLayout(boxes, width, height, width <= 740 || height <= 350);
        if (choosing) {
          const trayBox = boxes.find((b) => b.name === 'tray')!;
          for (const b of boxes.filter((b) => b.name !== 'tray' && b.name !== 'classBtn')) {
            expect(
              gap(trayBox, b),
              `${width} ${primary}/${quality}: tray↔${b.name}`,
            ).toBeGreaterThanOrEqual(8);
          }
          const label = (await measure(page, [['preview', '.tw-preview']]))[0]!;
          expect(gap(trayBox, label), `${width}: tray↔pad preview`).toBeGreaterThanOrEqual(8);
          await assertTrayHittable(page);
        }
        const loadout = boxes.find((b) => b.name === 'loadout')!;
        const fetch = boxes.find((b) => b.name === 'fetch')!;
        expect(
          gap(loadout, fetch),
          `${width} ${primary}/${quality}: loadout↔fetch`,
        ).toBeGreaterThanOrEqual(8);
        await assertCommandsHittable(page);
      }
      await page.evaluate(() => {
        delete (document as { hidden?: boolean }).hidden;
      });
    });
  }
}

// Lead-approved B trigger must match the short command row, including phones
// whose browser bars reduce the landscape viewport below 350px high. A width-
// only dock leaves fetch behind the tray at these independently chosen sizes.
for (const [width, height] of [
  [800, 304],
  [812, 330],
] as const) {
  test(`${width}×${height}: browser-bar landscape clears every control by 8px`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile-landscape', 'phone landscape controls');
    await page.setViewportSize({ width, height });
    await stageTray(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    });
    const boxes = await measure(page, [...MATCH_CONTROLS, ...(await touchControls(page))]);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          gap(boxes[i]!, boxes[j]!),
          `${boxes[i]!.name}↔${boxes[j]!.name}`,
        ).toBeGreaterThanOrEqual(8);
      }
    }
    await assertTrayHittable(page);
    await assertCommandsHittable(page);
    for (const selector of ['#tw-btn-switch', '#tw-btn-pick', '#tw-btn-fire']) {
      expect(
        await page.locator(selector).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return hit !== null && el.contains(hit);
        }),
        `${selector}: centre hit`,
      ).toBe(true);
    }
  });
}

test('all three command centres stay tappable with the tray shown at 844 and 667', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch command path');
  await stageTray(page);
  for (const [width, height] of [
    [844, 390],
    [667, 320],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(tray(page)).toBeVisible();
    await assertCommandsHittable(page);
  }
});

test('667×320: the loadout clears the fetch command by at least 8 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch command path');
  await page.setViewportSize({ width: 667, height: 320 });
  await stageTray(page);
  const [loadout, fetch] = await measure(page, [
    ['loadout', '.tw-loadout'],
    ['fetch', '#tw-cmd-fetch'],
  ]);
  expect(gap(loadout!, fetch!), 'loadout-to-fetch clearance').toBeGreaterThanOrEqual(8);
});

test('844×390: tray and switch sizes, clearances and Thai names', async ({ page }) => {
  test.skip(page.viewportSize()!.width !== 844, 'runs on the native mobile-landscape project');
  await stageTray(page);
  const boxes = await measure(page, [
    ...MATCH_CONTROLS,
    ['classBtn', '#tw-class-pick button.tw-class-btn'],
    ...(await touchControls(page)),
  ]);
  assertLayout(boxes, 844, 390, false);
  await assertTrayHittable(page);
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
    ...(await touchControls(page)),
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
  await assertTrayHittable(page);
});

test('the tray never covers the pad preview label or its crates (normal + super, 844 and 667)', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch pad must stay visible');
  await stageTray(page);
  for (const [w, h] of [
    [844, 390],
    [667, 320],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300); // Phaser refit + HUD reflow
    for (const layout of ['normal', 'super'] as const) {
      await page.evaluate((superLayout) => {
        window.__talad.setPadLayout(
          'fruit',
          superLayout
            ? [
                { col: 0, layer: 0, kind: 'super' as const },
                { col: 0, layer: 1 },
                { col: 1, layer: 0 },
                { col: 1, layer: 1 },
              ]
            : [
                { col: 0, layer: 0 },
                { col: 0, layer: 1 },
                { col: 1, layer: 0 },
                { col: 1, layer: 1 },
              ],
        );
      }, layout === 'super');
      await page.waitForTimeout(250);
      await expect(tray(page)).toBeVisible();
      const trayBox = (await tray(page).boundingBox())!;
      const label = await page.locator('.tw-preview').boundingBox();
      expect(label, 'pad preview label rendered').toBeTruthy();
      expect(
        boxesOverlap(trayBox, label!),
        `${w}×${h} ${layout}: tray covers the pad preview label`,
      ).toBe(false);
      const crates = await padCratePoints(page);
      expect(crates, 'four pad crates staged').toHaveLength(4);
      for (const crate of crates) {
        const covered =
          crate.x >= trayBox.x &&
          crate.x <= trayBox.x + trayBox.width &&
          crate.y >= trayBox.y &&
          crate.y <= trayBox.y + trayBox.height;
        expect(
          covered,
          `${w}×${h} ${layout}: tray covers the ${crate.kind} crate at ${Math.round(crate.x)},${Math.round(crate.y)}`,
        ).toBe(false);
      }
      if (layout === 'super') {
        expect(
          crates.some((c) => c.kind === 'super'),
          'star crate staged',
        ).toBe(true);
      }
    }
  }
});

test('R2d: on-pad crates match the ground width, sit on the pad art, and the mixing label is big, dark and weapon-coloured', async ({
  page,
}) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await page.evaluate(() => window.__talad.setPadCrates('fruit', [0, 1])); // bombs
  await page.waitForTimeout(250);

  // Freeze the sim, mirror one pad crate onto the ground (render-only
  // fixture), then compare the REAL display widths via artFeedback.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  const sizes = await page.evaluate(() => {
    const st = window.__talad.state() as import('@talad/sim').MatchState;
    const padId = st.pads.fruit.cells[0]![0]!;
    st.crates.push({
      id: 9001,
      pos: { x: 6, y: 12 },
      kind: 'normal',
      state: 'ground',
      landTick: 0,
    });
    window.__talad.renderSnapshot(st, st, 1);
    const sprites = window.__talad.artFeedback().sprites;
    const byName = (name: string) => {
      const found = sprites.find((s) => s.name === name);
      if (!found) throw new Error(`sprite ${name} missing`);
      return found;
    };
    const padArt = sprites.find((s) => s.texture === 'pad_fruit');
    if (!padArt) throw new Error('pad_fruit sprite missing');
    return {
      onPad: byName(`crate-${padId}`).width,
      ground: byName('crate-9001').width,
      padArt,
      onPadCrates: st.pads.fruit.cells
        .flat()
        .filter((id): id is number => id !== null)
        .map((id) => byName(`crate-${id}`)),
    };
  });
  expect(sizes.ground).toBe(66); // GROUND_CRATE_WIDTH = 2.2 * STAGE_SCALE
  expect(sizes.onPad, 'R2d: on-pad crate draws at the ground width').toBe(sizes.ground);
  // Ground-layer crates stay on the pad art (no overhang past the outer rim;
  // a layer-1 stack may rise above the art — that reads as one tall stack).
  const padLeft = sizes.padArt.x - sizes.padArt.width / 2;
  const padRight = sizes.padArt.x + sizes.padArt.width / 2;
  const padBottom = sizes.padArt.y + sizes.padArt.height * (1 - sizes.padArt.originY);
  for (const crate of sizes.onPadCrates) {
    expect(crate.x - crate.width / 2, 'crate left inside the pad art').toBeGreaterThanOrEqual(
      padLeft - 3,
    );
    expect(crate.x + crate.width / 2, 'crate right inside the pad art').toBeLessThanOrEqual(
      padRight + 3,
    );
    expect(crate.y + crate.height / 2, 'crate bottom inside the pad art').toBeLessThanOrEqual(
      padBottom + 3,
    );
  }
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
  });

  // Mixing label: solid dark panel, weapon colour, size floors per band.
  await expect(page.locator('.tw-preview')).toHaveText('กำลังผสม: ระเบิด');
  for (const [w, h, font] of [
    [1280, 800, '18px'],
    [844, 390, '18px'],
    [667, 320, '15px'],
    [568, 320, '15px'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    const style = await page.locator('.tw-preview').evaluate((el) => {
      const cs = getComputedStyle(el);
      const chip = el.querySelector<HTMLElement>('.tw-chip');
      return {
        fontSize: cs.fontSize,
        background: cs.backgroundColor,
        border: cs.borderColor,
        chip: chip ? getComputedStyle(chip).backgroundColor : '',
      };
    });
    expect(style.fontSize, `${w}×${h} label font floor`).toBe(font);
    expect(style.background, `${w}×${h} solid dark panel`).toBe('rgb(27, 16, 48)');
    expect(style.border, `${w}×${h} weapon-colour border`).toBe('rgb(255, 146, 43)');
    expect(style.chip, `${w}×${h} chip in the weapon colour`).toBe('rgb(255, 146, 43)');
  }

  // Not a recipe: grey label, no weapon colour, no chip.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__talad.setPadCrates('fruit', [0, 3])); // diagonal
  await page.waitForTimeout(250);
  await expect(page.locator('.tw-preview')).toHaveText('ยังไม่ใช่สูตร');
  const muted = await page.locator('.tw-preview').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, border: cs.borderColor, chip: !!el.querySelector('.tw-chip') };
  });
  expect(muted.border, 'grey border for not-a-recipe').toBe('rgb(134, 142, 150)');
  expect(muted.color, 'grey text for not-a-recipe').toBe('rgb(173, 181, 189)');
  expect(muted.chip, 'no chip for not-a-recipe').toBe(false);
});

test('R2d review 1 #3: the heavy mixing label stays inside the viewport at 568x320', async ({
  page,
}) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto('/?seed=1');
  await enterMatch(page);
  const layouts: ReadonlyArray<
    ReadonlyArray<{ col: number; layer: 0 | 1; kind?: 'super' }>
  > = [
    // plain heavy: 4 ground-layer crates
    [
      { col: 0, layer: 0 },
      { col: 1, layer: 0 },
      { col: 2, layer: 0 },
      { col: 3, layer: 0 },
    ],
    // super heavy: the star <img> loads after the first clamp measurement
    [
      { col: 0, layer: 0, kind: 'super' },
      { col: 1, layer: 0 },
      { col: 2, layer: 0 },
      { col: 3, layer: 0 },
    ],
  ];
  for (const layout of layouts) {
    await page.evaluate((entries) => window.__talad.setPadLayout('fruit', entries), layout);
    await expect(page.locator('.tw-preview')).toHaveText(
      /กำลังผสม: บาซูก้ามะพร้าว( พิเศษ)?/,
    );
    // Every label image settled (star art loads after the first position()).
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.tw-preview img')].every(
        (img) => (img as HTMLImageElement).complete,
      ),
    );
    await page.waitForTimeout(150);
    const box = (await page.locator('.tw-preview').boundingBox())!;
    expect(box, 'label rendered').toBeTruthy();
    expect(box.x, 'label left edge inside viewport').toBeGreaterThanOrEqual(0);
    expect(box.y, 'label top edge inside viewport').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'label right edge inside viewport').toBeLessThanOrEqual(568);
    expect(box.y + box.height, 'label bottom edge inside viewport').toBeLessThanOrEqual(320);
  }
});

test('1280×800 desktop: switch visible (not hidden by the touch rule) and no overlaps', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop-only layout');
  await stageTray(page);
  const boxes = await measure(page, MATCH_CONTROLS);
  assertLayout(boxes, 1280, 800, false);
  await assertTrayHittable(page);
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
