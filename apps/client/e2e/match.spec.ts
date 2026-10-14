import { expect, test } from '@playwright/test';
import {
  driveTo,
  getState,
  joyDriver,
  keyDriver,
  nearestGroundCrate,
  padCrateCount,
  waitHooks,
  type Driver,
} from './helpers';

const PAD_COL0 = { x: 8.75, y: 18.75 }; // fruit pad column 0 center
const MID_SOUTH = { x: 10, y: 14 }; // open corridor south of the market

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
    test.setTimeout(240_000);
    const isMobile = test.info().project.name === 'mobile-landscape';
    await page.goto('/?seed=7');
    await waitHooks(page);
    const driver: Driver = isMobile
      ? await joyDriver(page, await page.context().newCDPSession(page))
      : await keyDriver(page);

    // Park every bot at home (guard) so the ferry run is not harassed; the sim
    // drops a carried crate on ANY damage, so a stray sniper would otherwise
    // keep resetting the run. Recovery from drops stays in the loop regardless.
    await page.evaluate(() => window.__talad.setCommand('fruit', 'guard'));
    await page.evaluate(() => window.__talad.setCommand('dessert', 'guard'));
    await page.evaluate(() => window.__talad.fastForward(140));

    // State machine: place a crate on the own pad — re-picking whenever a hit
    // drops it (combat.ts drops carried crates on damage). Deterministic,
    // bounded by the deadline below.
    const deadline = Date.now() + 150_000;
    let placed = false;
    while (Date.now() < deadline && !placed) {
      const st = await getState(page);
      if (padCrateCount(st) >= 1) {
        placed = true;
        break;
      }
      const me = st.units[0]!;
      if (me.deadUntilTick !== null) {
        await driver.release();
        await page.waitForTimeout(500);
        continue;
      }
      if (me.carrying === null) {
        const crate = nearestGroundCrate(st, me.pos);
        if (!crate) {
          await page.waitForTimeout(400);
          continue;
        }
        const d = Math.hypot(crate.pos.x - me.pos.x, crate.pos.y - me.pos.y);
        if (d > 0.55) {
          await driveTo(page, driver, MID_SOUTH, { within: 1.2, budgetMs: 8_000 });
          await driveTo(page, driver, crate.pos, { within: 0.55, budgetMs: 20_000 });
          continue;
        }
        await driver.action();
        await page.waitForTimeout(400);
        continue;
      }
      // Carrying: haul to the own pad and place.
      const ok = await driveTo(page, driver, PAD_COL0, { within: 0.5, budgetMs: 30_000 });
      if (ok) {
        await driver.action();
        await page.waitForTimeout(700);
      }
    }
    expect(placed, 'a crate reached the own pad').toBe(true);

    // The preview shows the Thai recipe text for 1 crate: a water gun.
    await expect(page.locator('.tw-preview')).toHaveText('จะได้: ปืนฉีดน้ำ', { timeout: 10_000 });

    // Open! is available; on phone the button appears, on desktop E triggers it.
    if (isMobile) {
      await expect(page.locator('#tw-btn-open')).toBeVisible({ timeout: 10_000 });
      await driver.open();
    } else {
      await driver.open();
    }
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
