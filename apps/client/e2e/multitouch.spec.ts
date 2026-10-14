import { expect, test } from '@playwright/test';
import { getState, joyDriver, waitHooks } from './helpers';

/**
 * Review Focus 4: the joystick touch is HELD while a second finger taps Fire —
 * both must register in the same second (unit moved AND a slap/bullet landed).
 * Review round 1 #1: deterministic staging through the hooks with a fixed
 * seed, and the hit must come from a held joystick plus a Fire tap within
 * seconds — no real-time chase algorithm that CI latency can break.
 */
test('held joystick + Fire tap both register while moving', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile-landscape', 'multi-touch is a phone check');
  test.setTimeout(60_000);

  await page.goto('/?seed=11');
  await waitHooks(page);
  const cdp = await page.context().newCDPSession(page);
  const driver = await joyDriver(page, cdp);

  // Fixed stage: the human mid-plaza; dessert unit 4 adjacent, marching under
  // 'attack' to the fruit stall (a straight, predictable line). Fruit guards
  // stay home, so mid-map damage to unit 4 can only come from the human.
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'guard');
    window.__talad.setCommand('dessert', 'attack');
    window.__talad.placeUnit(0, 20, 12);
    window.__talad.placeUnit(4, 20.8, 12);
  });
  const startPos = (await getState(page)).units[0]!.pos;

  // Pure pursuit: finger 1 stays held on the joystick the whole time (steer()
  // only sends touchMove after the first press) and re-aims at unit 4's live
  // position; finger 2 taps Fire every iteration. The enemy walks a straight
  // line at the same max speed, so the human settles ~0.8 units behind it —
  // inside slap range (1.2) — no matter how slow the runner is. The hit is
  // asserted via the enemy's hp (events are per-tick and racy to poll).
  let hit = false;
  let taps = 0;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !hit && taps < 60) {
    const st = await getState(page);
    const me = st.units[0]!;
    const foe = st.units[4]!;
    if (foe.hp < 100 || foe.deadUntilTick !== null) {
      hit = true;
      break;
    }
    const dx = foe.pos.x - me.pos.x;
    const dy = foe.pos.y - me.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    await driver.steer(dx / d, dy / d);
    await driver.fireTap();
    taps++;
  }
  await driver.release();

  expect(hit, 'a slap/bullet landed while the joystick touch was held').toBe(true);
  const endPos = (await getState(page)).units[0]!.pos;
  // The unit kept walking the whole time — the joystick touch never dropped
  // when the second finger tapped Fire.
  expect(Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y)).toBeGreaterThan(1.0);
});
