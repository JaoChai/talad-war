import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { getState, joyDriver, keyDriver, waitHooks, type Driver } from './helpers';

const isMobile = (): boolean => test.info().project.name === 'mobile-landscape';

async function driverFor(page: Parameters<typeof keyDriver>[0]): Promise<Driver> {
  return isMobile()
    ? await joyDriver(page, await page.context().newCDPSession(page))
    : await keyDriver(page);
}

/** Stable stage: both teams guard home, fruit pad = a bombs recipe (cols 0+1). */
async function parkAndStageBombs(page: Parameters<typeof waitHooks>[0]): Promise<void> {
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'guard');
    window.__talad.setCommand('dessert', 'guard');
    window.__talad.setPadCrates('fruit', [0, 1]); // adjacent ground crates -> bombs
  });
}

async function openBombsRecipe(page: Parameters<typeof waitHooks>[0]): Promise<void> {
  await parkAndStageBombs(page);
  // Numbers inlined: page.evaluate serializes the function, not the closure.
  await page.evaluate(() => window.__talad.placeUnit(0, 8.75, 18.75));
  if (isMobile()) {
    // The Open! button only renders on touch; desktop opens with KeyE below.
    await expect(page.locator('#tw-btn-open')).toBeVisible({ timeout: 10_000 });
  }
  // t_189085b4: a CI run sent the real press into a frame loop that was not
  // stepping and then timed out on an opaque "bombs 0". Only send Open! to a
  // loop observed to be stepping: if no tick passes after staging, this fails
  // with a diagnosis instead. Same 10s budget; no new timeout or retry.
  const stagedTick = (await getState(page)).tick;
  await expect
    .poll(async () => (await getState(page)).tick, {
      message: 'sim loop not stepping after staging',
      timeout: 10_000,
    })
    .toBeGreaterThan(stagedTick);
  const driver = await driverFor(page);
  await driver.open();
  await expect
    .poll(async () => (await getState(page)).units[0]!.bombs, { timeout: 10_000 })
    .toBe(3);
}

test.describe('hud (Task 9)', () => {
  test('throw: hidden at 0 bombs, count 3 after a real bombs recipe, 2 after one throw', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto('/?seed=7');
    await waitHooks(page);
    if (isMobile()) await expect(page.locator('#tw-btn-throw')).toBeHidden();
    const bombs = async () => (await getState(page)).units[0]!.bombs;
    await expect.poll(bombs, 'no bombs at match start').toBe(0);

    await openBombsRecipe(page); // polls bombs === 3 through a real Open!
    if (isMobile()) {
      await expect(page.locator('#tw-btn-throw')).toBeVisible();
      await expect(page.locator('#tw-btn-throw .tw-throw-count')).toHaveText('3');
    }

    const driver = await driverFor(page);
    await driver.throwBomb(); // Q on desktop, Throw button on touch
    await expect.poll(bombs).toBe(2);
    if (isMobile()) {
      await expect(page.locator('#tw-btn-throw .tw-throw-count')).toHaveText('2');
    }
  });

  test('open: hidden unless canOpen (off-pad / empty pad / on-pad with recipe)', async ({
    page,
  }) => {
    test.skip(!isMobile(), 'the Open! button only renders on touch; desktop opens via E');
    await page.goto('/?seed=7');
    await waitHooks(page);
    const openBtn = page.locator('#tw-btn-open');
    await expect(openBtn).toBeHidden(); // empty pad at the stall

    await page.evaluate(() => window.__talad.setPadCrates('fruit', [0, 1]));
    await expect(openBtn).toBeHidden(); // recipe on the pad, but unit 0 is off-pad

    await page.evaluate(() => window.__talad.placeUnit(0, 8.75, 18.75));
    await expect(openBtn).toBeVisible(); // on the own pad with a valid recipe
  });

  test('squad commands: tap toggles state (attack -> null), Digit2 -> guard on desktop', async ({
    page,
  }) => {
    await page.goto('/?seed=7');
    await waitHooks(page);
    const attack = page.locator('#tw-cmd-attack');
    const fruitCommand = async () => (await getState(page)).commands.fruit;

    await attack.click(); // a DOM click lands on the button, never on the canvas gun
    await expect.poll(fruitCommand).toBe('attack');
    await expect(attack).toHaveAttribute('aria-pressed', 'true');

    await attack.click(); // active command tapped again -> null
    await expect.poll(fruitCommand).toBeNull();
    await expect(attack).toHaveAttribute('aria-pressed', 'false');

    if (isMobile()) {
      await page.locator('#tw-cmd-guard').click();
      await expect.poll(fruitCommand).toBe('guard');
    } else {
      await page.keyboard.press('Digit2');
      await expect.poll(fruitCommand).toBe('guard');
      await page.keyboard.press('Digit2');
      await expect.poll(fruitCommand).toBeNull();
    }
  });

  test('squad commands: held Digit1/2/3 ignores repeat keydowns until release', async ({
    page,
  }) => {
    test.skip(isMobile(), 'desktop command shortcuts');
    await page.goto('/?seed=7');
    await waitHooks(page);
    const fruitCommand = async () => (await getState(page)).commands.fruit;

    for (const [key, command] of [
      ['Digit1', 'attack'],
      ['Digit2', 'guard'],
      ['Digit3', 'fetch'],
    ] as const) {
      await page.keyboard.down(key);
      await expect.poll(fruitCommand).toBe(command);
      for (let repeat = 0; repeat < 3; repeat++) {
        await page.keyboard.down(key); // Playwright sets repeat=true while held.
        await expect.poll(fruitCommand, `${key} repeat ${repeat + 1}`).toBe(command);
      }
      await page.keyboard.up(key);
      await page.keyboard.press(key); // A fresh press still toggles off.
      await expect.poll(fruitCommand).toBeNull();
    }
  });

  test('stall bars: aria-valuenow mirrors hp (dessert 3250 -> 50)', async ({ page }) => {
    await page.goto('/?seed=7');
    await waitHooks(page);
    await page.evaluate(() => {
      window.__talad.setCommand('fruit', 'guard');
      window.__talad.setCommand('dessert', 'guard');
    });
    await expect(page.locator('#tw-bar-fruit')).toHaveAttribute('aria-valuenow', '100');
    await page.evaluate(() => window.__talad.setStallHp('dessert', 3250));
    await expect(page.locator('#tw-bar-dessert')).toHaveAttribute('aria-valuenow', '50');
  });

  test('timer: 0:00 right after setSeed, 1:01 after fastForward(1220)', async ({ page }) => {
    await page.goto('/?seed=7');
    await waitHooks(page);
    await page.evaluate(() => window.__talad.setSeed(42));
    await expect(page.locator('#tw-timer')).toHaveText('0:00');
    await page.evaluate(() => window.__talad.fastForward(1220));
    await expect(page.locator('#tw-timer')).toHaveText('1:01');
  });

  test('buttons: every visible HUD control >= 56px, inside the viewport, no overlaps at 844x390', async ({
    page,
  }) => {
    test.skip(!isMobile(), 'the geometry contract is written against 844x390');
    test.setTimeout(60_000);
    await page.goto('/?seed=7');
    await waitHooks(page);

    // Maximal visible set: Throw (bombs) AND Open! (recipe staged) together.
    await openBombsRecipe(page);
    await parkAndStageBombs(page);
    await expect(page.locator('#tw-btn-open')).toBeVisible();
    await expect(page.locator('#tw-btn-throw')).toBeVisible();

    const selectors = [
      '#tw-btn-fire',
      '#tw-btn-pick',
      '#tw-btn-throw',
      '#tw-btn-open',
      '#tw-cmd-attack',
      '#tw-cmd-guard',
      '#tw-cmd-fetch',
    ];
    const boxes: { id: string; x: number; y: number; width: number; height: number }[] = [];
    for (const sel of selectors) {
      const box = await page.locator(sel).boundingBox();
      if (!box) continue; // not rendered (e.g. desktop build) — visibility asserted above
      boxes.push({ id: sel, ...box });
      console.log(
        `geometry ${sel}: ${box.width.toFixed(1)}x${box.height.toFixed(1)} at (${box.x.toFixed(1)}, ${box.y.toFixed(1)}) inside=${box.x >= 0 && box.y >= 0 && box.x + box.width <= 844 && box.y + box.height <= 390}`,
      );
      expect(box.width, `${sel} width`).toBeGreaterThanOrEqual(56);
      expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(56);
      expect(box.x, `${sel} left edge`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${sel} top edge`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${sel} right edge`).toBeLessThanOrEqual(844);
      expect(box.y + box.height, `${sel} bottom edge`).toBeLessThanOrEqual(390);
    }

    // The approved action cluster puts both utilities above the Pick/Fire row.
    for (const utility of ['#tw-btn-open', '#tw-btn-throw']) {
      const upper = boxes.find((box) => box.id === utility)!;
      for (const action of ['#tw-btn-pick', '#tw-btn-fire']) {
        const lower = boxes.find((box) => box.id === action)!;
        expect(upper.y + upper.height, `${utility} above ${action}`).toBeLessThanOrEqual(lower.y);
      }
    }

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        const area = Math.max(0, overlapX) * Math.max(0, overlapY);
        expect(area, `${a.id} overlaps ${b.id}`).toBe(0);
      }
    }
  });

  test('axe: no serious/critical violations on the match HUD overlay', async ({ page }) => {
    await page.goto('/?seed=7');
    await waitHooks(page);
    await parkAndStageBombs(page);
    await page.waitForTimeout(300); // let one render frame settle the overlay
    const results = await new AxeBuilder({ page })
      .include('.tw-screen-hud')
      .include('.tw-hud-root')
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const summary = serious.map(
      (v) => `${v.id}(${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
    expect(summary, 'serious/critical axe violations').toEqual([]);
  });
});
