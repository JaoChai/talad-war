import { expect, test, type Page } from '@playwright/test';
import {
  enterMatch,
  controlledHookUnit,
  getState,
  finishOpening,
  stepRealInputs,
  holdSceneTicks,
} from './helpers';
import type { HookState } from './helpers';
import { className } from '../src/i18n/th';

/**
 * R2-11 class tray through REAL production input (plan §5): the pad is staged
 * with the existing hooks, but every choice, channel and spawn below is driven
 * by real buttons, real digits and the real sim — no hook-created events.
 */

const CLASS_IDS_IN_TRAY = ['boxer', 'healer', 'ninja', 'giant'] as const;

const CLASS_WALL: { col: number; layer: 0 | 1 }[] = [
  { col: 0, layer: 0 },
  { col: 0, layer: 1 },
  { col: 1, layer: 0 },
  { col: 1, layer: 1 },
];

const tray = (page: Page) => page.locator('#tw-class-pick');
const trayButtons = (page: Page) => page.locator('#tw-class-pick button.tw-class-btn');
const trayStatus = (page: Page) => page.locator('#tw-class-pick .tw-class-status');

/** Center of a staged pad cell: read it from the staged crate's own position. */
function stagedCellCenter(st: HookState, col: number, layer: 0 | 1): { x: number; y: number } {
  const cellId = st.pads.fruit!.cells[col]![layer];
  expect(cellId, `staged crate missing at col ${col} layer ${layer}`).not.toBeNull();
  const crate = st.crates.find((c) => c.id === cellId);
  expect(crate, `staged crate ${cellId} not in state`).toBeDefined();
  return { x: crate!.pos.x, y: crate!.pos.y };
}

/**
 * Park the fruit bots far from their pad (so nothing disturbs the staged wall
 * or the 20-tick channel) and build the class wall with the controlled body
 * standing on it. A fresh seed per staging keeps every iteration independent.
 */
async function stageClassWall(
  page: Page,
  opts: { seed?: number; superWall?: boolean } = {},
): Promise<HookState> {
  await page.goto(`/?seed=${opts.seed ?? 1}`);
  await enterMatch(page);
  // One fixture-owned tick clock, before staging or any trusted activation.
  await holdSceneTicks(page);
  await page.evaluate(
    ({ wall, superWall }) => {
      window.__talad.setCommand('fruit', 'attack');
      for (const id of [1, 2]) {
        const u = window.__talad.state().units.find((x) => x.id === id);
        if (u && u.deadUntilTick === null) window.__talad.placeUnit(id, 31 + id, 9 + id);
      }
      window.__talad.setPadLayout(
        'fruit',
        wall.map((c) => ({
          ...c,
          ...(superWall && c.col === 0 && c.layer === 0 ? { kind: 'super' as const } : {}),
        })),
      );
    },
    { wall: CLASS_WALL, superWall: opts.superWall ?? false },
  );
  const st = await getState(page);
  const center = stagedCellCenter(st, 0, 0);
  await page.evaluate(({ x, y }) => window.__talad.placeUnit(0, x, y), center);
  await expect(tray(page)).toBeVisible();
  return getState(page);
}

/** Assert the tray buttons as a group (strict-mode-safe via the first). */
async function expectTrayChoicesHidden(page: Page): Promise<void> {
  await expect(trayButtons(page).first()).toBeHidden();
}

async function expectTrayChoicesVisible(page: Page): Promise<void> {
  await expect(trayButtons(page).first()).toBeVisible();
}

/** Park the fruit bots away from the pad on the CURRENT live match. */
async function parkFruitBots(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'attack');
    for (const id of [1, 2]) {
      const u = window.__talad.state().units.find((x) => x.id === id);
      if (u && u.deadUntilTick === null) window.__talad.placeUnit(id, 31 + id, 9 + id);
    }
  });
}

test('normal class wall: tray shows four Thai choices with digit hints and no ordinary Open', async ({
  page,
}, info) => {
  const st = await stageClassWall(page);
  const buttons = trayButtons(page);
  await expect(buttons).toHaveCount(4);
  // Tray order is CLASS_IDS order; dataset.class carries the choice ids.
  const order = await buttons.evaluateAll((els) => els.map((el) => el.dataset.class));
  expect(order).toEqual([...CLASS_IDS_IN_TRAY]);
  for (const [i, classId] of CLASS_IDS_IN_TRAY.entries()) {
    const btn = buttons.nth(i);
    await expect(btn).toContainText(className(classId));
    await expect(btn.locator('.tw-class-key')).toHaveText(String(i + 1));
  }
  // The pad preview still promises the class recipe (never hidden by the tray).
  await expect(page.locator('.tw-preview')).toContainText('ลูกทีมอาชีพ');
  expect(st.pads.fruit!.opening).toBeNull();
  // Ordinary Open is gone while the class wall stands.
  if (info.project.name === 'mobile-landscape') {
    await expect(page.locator('#tw-btn-open')).toBeHidden();
  } else {
    // Desktop: E on a class wall neither opens nor lifts — no channel starts.
    await page.keyboard.press('KeyE');
    await stepRealInputs(page, 6);
    expect((await getState(page)).pads.fruit!.opening).toBeNull();
    await expect(trayStatus(page)).toBeHidden();
  }
});

test('super class wall keeps the super star preview while offering the tray', async ({ page }) => {
  await stageClassWall(page, { superWall: true });
  await expect(page.locator('.tw-preview')).toContainText('ลูกทีมอาชีพ พิเศษ');
  await expect(trayButtons(page)).toHaveCount(4);
});

test('all four digit choices start the 20-tick channel and spawn that class', async ({ page }) => {
  test.setTimeout(120_000);
  for (const [i, classId] of CLASS_IDS_IN_TRAY.entries()) {
    await stageClassWall(page, { seed: 1 });
    await page.keyboard.press(`Digit${i + 1}`);
    await stepRealInputs(page, 1);
    await expect(trayStatus(page)).toBeVisible(); // กำลังสร้างลูกทีม…
    await expectTrayChoicesHidden(page); // channel is noninteractive
    let st = await getState(page);
    expect(st.pads.fruit!.opening?.classId).toBe(classId);
    expect(st.pads.fruit!.opening!.doneTick - st.tick).toBeLessThanOrEqual(20);
    await finishOpening(page);
    st = await getState(page);
    expect(st.winner).toBeNull();
    expect(st.pads.fruit!.opening).toBeNull();
    const spawned = st.units.find((u) => u.classId === classId);
    expect(spawned, `class ${classId} unit spawned`).toBeDefined();
    expect(spawned!.team).toBe('fruit');
    expect(st.pads.fruit!.cells.flat().every((c) => c === null)).toBe(true); // wall consumed
  }
});

test('all four tray buttons pick their class with a real activation', async ({ page }) => {
  test.setTimeout(120_000);
  for (const [i, classId] of CLASS_IDS_IN_TRAY.entries()) {
    await stageClassWall(page, { seed: 1 });
    await trayButtons(page).nth(i).click();
    await stepRealInputs(page, 1);
    await expect(trayStatus(page)).toBeVisible();
    await finishOpening(page);
    const st = await getState(page);
    expect(st.pads.fruit!.opening).toBeNull();
    expect(st.units.find((u) => u.classId === classId)).toBeDefined();
  }
});

test('touch tap on a tray choice activates the pick', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch-only activation');
  const cdp = await page.context().newCDPSession(page);
  await stageClassWall(page);
  const box = await trayButtons(page).first().boundingBox();
  expect(box).not.toBeNull();
  const pt = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: pt.x, y: pt.y, id: 5 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: pt.x, y: pt.y, id: 5 }],
  });
  await stepRealInputs(page, 1);
  await expect(trayStatus(page)).toBeVisible();
  await finishOpening(page);
  expect((await getState(page)).units.find((u) => u.classId === 'boxer')).toBeDefined();
});

test('Enter activates a focused tray choice', async ({ page }) => {
  await stageClassWall(page);
  let focused = false;
  for (let i = 0; i < 20 && !focused; i++) {
    focused = await page.evaluate(() => document.activeElement?.closest('#tw-class-pick') != null);
    if (!focused) await page.keyboard.press('Tab');
  }
  expect(focused, 'Tab reaches a tray button').toBe(true);
  await page.keyboard.press('Enter');
  await stepRealInputs(page, 1);
  await expect(trayStatus(page)).toBeVisible();
  await finishOpening(page);
  expect((await getState(page)).units.find((u) => u.classId === 'boxer')).toBeDefined();
});

test('a canvas press near the pad fires; a tray-button press never does', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile-landscape', 'mouse-vs-canvas contract');
  await stageClassWall(page);
  // Stage a dessert enemy adjacent to the controlled body so a canvas press can slap.
  const st = await getState(page);
  const me = controlledHookUnit(st)!;
  const enemy = st.units.find((u) => u.team === 'dessert' && u.deadUntilTick === null);
  expect(enemy).toBeDefined();
  await page.evaluate(({ id, x, y }) => window.__talad.placeUnit(id, x, y), {
    id: enemy!.id,
    x: me.pos.x + 0.4,
    y: me.pos.y,
  });
  const canvas = page.locator('canvas');
  const cbox = await canvas.boundingBox();
  expect(cbox).not.toBeNull();
  const k = cbox!.width / 1280; // letterboxed 720p stage → screen scale
  const pt = { x: (40 + me.pos.x * 30) * k, y: me.pos.y * 30 * k };
  // Sanity: a real canvas press makes the controlled body attack (the enemy
  // sits inside slap range; a stray step cannot leave it within one tick).
  // Hold the press through the attack window: an instant click can be
  // released between sim ticks, before any tick samples the held fire
  // (the journey spec's held mouse.down is what made its attack register).
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await stepRealInputs(page, 40, enemy!.id);
  expect(await page.evaluate(() => window.__talad.unitFeedback(0).attackAt)).toBeGreaterThanOrEqual(
    0,
  );
  await page.mouse.up();
  // Now the tray: picking through the DOM must not also fire the weapon.
  const before = await page.evaluate(() => window.__talad.unitFeedback(0).attackAt);
  await trayButtons(page).nth(2).click(); // นินจา
  // Keep the same enemy in range through eight sampled ticks. A DOM click
  // leaking into canvas fire must fail, even if RAF provides no live ticks.
  await stepRealInputs(page, 8, enemy!.id);
  await expect(trayStatus(page)).toBeVisible();
  expect(await page.evaluate(() => window.__talad.unitFeedback(0).attackAt)).toBe(before);
  await finishOpening(page);
  expect((await getState(page)).units.find((u) => u.classId === 'ninja')).toBeDefined();
});

test('the channel is noninteractive and cancels when the body walks off the pad', async ({
  page,
}) => {
  await stageClassWall(page);
  await trayButtons(page).first().click(); // นักมวย
  await stepRealInputs(page, 1);
  await expect(trayStatus(page)).toBeVisible();
  // Real movement input: steer right until off the pad cell — the channel cancels.
  await page.keyboard.down('KeyD');
  const moved = await stepRealInputs(page, 10);
  expect(moved.pads.fruit!.opening).toBeNull();
  await page.keyboard.up('KeyD');
  await expect(trayStatus(page)).toBeHidden();
  const st = await getState(page);
  expect(st.winner).toBeNull();
  expect(st.units.find((u) => u.classId === 'boxer')).toBeUndefined(); // nothing spawned
});

test('a queued tray choice goes stale when the wall changes before the next tick', async ({
  page,
}) => {
  await stageClassWall(page);
  // Freeze the tick: hidden pages step nothing, so the queued pick cannot fire.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  // Render-only barrier: finish the pause transition BEFORE queueing. Resume
  // must not be what drops the stale request we intend to test below.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const pausedTick = (await getState(page)).tick;
  await trayButtons(page).nth(1).click(); // หมอยา queued, never validated
  expect((await getState(page)).tick).toBe(pausedTick);
  expect((await getState(page)).pads.fruit!.opening).toBeNull();
  // Change the wall (new crate ids → new snapshot): the queued choice is stale.
  await page.evaluate(() => {
    window.__talad.setPadLayout('fruit', [
      { col: 0, layer: 0 },
      { col: 0, layer: 1 },
      { col: 1, layer: 0 },
      { col: 1, layer: 1 },
    ]);
  });
  // Validate the real queued choice BEFORE the resume-edge latch reset can
  // mask missing snapshot validation in the input adapter.
  await stepRealInputs(page, 8);
  expect((await getState(page)).pads.fruit!.opening).toBeNull();
  await expectTrayChoicesVisible(page); // fresh context re-shown
  // A fresh choice still works.
  await trayButtons(page).nth(1).click();
  await stepRealInputs(page, 1);
  await expect(trayStatus(page)).toBeVisible();
  expect((await getState(page)).pads.fruit!.opening?.classId).toBe('healer');
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
  });
});

test('a queued keyboard digit goes stale the same way', async ({ page }) => {
  await stageClassWall(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const pausedTick = (await getState(page)).tick;
  await page.keyboard.press('Digit3'); // นินจา cached against the old snapshot
  expect((await getState(page)).tick).toBe(pausedTick);
  expect((await getState(page)).pads.fruit!.opening).toBeNull();
  await page.evaluate(() => {
    window.__talad.setPadLayout('fruit', [
      { col: 0, layer: 0 },
      { col: 0, layer: 1 },
      { col: 1, layer: 0 },
      { col: 1, layer: 1 },
    ]);
  });
  await stepRealInputs(page, 8);
  expect((await getState(page)).pads.fruit!.opening).toBeNull();
  await expectTrayChoicesVisible(page);
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
  });
});

test('full team: no tray, Thai ทีมเต็มแล้ว preview, and no choice possible', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?seed=1');
  await enterMatch(page);
  // One fixture-owned tick clock, before staging or any trusted activation.
  await holdSceneTicks(page);
  // Recruit two basic buddies through real opens (2-stack wall + E), twice.
  for (let round = 0; round < 2; round++) {
    await parkFruitBots(page);
    await page.evaluate(() => {
      window.__talad.setPadLayout('fruit', [
        { col: 0, layer: 0 },
        { col: 0, layer: 1 },
      ]);
      const st = window.__talad.state();
      const crate = st.crates.find((c) => c.id === st.pads.fruit!.cells[0]![0]);
      window.__talad.placeUnit(0, crate!.pos.x, crate!.pos.y);
    });
    await page.keyboard.press('KeyE'); // ordinary open on a buddy wall
    await finishOpening(page); // real acceptance, then the remaining channel ticks
    expect((await getState(page)).units.filter((u) => u.team === 'fruit')).toHaveLength(
      3 + round + 1,
    );
  }
  const full = await getState(page);
  expect(full.units.filter((u) => u.team === 'fruit')).toHaveLength(5); // TEAM_CAP
  // Class wall on the SAME capped match: no tray at all.
  await parkFruitBots(page);
  await page.evaluate(() => {
    window.__talad.setPadLayout('fruit', [
      { col: 0, layer: 0 },
      { col: 0, layer: 1 },
      { col: 1, layer: 0 },
      { col: 1, layer: 1 },
    ]);
  });
  const st = await getState(page);
  const center = stagedCellCenter(st, 0, 0);
  await page.evaluate(({ x, y }) => window.__talad.placeUnit(0, x, y), center);
  await expect(tray(page)).toBeHidden({ timeout: 5_000 });
  await expect(page.locator('.tw-preview')).toContainText('ทีมเต็มแล้ว');
  // Even the keyboard cannot force a choice through a full team.
  await page.keyboard.press('Digit1');
  await stepRealInputs(page, 6);
  expect((await getState(page)).pads.fruit!.opening).toBeNull();
});
