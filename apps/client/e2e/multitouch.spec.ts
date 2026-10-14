import { expect, test } from '@playwright/test';
import { getState, joyDriver, waitHooks } from './helpers';

/**
 * Review Focus 4: the joystick touch is HELD while a second finger taps Fire —
 * both must register in the same second (unit moved AND a slap/bullet landed).
 * Review round 1 #1: deterministic staging through the hooks with a fixed
 * seed — a hit comes from a held joystick plus a Fire tap within seconds, not
 * from a real-time chase loop.
 */
test('held joystick + Fire tap both register while moving', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile-landscape', 'multi-touch is a phone check');
  test.setTimeout(60_000);

  await page.goto('/?seed=11');
  await waitHooks(page);
  const cdp = await page.context().newCDPSession(page);
  const driver = await joyDriver(page, cdp);

  // Fixed stage: the human mid-plaza, a dessert bot adjacent and under 'attack'
  // so it stays engaged. Same seed → same bot behaviour on every run.
  await page.evaluate(() => {
    window.__talad.setCommand('dessert', 'attack');
    window.__talad.placeUnit(0, 20, 12);
    window.__talad.placeUnit(4, 20.8, 12);
  });
  const startPos = (await getState(page)).units[0]!.pos;

  // Joystick held straight up — perpendicular to the enemy offset, so the unit
  // keeps walking while the enemy stays near slap range. Finger 1 never lifts;
  // finger 2 taps Fire every ~400ms. The hit is asserted via the enemy's HP
  // (events are per-tick and racy to poll): only the human can damage unit 4
  // here, so hp < max ⟺ the Fire tap landed.
  await driver.steer(0, -1);
  const deadline = Date.now() + 8_000;
  let hit = false;
  let taps = 0;
  while (Date.now() < deadline && !hit && taps < 20) {
    await driver.fireTap(); // finger 2 taps Fire while finger 1 holds the stick
    taps++;
    const st = await getState(page);
    const enemy = st.units[4]!;
    hit = enemy.hp < 100 || enemy.deadUntilTick !== null;
    if (!hit) await page.waitForTimeout(300);
  }
  await driver.release();

  expect(hit, 'a slap/bullet landed while the joystick touch was held').toBe(true);
  const endPos = (await getState(page)).units[0]!.pos;
  // The unit kept walking the whole time — the joystick touch never dropped
  // when the second finger tapped Fire.
  expect(Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y)).toBeGreaterThan(1.0);
});
