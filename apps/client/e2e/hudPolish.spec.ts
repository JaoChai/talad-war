import { expect, test } from '@playwright/test';
import { waitHooks } from './helpers';

// Mutations caught: automatic Thai wrapping, missing inner padding, or a taller
// timer covering the baked-in bench. The arena image is 1920x1080; this
// conservative region encloses its top-centre bench and sacks (including shadow).
const BENCH = { x: 840, y: 80, width: 240, height: 130 };

async function openMatch(page: Parameters<typeof waitHooks>[0]): Promise<void> {
  await page.goto('/?seed=7');
  await waitHooks(page); // Also asserts the title: never accept another app on 4173.
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__talad.setCommand('fruit', 'guard');
    window.__talad.setCommand('dessert', 'guard');
  });
}

test('Thai command labels keep whole words with padded, non-overlapping targets', async ({
  page,
}, testInfo) => {
  await openMatch(page);
  if (process.env.HUD_POLISH_SHOTS) {
    await page.screenshot({
      path: `${process.env.HUD_POLISH_SHOTS}/${testInfo.project.name}.png`,
    });
  }
  const labels = await page.locator('.tw-cmd-btn').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const lines = new Map<number, { text: string; left: number; right: number }>();
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
      while (walker.nextNode()) {
        const node = walker.currentNode;
        for (const { segment, index } of segmenter.segment(node.textContent ?? '')) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + segment.length);
          const rect = [...range.getClientRects()].find((r) => r.width > 0);
          if (!rect) continue;
          const key = Math.round(rect.top);
          const line = lines.get(key) ?? { text: '', left: rect.left, right: rect.right };
          line.text += segment;
          line.left = Math.min(line.left, rect.left);
          line.right = Math.max(line.right, rect.right);
          lines.set(key, line);
        }
      }
      return {
        id: button.id,
        lines: [...lines.values()].map((line) => line.text),
        inset: Math.min(
          ...[...lines.values()].flatMap((line) => [
            line.left - box.left - parseFloat(style.borderLeftWidth),
            box.right - parseFloat(style.borderRightWidth) - line.right,
          ]),
        ),
        font: parseFloat(style.fontSize),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    }),
  );
  console.log('command geometry', JSON.stringify(labels));
  expect(labels).toHaveLength(3);
  const allowed: Record<string, string[][]> = {
    'tw-cmd-attack': [['บุก']],
    'tw-cmd-guard': [['เฝ้าแผง'], ['เฝ้า', 'แผง']],
    'tw-cmd-fetch': [['ไปขนลัง'], ['ไป', 'ขนลัง']],
  };
  for (const label of labels) {
    expect.soft(label.lines.length, label.id).toBeLessThanOrEqual(2);
    expect.soft(allowed[label.id], `${label.id} word boundary`).toContainEqual(label.lines);
    expect.soft(label.inset, `${label.id} text inset inside border`).toBeGreaterThanOrEqual(4);
    expect.soft(label.font).toBeGreaterThanOrEqual(13);
    expect.soft(label.box.width).toBeGreaterThanOrEqual(56);
    expect.soft(label.box.height).toBeGreaterThanOrEqual(56);
    expect.soft(label.box.x).toBeGreaterThanOrEqual(0);
    expect.soft(label.box.y).toBeGreaterThanOrEqual(0);
    expect.soft(label.box.x + label.box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect.soft(label.box.y + label.box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  // Include maximal touch controls without changing the existing HUD spec.
  await page.evaluate(() => window.__talad.setPadCrates('fruit', [0, 1]));
  await page.evaluate(() => window.__talad.placeUnit(0, 8.75, 18.75));
  if (testInfo.project.name === 'mobile-landscape') {
    await page.locator('#tw-btn-open').click();
    await expect.poll(() => page.evaluate(() => window.__talad.state().units[0]!.bombs)).toBe(3);
    await page.evaluate(() => window.__talad.setPadCrates('fruit', [0, 1]));
    await expect(page.locator('#tw-btn-open')).toBeVisible();
    await expect(page.locator('#tw-btn-throw')).toBeVisible();
  }
  const controls = await page.locator('.tw-cmd-btn, .tw-btn').evaluateAll((buttons) =>
    buttons
      .filter((b) => b.getClientRects().length > 0)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
  );
  for (const a of controls) {
    for (const b of controls.filter((b) => b.id > a.id)) {
      const area =
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      expect(area, `${a.id} overlaps ${b.id}`).toBe(0);
    }
  }
});

test('timer clears the bench region with readable text', async ({ page }) => {
  await openMatch(page);
  const result = await page.evaluate((bench) => {
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    const timer = document.querySelector('#tw-timer')!;
    const box = timer.getBoundingClientRect();
    const prop = {
      left: canvas.left + (bench.x / 1920) * canvas.width,
      top: canvas.top + (bench.y / 1080) * canvas.height,
      right: canvas.left + ((bench.x + bench.width) / 1920) * canvas.width,
      bottom: canvas.top + ((bench.y + bench.height) / 1080) * canvas.height,
    };
    const area =
      Math.max(0, Math.min(box.right, prop.right) - Math.max(box.left, prop.left)) *
      Math.max(0, Math.min(box.bottom, prop.bottom) - Math.max(box.top, prop.top));
    const style = getComputedStyle(timer);
    const channels = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const [r, g, b, alpha = 1] = channels(style.backgroundColor);
    // White is the worst possible underlying arena pixel for white timer text.
    const bg = [r!, g!, b!].map((c) => c * alpha + 255 * (1 - alpha));
    const luminance = (rgb: number[]) =>
      rgb.reduce((sum, c, i) => {
        const s = c / 255;
        return (
          sum +
          (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!
        );
      }, 0);
    const fg = luminance(channels(style.color).slice(0, 3));
    const background = luminance(bg);
    return {
      area,
      timer: box.toJSON(),
      prop,
      contrast: (Math.max(fg, background) + 0.05) / (Math.min(fg, background) + 0.05),
    };
  }, BENCH);
  console.log('timer geometry', JSON.stringify(result));
  expect(result.area, 'timer / bench intersection px²').toBe(0);
  expect(result.contrast).toBeGreaterThanOrEqual(4.5);
});

test('portrait rotate prompt covers the entire HUD', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-landscape', 'rotate prompt is touch-only');
  await openMatch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const prompt = page.locator('.tw-rotate');
  await expect(prompt).toBeVisible();
  expect(await prompt.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(
    await page.evaluate(() =>
      [
        [1, 1],
        [389, 1],
        [1, 843],
        [389, 843],
        [195, 422],
      ].every(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.tw-rotate')),
    ),
  ).toBe(true);
});

test('short-screen command labels and timer stay inside the viewport', async ({ page }) => {
  await openMatch(page);
  for (const height of [308, 340, 341, 350, 351]) {
    await page.setViewportSize({ width: 788, height });
    await expect(page.locator('.tw-rotate')).toBeHidden();
    const overflow = await page.locator('.tw-cmd-btn, #tw-timer').evaluateAll((elements) =>
      elements
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left < 0 ||
            r.top < 0 ||
            r.right > innerWidth ||
            r.bottom > innerHeight ||
            el.scrollWidth > el.clientWidth ||
            el.scrollHeight > el.clientHeight
          );
        })
        .map((el) => el.id),
    );
    expect(overflow, `788x${height}`).toEqual([]);
    const overlaps = await page.locator('.tw-cmd-btn, .tw-btn').evaluateAll((elements) => {
      const visible = elements.filter((el) => el.getClientRects().length > 0);
      return visible.flatMap((a, i) =>
        visible.slice(i + 1).flatMap((b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          const area =
            Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left)) *
            Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
          return area > 0 ? [`${a.id}/${b.id}: ${area} px²`] : [];
        }),
      );
    });
    expect(overlaps, `788x${height} control overlaps`).toEqual([]);
  }
});
