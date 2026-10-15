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
  const driver = mobile()
    ? await joyDriver(page, await page.context().newCDPSession(page))
    : await keyDriver(page);
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'guard');
    window.__talad.setCommand('dessert', 'guard');
    window.__talad.setPadCrates('fruit', [0, 1]);
    window.__talad.placeUnit(0, 8.75, 18.75);
  });
  if (mobile()) await expect(page.locator('#tw-btn-open')).toBeVisible();
  await driver.open();
  await expect.poll(async () => (await getState(page)).units[0]!.bombs).toBe(3);
  await expect.poll(() => page.evaluate(() => window.__talad.audioReady())).toBe(true);
  await driver.throwBomb();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.__talad.audioLog().some((e) => e.key === 'explosion' && e.started),
        ),
      { intervals: [20] },
    )
    .toBe(true);
  // Advance the intercepted real duck timer, not a test-only mixer shortcut.
  const gain = await page.evaluate(() => window.__talad.musicGain());
  expect(gain).toBe(0.12);
  await page.clock.runFor(400);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0.3);
});
