import { expect, test } from '@playwright/test';
import { driveTo, getState, joyDriver, nearestEnemy } from './helpers';

/**
 * Review Focus 4: the joystick touch is HELD while a second finger taps Fire —
 * both must register in the same second (unit moved AND a slap/bullet landed).
 */
test('held joystick + Fire tap both register while moving', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile-landscape', 'multi-touch is a phone check');
  test.setTimeout(150_000);

  await page.goto('/?seed=11');
  await page.waitForFunction(() => window.__talad !== undefined, undefined, { timeout: 20_000 });
  const cdp = await page.context().newCDPSession(page);
  const driver = await joyDriver(page, cdp);

  await page.evaluate(() => window.__talad.setCommand('fruit', 'guard'));
  await page.evaluate(() => window.__talad.fastForward(140));

  const startPos = (await getState(page)).units[0]!.pos;
  const deadline = Date.now() + 120_000;
  let fired = false;
  let lastTapAt = 0;
  while (Date.now() < deadline) {
    const st = await getState(page);
    const me = st.units[0]!;
    if (me.deadUntilTick !== null) {
      await driver.release();
      await page.waitForTimeout(400);
      continue;
    }
    const enemy = nearestEnemy(st, 'fruit');
    if (!enemy) {
      await page.waitForTimeout(300);
      continue;
    }
    const dx = enemy.pos.x - me.pos.x;
    const dy = enemy.pos.y - me.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.95) {
      // Joystick stays held every frame we steer — including while tapping Fire.
      await driver.steer(dx, dy);
      if (Date.now() - lastTapAt > 400) {
        await driver.fireTap();
        lastTapAt = Date.now();
      }
    } else {
      await driver.steer(dx * 0.15, dy * 0.15); // keep the joystick engaged
      await driver.fireTap();
      lastTapAt = Date.now();
      const hit = st.events.some(
        (e) => e.kind === 'hit' && typeof e.target === 'number' && e.target !== 0,
      );
      if (hit) {
        fired = true;
        break;
      }
    }
    await page.waitForTimeout(110);
  }
  await driver.release();

  expect(fired, 'a slap/bullet hit occurred while the joystick was held').toBe(true);
  const endPos = (await getState(page)).units[0]!.pos;
  expect(Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y)).toBeGreaterThan(0.5);
  // The unit kept moving right up to the hit — the joystick touch never dropped.
  await driveTo(page, driver, { x: endPos.x + 0.5, y: endPos.y }, { within: 0.4, budgetMs: 4_000 });
});
