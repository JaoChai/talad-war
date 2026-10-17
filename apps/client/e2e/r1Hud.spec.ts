import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CrateKind, MatchState } from '@talad/sim';
import type { TaladTestHooks } from '../src/testHooks';
import { waitHooks } from './helpers';

type Entry = { col: number; layer: 0 | 1; kind?: CrateKind };
const star = 'img[src$="prop_badge_super.webp"]';

async function start(page: Page) {
  await page.clock.install();
  await page.goto('/?seed=7');
  await expect(page.locator('.tw-loadout, .tw-preview')).toHaveCount(0);
  await waitHooks(page); // Exact title, not just HTTP200 on the shared preview port.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.__talad.setSeed(7);
    window.__talad.setCommand('fruit', 'guard');
    window.__talad.setCommand('dessert', 'guard');
    window.__talad.placeUnit(0, 8.75, 18.75);
  });
}

async function stage(page: Page, entries: Entry[]) {
  expect(await page.evaluate(() => typeof window.__talad.setPadLayout)).toBe('function');
  await page.evaluate((entries) => window.__talad.setPadLayout('fruit', entries), entries);
  await page.clock.runFor(50);
}

async function open(page: Page, touch: boolean) {
  if (touch) await page.locator('#tw-btn-open').tap();
  else await page.keyboard.press('KeyE');
  await expect
    .poll(
      async () => {
        await page.clock.runFor(50);
        return page.evaluate(
          () => (window.__talad as unknown as TaladTestHooks).state().pads.fruit.opening !== null,
        );
      },
      { intervals: [0] },
    )
    .toBe(true);
  const started = await page.evaluate(() => window.__talad.state().tick);
  await page.evaluate(() => window.__talad.fastForward(20));
  expect(await page.evaluate(() => window.__talad.state().tick)).toBe(started + 20);
  expect(
    await page.evaluate(
      () => (window.__talad as unknown as TaladTestHooks).state().pads.fruit.opening,
    ),
  ).toBeNull();
}

async function fire(page: Page, touch: boolean) {
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const b = (await page.locator('#tw-btn-fire').boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 1 }],
    });
    await page.clock.runFor(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(900, 420);
    await page.mouse.down();
    await page.clock.runFor(50);
    await page.mouse.up();
  }
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function geometry(page: Page) {
  const result = await page.evaluate(() => {
    const live = [...document.querySelectorAll<HTMLElement>('.tw-loadout, .tw-preview')].filter(
      (e) => !e.hidden,
    );
    const obstacles = [
      ...document.querySelectorAll<HTMLElement>(
        '.tw-hp, .tw-timer, .tw-cmd-btn, .tw-btn, .tw-joy-base',
      ),
    ].filter((e) => e.getClientRects().length);
    const failures: string[] = [];
    for (const e of live) {
      const r = e.getBoundingClientRect();
      if (r.left < 8 || r.right > innerWidth - 8 || r.top < 0 || r.bottom > innerHeight)
        failures.push(`${e.className}: viewport`);
      if (e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight)
        failures.push(`${e.className}: clipped`);
      if (getComputedStyle(e).pointerEvents !== 'none') failures.push(`${e.className}: intercepts`);
      for (const o of [...obstacles, ...live.filter((o) => o !== e)]) {
        const b = o.getBoundingClientRect();
        if (
          Math.min(r.right, b.right) > Math.max(r.left, b.left) &&
          Math.min(r.bottom, b.bottom) > Math.max(r.top, b.top)
        )
          failures.push(`${e.className}/${o.id || o.className}`);
      }
    }
    return {
      failures,
      boxes: live.map((e) => ({ text: e.textContent, box: e.getBoundingClientRect().toJSON() })),
    };
  });
  console.log('R1 HUD geometry', JSON.stringify(result));
  expect(result.failures).toEqual([]);
}

test.describe('R1 HUD', () => {
  test('real Open and fire craft super heavy, replace with normal gun, refill independent bombs', async ({
    page,
  }, info) => {
    await start(page);
    const touch = info.project.name === 'mobile-landscape';
    await expect(page.locator('.tw-loadout')).toHaveText('มือเปล่า');
    await stage(
      page,
      [0, 1, 2, 3].map((col) => ({
        col,
        layer: 0,
        ...(col === 2 ? { kind: 'super' as const } : {}),
      })),
    );
    await expect(page.locator('.tw-preview')).toHaveText('จะได้: บาซูก้ามะพร้าว พิเศษ');
    await expect(page.locator('.tw-preview').locator(star)).toBeVisible();
    await geometry(page);
    await screenshot(page, info, 'super-heavy-preview');
    await open(page, touch);
    expect(await page.evaluate(() => window.__talad.state().units[0]!.gun)).toEqual({
      kind: 'heavy',
      super: true,
      ammoCooldownTicks: 0,
    });
    await expect(page.locator('.tw-item-primary')).toHaveText('บาซูก้ามะพร้าว พิเศษ');
    await expect(page.locator('.tw-preview')).toBeHidden();
    await fire(page, touch);
    const shots = await page.evaluate(
      () => (window.__talad as unknown as TaladTestHooks).state().projectiles,
    );
    expect(shots.filter((p) => p.kind === 'coconut' && p.team === 'fruit' && p.super)).toHaveLength(
      1,
    );
    await screenshot(page, info, 'crafted-heavy');

    await stage(page, [{ col: 0, layer: 0 }]);
    await expect(page.locator('.tw-preview')).toHaveText('จะได้: ปืนฉีดน้ำ');
    await open(page, touch);
    expect(await page.evaluate(() => window.__talad.state().units[0]!.gun)).toEqual({
      ammoCooldownTicks: 0,
    });
    await expect(page.locator('.tw-item-primary')).toHaveText('ปืนฉีดน้ำ');
    await expect(page.locator('.tw-item-primary').locator(star)).toHaveCount(0);
    await stage(page, [
      { col: 0, layer: 0 },
      { col: 1, layer: 0 },
    ]);
    await open(page, touch);
    await expect(page.locator('.tw-item-bombs')).toHaveText('ระเบิด ×3');
    await stage(page, [
      { col: 0, layer: 0 },
      { col: 1, layer: 0, kind: 'super' },
    ]);
    await open(page, touch);
    expect(await page.evaluate(() => window.__talad.state().units[0]!.bombs)).toBe(5);
    await expect(page.locator('.tw-item-bombs')).toHaveText('ระเบิด พิเศษ ×5');
    await expect(page.locator('.tw-item-bombs').locator(star)).toBeVisible();
    await expect(page.locator('.tw-item-primary').locator(star)).toHaveCount(0);
    await geometry(page);
    await screenshot(page, info, 'independent-super-bombs');
    for (let i = 0; i < 5; i++) {
      if (touch) await page.locator('#tw-btn-throw').tap();
      else await page.keyboard.press('KeyQ');
      await page.clock.runFor(50);
    }
    expect(await page.evaluate(() => window.__talad.state().units[0]!.bombs)).toBe(0);
    await expect(page.locator('.tw-item-bombs')).toHaveCount(0);
    await expect(page.locator('.tw-loadout').locator(star)).toHaveCount(0);
  });

  test('stacked super buddy grants a permanent teammate flag, not a switched player', async ({
    page,
  }, info) => {
    await start(page);
    const before = await page.evaluate(() => window.__talad.state().units);
    await stage(page, [
      { col: 0, layer: 1, kind: 'super' },
      { col: 0, layer: 0 },
    ]);
    await expect(page.locator('.tw-preview')).toHaveText('จะได้: ลูกทีม พิเศษ');
    await open(page, info.project.name === 'mobile-landscape');
    const after = await page.evaluate(
      () => (window.__talad as unknown as TaladTestHooks).state().units,
    );
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((u) => !before.some((b) => b.id === u.id))).toMatchObject({
      team: 'fruit',
      superBuddy: true,
      isBot: true,
    });
    expect(after[0]).toMatchObject({ id: 0, isBot: false, gun: null });
    await expect(page.locator('.tw-loadout')).toHaveText('มือเปล่า');
  });

  test('layout validation is atomic and repeat staging removes old pad crates and opening', async ({
    page,
  }, info) => {
    await start(page);
    await stage(page, [{ col: 0, layer: 0, kind: 'super' }]);
    if (info.project.name === 'mobile-landscape') await page.locator('#tw-btn-open').tap();
    else await page.keyboard.press('KeyE');
    await page.clock.runFor(50);
    const before = await page.evaluate(() => (window.__talad as unknown as TaladTestHooks).state());
    expect(before.pads.fruit.opening).not.toBeNull();
    for (const invalid of [
      [{ col: -1, layer: 0 }],
      [{ col: 4, layer: 0 }],
      [{ col: 0.5, layer: 0 }],
      [{ col: 0, layer: 2 }],
      [
        { col: 0, layer: 0 },
        { col: 0, layer: 0 },
      ],
      [{ col: 1, layer: 1 }],
      [{ col: 0, layer: 0, kind: 'pink' }],
    ]) {
      const outcome = await page.evaluate((entries) => {
        try {
          window.__talad.setPadLayout('fruit', entries as Entry[]);
          return 'accepted';
        } catch {
          return 'rejected';
        }
      }, invalid);
      expect(outcome).toBe('rejected');
      expect(
        await page.evaluate(() => (window.__talad as unknown as TaladTestHooks).state()),
      ).toEqual(before);
    }
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() =>
        window.__talad.setPadLayout('fruit', [
          { col: 2, layer: 1, kind: 'super' },
          { col: 2, layer: 0 },
        ]),
      );
      const cur = await page.evaluate(() => (window.__talad as unknown as TaladTestHooks).state());
      const ids = cur.pads.fruit.cells.flat().filter((id) => id !== null);
      expect(ids).toHaveLength(2);
      expect(
        cur.crates
          .filter((c) => c.state === 'onPad')
          .map((c) => c.id)
          .sort(),
      ).toEqual([...ids].sort());
      expect(new Set(cur.crates.map((c) => c.id)).size).toBe(cur.crates.length);
      expect(cur.pads.fruit.opening).toBeNull();
      expect(
        cur.crates
          .filter((c) => ids.includes(c.id))
          .map((c) => c.kind)
          .sort(),
      ).toEqual(['normal', 'super']);
    }
    await page.evaluate(() => window.__talad.setPadCrates('fruit', [0, 1]));
    const legacy = await page.evaluate(() => (window.__talad as unknown as TaladTestHooks).state());
    expect(legacy.crates.filter((c) => c.state === 'onPad').map((c) => c.kind)).toEqual([
      'normal',
      'normal',
    ]);
  });

  test('worst-case dual quality stays clear at responsive boundaries and preview clamps to both edges', async ({
    page,
  }, info) => {
    await start(page);
    await page.evaluate(() =>
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }),
    );
    const s = await page.evaluate(() => (window.__talad as unknown as TaladTestHooks).state());
    s.units[0]!.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    s.units[0]!.bombs = 5;
    s.units[0]!.bombsSuper = true;
    for (const width of [1280, 1024, 984, 933, 932, 901, 900, 844, 788, 768]) {
      await page.setViewportSize({ width, height: 390 });
      await page.clock.runFor(50);
      await page.evaluate(
        (cur) => (window.__talad as unknown as TaladTestHooks).renderSnapshot(cur, cur, 1),
        s,
      );
      await expect(page.locator('.tw-loadout').locator(star)).toHaveCount(2);
      await geometry(page);
    }
    await page.setViewportSize(info.project.use.viewport!);
    await page.clock.runFor(50);
    const id = s.nextId++;
    s.pads.fruit.cells[0]![0] = id;
    s.crates.push({ id, kind: 'super', state: 'onPad', landTick: 0, pos: { x: 8.75, y: 18.75 } });
    for (const x of [-100, 100]) {
      s.pads.fruit.origin.x = x;
      await page.evaluate(
        (cur) => (window.__talad as unknown as TaladTestHooks).renderSnapshot(cur, cur, 1),
        s,
      );
      // The impossible off-map origin deliberately tests viewport clamping,
      // not interaction geometry; real-pad boxes were checked above.
      const box = (await page.locator('.tw-preview').boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(x < 0 ? box.x : viewport.width - box.x - box.width).toBeCloseTo(8, 1);
    }
    await screenshot(page, info, 'clamped-preview');
  });

  test('render-only states, missing images, accessibility and rotate/reset never leave stale promises', async ({
    page,
  }, info) => {
    await start(page);
    await expect(page.locator('.tw-loadout')).toHaveText('มือเปล่า');
    const s = await page.evaluate(() => (window.__talad as unknown as TaladTestHooks).state());
    // Freeze simulation, not Phaser or a mutable raw-state/loadout API. Fixtures
    // go solely to renderSnapshot; actual crafting is covered separately above.
    await page.evaluate(() =>
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }),
    );
    async function render(cur: MatchState) {
      await page.evaluate(
        (cur) => (window.__talad as unknown as TaladTestHooks).renderSnapshot(cur, cur, 1),
        cur,
      );
    }
    for (const kind of ['gun', 'heavy'] as const) {
      for (const quality of [false, true]) {
        s.units[0]!.gun = { kind, super: quality, ammoCooldownTicks: 0 };
        s.units[0]!.bombs = 5;
        s.units[0]!.bombsSuper = !quality;
        await render(s);
        await expect(page.locator('.tw-item-primary')).toHaveText(
          `${kind === 'gun' ? 'ปืนฉีดน้ำ' : 'บาซูก้ามะพร้าว'}${quality ? ' พิเศษ' : ''}`,
        );
        await expect(page.locator('.tw-item-primary').locator(star)).toHaveCount(quality ? 1 : 0);
        await geometry(page);
      }
    }
    const id = s.nextId++;
    s.crates.push({ id, pos: { x: 8.75, y: 18.75 }, state: 'carried', kind: 'super', landTick: 0 });
    s.units[0]!.carrying = id;
    await render(s);
    await expect(page.locator('.tw-item-primary')).toHaveText('ลัง พิเศษ');
    await screenshot(page, info, 'super-cargo');
    s.units[0]!.carrying = null;
    s.crates[0] = { ...s.crates[0]!, id, state: 'onPad' };
    s.pads.fruit.cells[0]![0] = id;
    await render(s);
    await expect(page.locator('.tw-preview')).toHaveText('จะได้: ปืนฉีดน้ำ พิเศษ');
    await page
      .locator('.tw-preview img, .tw-loadout img')
      .evaluateAll((images) => images.forEach((image) => image.dispatchEvent(new Event('error'))));
    await render(s);
    await expect(page.locator('.tw-preview img')).toBeHidden();
    await expect(page.locator('.tw-preview')).toHaveText('จะได้: ปืนฉีดน้ำ พิเศษ');
    await expect(page.locator('.tw-item-primary')).toHaveText('บาซูก้ามะพร้าว พิเศษ');
    await geometry(page);
    await screenshot(page, info, 'missing-image-fallback');

    // Paused page timers stall axe: resume during analysis; document.hidden
    // still prevents any simulation advancement or fixture overwrite.
    await page.clock.resume();
    const axe = await new AxeBuilder({ page }).analyze();
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    console.log('R1 HUD axe serious/critical:', serious.length);
    expect(serious).toEqual([]);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    s.pads.fruit.cells[3]![0] = s.nextId++;
    await render(s);
    await expect(page.locator('.tw-preview')).toHaveText('ยังไม่ใช่สูตร');
    await expect(page.locator('.tw-preview').locator(star)).toHaveCount(0);
    s.pads.fruit.cells[3]![0] = null;
    s.pads.fruit.cells[0]![1] = s.nextId++;
    s.units.push({ ...s.units[1]!, id: s.nextId++ }, { ...s.units[1]!, id: s.nextId++ });
    await render(s);
    await expect(page.locator('.tw-preview')).toHaveText('ทีมเต็มแล้ว');
    await expect(page.locator('.tw-preview').locator(star)).toHaveCount(0);
    await screenshot(page, info, 'team-full');
    s.units[0]!.deadUntilTick = s.tick + 100;
    await render(s);
    await expect(page.locator('.tw-loadout')).toBeHidden();
    await expect(page.locator('.tw-loadout').locator(star)).toHaveCount(0);
    s.units[0]!.deadUntilTick = null;
    s.units[0]!.gun = null;
    s.units[0]!.bombs = 0;
    s.pads.fruit.cells = Array.from({ length: 4 }, () => [null, null]);
    await render(s);
    await expect(page.locator('.tw-loadout')).toHaveText('มือเปล่า');
    await expect(page.locator('.tw-preview')).toBeHidden();
    s.winner = 'fruit';
    await render(s);
    await expect(page.locator('.tw-loadout')).toBeHidden();
    await expect(page.locator('.tw-preview')).toBeHidden();
    await page.evaluate(() => window.__talad.setSeed(7));
    await expect(page.locator('.tw-loadout')).toHaveText('มือเปล่า');
    await expect(page.locator('.tw-winner')).toBeHidden();
    if (info.project.name === 'mobile-landscape') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.runFor(50);
      await expect(page.locator('.tw-rotate')).toBeVisible();
      expect(await page.locator('.tw-rotate').boundingBox()).toEqual({
        x: 0,
        y: 0,
        width: 390,
        height: 844,
      });
      await screenshot(page, info, 'portrait-rotate');
      await page.setViewportSize({ width: 844, height: 390 });
      await page.clock.runFor(50);
      await expect(page.locator('.tw-rotate')).toBeHidden();
    }
  });
});
