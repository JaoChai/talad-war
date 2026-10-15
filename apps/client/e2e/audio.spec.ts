import { expect, test } from '@playwright/test';
import { getState, joyDriver, keyDriver, waitHooks } from './helpers';

const mobile = () => test.info().project.name === 'mobile-landscape';

test('audio: gesture unlocks real buffers and every fast-forwarded tick emits seeded cues', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const assets: { url: string; status: number; type: string }[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (/\/audio\/.*\.(ogg|mp3)$/.test(r.url()))
      assets.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '' });
  });
  await page.goto('/?seed=7');
  await waitHooks(page);
  expect(await page.evaluate(() => window.__talad.audioReady())).toBe(false);
  expect(assets).toEqual([]);
  if (mobile()) await page.locator('#tw-cmd-attack').tap();
  else await page.keyboard.press('Digit1');
  await expect.poll(() => page.evaluate(() => window.__talad.audioReady())).toBe(true);
  await page.evaluate(() => {
    window.__talad.setSeed(7);
    window.__talad.fastForward(1600);
  });
  const log = await page.evaluate(() => window.__talad.audioLog());
  expect(log.some((e) => e.key === 'fire' && e.started)).toBe(true);
  expect(log.some((e) => e.key === 'crateLand' && e.started)).toBe(true);
  expect(log.some((e) => e.key === 'hitUnit' && e.started)).toBe(true);
  // Tick 90 is the first landed crate. Losing intermediate ticks misses it.
  expect(log.some((e) => e.key === 'crateLand' && e.tick === 90)).toBe(true);
  expect(assets).toHaveLength(15);
  for (const asset of assets) {
    expect(asset.status, asset.url).toBe(200);
    expect(asset.type, asset.url).toMatch(/^audio\//);
  }
  expect(errors).toEqual([]);
  await testInfo.attach('seed-7-audio-log', {
    body: JSON.stringify(log, null, 2),
    contentType: 'application/json',
  });
});

test('audio: a real bomb explosion ducks music to 0.12 and restores 0.3 after 400ms', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?seed=7');
  await waitHooks(page);
  // Own the clock after boot: slow CI rendering must not decide how many
  // simulation ticks fit inside a wall-time expect.poll timeout.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const driver = mobile()
    ? await joyDriver(page, await page.context().newCDPSession(page))
    : await keyDriver(page);
  await page.evaluate(() => {
    window.__talad.setSeed(7);
    window.__talad.setCommand('fruit', 'guard');
    window.__talad.setCommand('dessert', 'guard');
    window.__talad.setPadCrates('fruit', [0, 1]);
    window.__talad.placeUnit(0, 8.75, 18.75);
  });
  await page.clock.runFor(50); // render the touch Open! control before input
  if (mobile()) await expect(page.locator('#tw-btn-open')).toBeVisible();
  await driver.open(); // trusted gesture unlocks audio; the input pulse waits for a tick
  await expect.poll(() => page.evaluate(() => window.__talad.audioReady())).toBe(true);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(50);
        return page.evaluate(() =>
          window.__talad.audioLog().some((e) => e.key === 'openStarted' && e.started),
        );
      },
      { intervals: [0], timeout: 20_000 },
    )
    .toBe(true);
  // Complete the REAL 20-tick recipe, independent of wall-time rendering speed.
  await page.evaluate(() => window.__talad.fastForward(20));
  expect((await getState(page)).units[0]!.bombs).toBe(3);
  expect(
    await page.evaluate(() =>
      window.__talad.audioLog().some((e) => e.key === 'opened' && e.started),
    ),
  ).toBe(true);
  await page.clock.runFor(50); // syncUi renders Throw after the recipe completes
  if (mobile()) await expect(page.locator('#tw-btn-throw')).toBeVisible();
  await driver.throwBomb();
  await expect
    .poll(
      async () => {
        await page.clock.runFor(50);
        return (await getState(page)).units[0]!.bombs;
      },
      { intervals: [0], timeout: 20_000 },
    )
    .toBe(2);
  expect(
    await page.evaluate(() =>
      window.__talad.audioLog().some((e) => e.key === 'throw' && e.started),
    ),
  ).toBe(true);
  // Advance the real projectile's 24-tick fuse, not an injected explosion.
  // The browser clock stays paused: the duck timeout starts at this exact instant.
  await page.evaluate(() => window.__talad.fastForward(24));
  expect(
    await page.evaluate(
      () => window.__talad.audioLog().filter((e) => e.key === 'explosion' && e.started).length,
    ),
  ).toBe(1);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0.12);
  // Advance the intercepted real duck timer, not a test-only mixer shortcut.
  await page.clock.runFor(399);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0.12);
  await page.clock.runFor(1);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0.3);
});
