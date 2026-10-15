import { expect, test } from '@playwright/test';
import { waitHooks } from './helpers';

// Catches ignored string hit targets, per-frame replay, and a shared/absent
// rate limiter. All hits below come from the real sim, not injected FX events.
test('stall hits tint both stalls, spark on the attacker side, expire and rate-limit repeated hits', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?seed=43');
  await waitHooks(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const first = await page.evaluate(() => {
    const h = window.__talad;
    h.setSeed(43);
    h.setCommand('fruit', 'attack');
    h.setCommand('dessert', 'attack');
    h.placeUnit(1, 32.3, 4.4);
    h.placeUnit(2, 33.7, 6.7);
    h.placeUnit(3, 7.7, 21.4);
    h.placeUnit(4, 7.7, 19.6);
    h.placeUnit(5, 6.3, 17.3);
    h.fastForward(1);
    return {
      state: h.state(),
      fruit: h.stallFeedback('fruit'),
      dessert: h.stallFeedback('dessert'),
    };
  });
  for (const team of ['fruit', 'dessert'] as const) {
    expect(first.state.events.some((e) => e.kind === 'hit' && e.target === team)).toBe(true);
    const fx = first[team];
    expect(fx.flashUntil - fx.now).toBeGreaterThanOrEqual(150);
    expect(fx.flashUntil - fx.now).toBeLessThanOrEqual(220);
    expect(fx.tint).not.toBe(0xffffff);
    expect(fx.sparks).toBe(1); // same-tick multi-hit -> one cue, independently per stall
  }
  const repeated = await page.evaluate(() => {
    const h = window.__talad;
    h.fastForward(0); // same sim tick rendered again
    h.fastForward(10); // new, real slaps, but zero elapsed render time
    return {
      state: h.state(),
      fruit: h.stallFeedback('fruit'),
      dessert: h.stallFeedback('dessert'),
    };
  });
  for (const team of ['fruit', 'dessert'] as const) {
    expect(repeated.state.events.some((e) => e.kind === 'hit' && e.target === team)).toBe(true);
    expect(repeated[team].shakeAt).toBe(first[team].shakeAt);
    expect(repeated[team].flashUntil).toBe(first[team].flashUntil);
    expect(repeated[team].sparks).toBe(1);
  }
  await page.clock.runFor(80);
  const shaking = await page.evaluate(() => window.__talad.stallFeedback('dessert'));
  expect(Math.abs(shaking.x - first.dessert.x)).toBeGreaterThan(0.01);
  expect(Math.abs(shaking.x - first.dessert.x)).toBeLessThanOrEqual(4);
  await page.clock.runFor(144);
  const expired = await page.evaluate(() => window.__talad.stallFeedback('dessert'));
  expect(expired.now).toBeGreaterThan(first.dessert.flashUntil);
  expect(expired.tint).toBe(0xffffff);
  expect(expired.x).toBe(first.dessert.x);
  expect(expired.sparks).toBe(0);
  const again = await page.evaluate(() => {
    const h = window.__talad;
    // Arrive at the next real attack pulse regardless of RAF/tick rounding.
    for (let i = 0; i < 10; i++) h.fastForward(1);
    return h.stallFeedback('dessert');
  });
  expect(again.shakeAt - first.dessert.shakeAt).toBeGreaterThanOrEqual(150);
  expect(again.flashUntil).toBeGreaterThan(first.dessert.flashUntil);
  expect(again.tint).not.toBe(0xffffff);
});
