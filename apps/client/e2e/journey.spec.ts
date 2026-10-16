import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { enterMatch, getState, waitHooks } from './helpers';
import type { MatchStats } from '../src/stats';

async function title(page: Page): Promise<void> {
  await page.goto('/?seed=7');
  await expect(page).toHaveTitle('Talad War');
  await expect(page.getByRole('heading', { name: 'ตลาดวอร์', exact: true })).toBeVisible();
}

async function finish(
  page: Page,
  winner: 'fruit' | 'dessert' | 'draw' = 'fruit',
  warmupTicks = 0,
): Promise<MatchStats> {
  const stats = await page.evaluate(
    ({ winner, warmupTicks }) => {
      if (warmupTicks) {
        window.__talad.setSeed(7);
        window.__talad.fastForward(warmupTicks);
      }
      const started = performance.now();
      delete document.documentElement.dataset.handoffMs;
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-screen="results"]')) return;
        document.documentElement.dataset.handoffMs = String(performance.now() - started);
        observer.disconnect();
      });
      observer.observe(document.getElementById('app')!, { childList: true, subtree: true });
      if (winner !== 'dessert') window.__talad.setStallHp('dessert', 0);
      if (winner !== 'fruit') window.__talad.setStallHp('fruit', 0);
      window.__talad.fastForward(1);
      // Check the banner synchronously: a slow test driver must not miss it.
      if (document.querySelector<HTMLElement>('.tw-winner')?.hidden !== false)
        throw new Error('winner banner missing before Results');
      return window.__talad.stats();
    },
    { winner, warmupTicks },
  );
  await expect(page.locator('[data-screen="results"]')).toBeVisible({ timeout: 2500 });
  const elapsedMs = await page.evaluate(() => Number(document.documentElement.dataset.handoffMs));
  console.log(`winner → Results: ${elapsedMs}ms`);
  expect(elapsedMs).toBeGreaterThanOrEqual(1100);
  expect(elapsedMs).toBeLessThanOrEqual(2000);
  return stats;
}

// Model a slow software-rendered device from its first frame. Phaser's initial
// delta smoothing must not stretch the real-time winner banner duration.
async function slowFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      request(() => window.setTimeout(() => callback(performance.now()), 100));
  });
}

async function screenCheck(page: Page, info: TestInfo, screen: string): Promise<void> {
  const root = page.locator('.tw-journey');
  const rects = await root.locator('button').evaluateAll((buttons) =>
    buttons.map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    }),
  );
  const viewport = page.viewportSize()!;
  for (const r of rects) {
    expect(r.w).toBeGreaterThanOrEqual(56);
    expect(r.h).toBeGreaterThanOrEqual(56);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(viewport.width);
    expect(r.bottom).toBeLessThanOrEqual(viewport.height);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      expect(a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y).toBe(false);
    }
  const { violations } = await new AxeBuilder({ page }).include('.tw-journey').analyze();
  expect(violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
  console.log(`axe ${info.project.name} ${screen}: 0 serious / 0 critical`);
  const path = info.outputPath(`${info.project.name}-${screen}.png`);
  await page.screenshot({ path });
  await info.attach(`${screen}`, { path, contentType: 'image/png' });
}

test('fresh storage: Title, skippable how-to, scored Results, replay tick zero with new seed, home', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await title(page);
  await screenCheck(page, info, 'title');
  await page.getByRole('button', { name: 'เล่น', exact: true }).click();
  await expect(page.locator('[data-screen="howto"]')).toBeVisible();
  await screenCheck(page, info, 'howto-1');
  await page.getByRole('button', { name: 'ข้าม', exact: true }).click();
  await waitHooks(page);
  // Every stepped tick feeds stats, including fastForward's multi-tick loop.
  const seed = (await getState(page)).seed;
  const stats = await finish(page, 'fruit', 1600);
  expect(stats.dessert.stallDamage).toBe(1168.5);
  expect(stats.fruit.cratesPlaced + stats.dessert.cratesPlaced).toBeGreaterThan(0);
  expect(stats.fruit.itemsBuilt + stats.dessert.itemsBuilt).toBeGreaterThan(0);
  expect(stats.fruit.stallDamage + stats.dessert.stallDamage).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'ทีมผลไม้ชนะ!', exact: true })).toBeVisible();
  for (const team of ['fruit', 'dessert'] as const) {
    for (const key of ['cratesPlaced', 'itemsBuilt', 'stallDamage'] as const) {
      await expect(page.locator(`[data-team="${team}"] [data-stat="${key}"]`)).toHaveText(
        String(key === 'stallDamage' ? Math.round(stats[team][key]) : stats[team][key]),
      );
    }
  }
  await expect(page.locator('[data-team="dessert"] [data-stat="stallDamage"]')).toHaveText('1169');
  await screenCheck(page, info, 'results');
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.getByRole('button', { name: 'เล่นอีก', exact: true }).click();
  await page.clock.runFor(17);
  expect((await getState(page)).tick).toBe(0);
  expect((await getState(page)).seed).not.toBe(seed);
  expect(await page.evaluate(() => window.__talad.stats().fruit)).toEqual({
    cratesPlaced: 0,
    itemsBuilt: 0,
    stallDamage: 0,
  });
  await page.clock.resume();
  await finish(page, 'dessert');
  await expect(page.getByRole('heading', { name: 'ทีมขนมชนะ!', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'หน้าแรก', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ตลาดวอร์', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'เล่น', exact: true }).click();
  await waitHooks(page);
  await expect(page.locator('[data-screen="howto"]')).toHaveCount(0);
  await finish(page, 'draw');
  await expect(page.getByRole('heading', { name: 'เสมอ!', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('three Thai how-to cards complete once and the next visit skips them', async ({
  page,
}, info) => {
  await title(page);
  await page.getByRole('button', { name: 'เล่น', exact: true }).click();
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible();
  await screenCheck(page, info, 'howto-2');
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(page.getByText('3 / 3', { exact: true })).toBeVisible();
  await screenCheck(page, info, 'howto-3');
  await page.getByRole('button', { name: 'เล่น', exact: true }).click();
  await waitHooks(page);
  expect(await page.evaluate(() => localStorage.getItem('tw.howto.seen'))).toBe('1');
  await page.reload();
  await enterMatch(page);
  await expect(page.locator('[data-screen="howto"]')).toHaveCount(0);
});

test('sound off persists through reload and replay, on restores the next match music gain', async ({
  page,
}) => {
  await slowFrames(page);
  await title(page);
  await page.getByRole('button', { name: 'เสียง: เปิด', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('tw.sound'))).toBe('off');
  await page.reload();
  await expect(page.getByRole('button', { name: 'เสียง: ปิด', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await enterMatch(page);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0);
  await finish(page);
  await page.getByRole('button', { name: 'เล่นอีก', exact: true }).click();
  await waitHooks(page);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0);
  await finish(page);
  await page.getByRole('button', { name: 'หน้าแรก', exact: true }).click();
  await page.getByRole('button', { name: 'เสียง: ปิด', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('tw.sound'))).toBe('on');
  await enterMatch(page);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0.3);
});

test('touch portrait pauses at the same tick, landscape resumes; desktop never prompts', async ({
  page,
}, info) => {
  await title(page);
  await enterMatch(page);
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(17);
  const prompt = page.getByText('หมุนจอเป็นแนวนอน', { exact: true });
  const before = (await getState(page)).tick;
  if (info.project.name === 'mobile-landscape') await expect(prompt).toBeVisible();
  else await expect(prompt).toBeHidden();
  await page.clock.runFor(1000);
  const after = (await getState(page)).tick;
  if (info.project.name === 'mobile-landscape') expect(after).toBe(before);
  else expect(after).toBeGreaterThan(before);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.clock.runFor(17);
  await expect(prompt).toBeHidden();
  if (info.project.name === 'mobile-landscape')
    expect((await getState(page)).tick - after).toBeLessThanOrEqual(1);
  await page.clock.runFor(200);
  expect((await getState(page)).tick).toBeGreaterThan(after);
});

test('denied browser storage does not prevent starting or replaying', async ({ page }) => {
  await slowFrames(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('Denied', 'SecurityError');
    };
  });
  await title(page);
  await page.getByRole('button', { name: 'เสียง: เปิด', exact: true }).click();
  await enterMatch(page);
  expect(await page.evaluate(() => window.__talad.musicGain())).toBe(0);
  await finish(page);
  await page.getByRole('button', { name: 'เล่นอีก', exact: true }).click();
  await waitHooks(page);
  expect((await getState(page)).winner).toBeNull();
});

test('short landscape keeps Title, how-to and Results actions above the fold in both schemes', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 788, height: 308 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/?seed=7');
    await page.evaluate(() => localStorage.removeItem('tw.howto.seen'));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ตลาดวอร์', exact: true })).toBeVisible();
    for (const screen of ['title', 'howto', 'results']) {
      const bounds = await page.locator('.tw-journey-panel').evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, viewport: innerHeight };
      });
      expect(bounds.top, `${screen} ${colorScheme}`).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom, `${screen} ${colorScheme}`).toBeLessThanOrEqual(bounds.viewport);
      await screenCheck(page, info, `short-${colorScheme}-${screen}`);
      if (screen === 'title') await page.getByRole('button', { name: 'เล่น', exact: true }).click();
      if (screen === 'howto') {
        await page.getByRole('button', { name: 'ข้าม', exact: true }).click();
        await waitHooks(page);
        await finish(page);
        await expect(
          page.getByRole('heading', { name: 'ทีมผลไม้ชนะ!', exact: true }),
        ).toBeVisible();
      }
    }
  }
});
