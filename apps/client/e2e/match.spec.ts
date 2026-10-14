import { expect, test } from '@playwright/test';
import {
  driveTo,
  getState,
  joyDriver,
  keyDriver,
  padCrateCount,
  waitHooks,
  type Driver,
} from './helpers';

const PAD_COL0 = { x: 8.75, y: 18.75 }; // fruit pad column 0 center

test.describe('match scene', () => {
  test('boots into a running 2-team match that ticks', async ({ page }) => {
    await page.goto('/?seed=42');
    await waitHooks(page);
    const s0 = await getState(page);
    expect(s0.units).toHaveLength(6);
    expect(s0.winner).toBeNull();
    await page.waitForTimeout(600);
    const s1 = await getState(page);
    expect(s1.tick).toBeGreaterThan(s0.tick);
  });

  test('visibility: hidden tab freezes the sim, return resumes without a burst', async ({
    page,
  }) => {
    await page.goto('/?seed=42');
    await waitHooks(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const frozen = await getState(page);
    await page.waitForTimeout(1200);
    const stillFrozen = await getState(page);
    expect(stillFrozen.tick).toBe(frozen.tick);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(120);
    const resumed = await getState(page);
    // ≤ 5 catch-up ticks per frame (Review Focus 5); a broken clamp would jump 20+.
    expect(resumed.tick - stillFrozen.tick).toBeLessThanOrEqual(5);
  });

  test('human unit moves with WASD / joystick drag', async ({ page }) => {
    test.setTimeout(60_000);
    const isMobile = test.info().project.name === 'mobile-landscape';
    await page.goto('/?seed=42');
    await waitHooks(page);
    const driver: Driver = isMobile
      ? await joyDriver(page, await page.context().newCDPSession(page))
      : await keyDriver(page);

    const s0 = await getState(page);
    const me0 = s0.units[0]!;
    // Drag the joystick up-right (or hold W+D) for about a second.
    for (let i = 0; i < 8; i++) {
      await driver.steer(0.8, -0.8);
      await page.waitForTimeout(120);
    }
    await driver.release();
    const s1 = await getState(page);
    const me1 = s1.units[0]!;
    expect(s1.tick).toBeGreaterThan(s0.tick + 5);
    expect(me1.pos.x).toBeGreaterThan(me0.pos.x);
    expect(me1.pos.y).toBeLessThan(me0.pos.y);
  });

  test('carries a crate to the pad, preview shows the Thai recipe, Open! yields a gun', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const isMobile = test.info().project.name === 'mobile-landscape';
    await page.goto('/?seed=7');
    await waitHooks(page);
    const driver: Driver = isMobile
      ? await joyDriver(page, await page.context().newCDPSession(page))
      : await keyDriver(page);

    // Review round 1 #1: deterministic staging through the hooks — everyone
    // guards home, crates land, and the human teleports beside a landed crate
    // near the own pad. No 150s ferry state machine; what remains is a short,
    // seed-deterministic walk that still exercises pick → carry → drop → open.
    await page.evaluate(() => {
      window.__talad.setCommand('fruit', 'guard');
      window.__talad.setCommand('dessert', 'guard');
      window.__talad.fastForward(140);
    });
    const crate = await page.evaluate(() => {
      const st = window.__talad.state();
      const padC = { x: 8.75, y: 18.75 }; // fruit pad column 0 center
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const c of st.crates) {
        if (c.state !== 'ground') continue;
        const d = Math.hypot(c.pos.x - padC.x, c.pos.y - padC.y);
        if (d < bestD) {
          bestD = d;
          best = c.pos;
        }
      }
      return best;
    });
    expect(crate, 'a landed crate exists after fast-forward').not.toBeNull();
    await page.evaluate((p) => window.__talad.placeUnit(0, p.x + 0.5, p.y), crate!);

    await driver.action(); // pick up (E / Pick button)
    await expect
      .poll(async () => (await getState(page)).units[0]!.carrying, { timeout: 5_000 })
      .not.toBeNull();

    // Short straight haul to the own pad column; guard bots keep the lane clear.
    const walked = await driveTo(page, driver, PAD_COL0, { within: 0.4, budgetMs: 12_000 });
    expect(walked, 'walked the crate to the own pad column').toBe(true);
    await driver.action(); // drop on the pad
    await expect
      .poll(async () => padCrateCount(await getState(page)), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);

    // The preview shows the Thai recipe text for 1 crate: a water gun.
    await expect(page.locator('.tw-preview')).toHaveText('จะได้: ปืนฉีดน้ำ', { timeout: 10_000 });

    // Open! is available; on phone the button appears, on desktop E triggers it.
    if (isMobile) {
      await expect(page.locator('#tw-btn-open')).toBeVisible({ timeout: 10_000 });
    }
    await driver.open();
    await expect
      .poll(
        async () => {
          const st = await getState(page);
          return st.units[0]?.gun ?? null;
        },
        { timeout: 8_000 },
      )
      .not.toBeNull();
    const done = await getState(page);
    expect(done.units[0]!.carrying).toBeNull();
  });
});
