import { expect, test, type Page } from '@playwright/test';
import type { MatchState } from '@talad/sim';
import type { TaladTestHooks } from '../src/testHooks';
import { padPaintedCellStagePos } from '../src/render/world';
import { waitHooks } from './helpers';

type Frames = { prev: MatchState; cur: MatchState };
declare global {
  interface Window {
    __r1Frames: Frames;
  }
}

// Read real Phaser objects through CDP, not new production hooks. In this
// renderer-only fixture, replace only the scene's sim/input update; Phaser's
// clock, animations, tweens and render loop still run normally.
async function inMatch(page: Page, body: string, args: unknown[] = []) {
  const cdp = await page.context().newCDPSession(page);
  try {
    // Bundled Phaser's module copy is not the global UMD Phaser object.
    // Resolve the live prototype from the hook's module scope, without relying
    // on minified variable names or adding a game reference to window.
    const hook = await cdp.send('Runtime.evaluate', { expression: 'window.__talad.artFeedback' });
    const details = await cdp.send('Runtime.getProperties', { objectId: hook.result.objectId! });
    const scopes = details.internalProperties!.find((p) => p.name === '[[Scopes]]')!;
    const scopeList = await cdp.send('Runtime.getProperties', {
      objectId: scopes.value!.objectId!,
      ownProperties: true,
    });
    const module = scopeList.result.find((p) => p.value?.description === 'Module')!;
    const bindings = await cdp.send('Runtime.getProperties', {
      objectId: module.value!.objectId!,
      ownProperties: true,
    });
    let gamesId: string | undefined;
    for (const binding of bindings.result.filter(
      (p) => p.value?.type === 'object' && p.value.objectId,
    )) {
      const prototype = await cdp.send('Runtime.callFunctionOn', {
        objectId: binding.value!.objectId!,
        functionDeclaration: 'function() { return this?.Game?.prototype; }',
      });
      if (!prototype.result.objectId) continue;
      const games = await cdp.send('Runtime.queryObjects', {
        prototypeObjectId: prototype.result.objectId,
      });
      const live = await cdp.send('Runtime.callFunctionOn', {
        objectId: games.objects.objectId!,
        functionDeclaration: "function() { return this.some(g => g.scene?.isActive('match')); }",
        returnByValue: true,
      });
      if (live.result.value) {
        gamesId = games.objects.objectId!;
        break;
      }
    }
    if (!gamesId) throw new Error('Live match game not found in renderer module');
    const result = await cdp.send('Runtime.callFunctionOn', {
      objectId: gamesId,
      functionDeclaration: `function(...args) { const scene = this.find(g => g.scene?.isActive('match')).scene.getScene('match'); ${body} }`,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } finally {
    await cdp.detach();
  }
}

async function sprites(page: Page) {
  return page.evaluate(() => window.__talad.artFeedback().sprites);
}

async function object(page: Page, name: string) {
  return inMatch(
    page,
    `
    const o = scene.children.getByName(args[0]);
    return o ? { rotation: o.rotation, tint: o.tintTopLeft, x: o.x, y: o.y,
      scaleX: o.scaleX, scaleY: o.scaleY, alpha: o.alpha,
      kind: o.getData('kind'), size: o.getData('size'),
      outline: o.commandBuffer?.includes(0xff3fa4) ? 0xff3fa4 : o.commandBuffer?.includes(0x251414) ? 0x251414 : null, count: scene.children.list.filter(c => c.name === args[0]).length } : null;
  `,
    [name],
  );
}

async function shot(page: Page, kind: 'gun' | 'heavy', quality: boolean) {
  await page.evaluate(
    ({ kind, quality }) => {
      const h = window.__talad as unknown as TaladTestHooks;
      const prev = structuredClone(window.__r1Frames.cur);
      prev.tick += 1;
      prev.crates = [];
      prev.units[0]!.carrying = null;
      prev.units[0]!.gun = { kind, super: quality, ammoCooldownTicks: 0 };
      prev.units[0]!.pos = { x: 18, y: 12 };
      prev.units[0]!.facing = { x: 1, y: 0 };
      const cur = structuredClone(prev);
      cur.tick += 1;
      cur.units[0]!.gun!.ammoCooldownTicks = 30;
      cur.projectiles = [
        {
          id: 950 + cur.tick,
          team: 'fruit',
          kind: kind === 'heavy' ? 'coconut' : 'bullet',
          super: quality,
          pos: { x: 20, y: 12 },
          vel: { x: 12, y: 0 },
          ttlTicks: 15,
        },
      ];
      window.__r1Frames = { prev, cur };
      h.renderSnapshot(prev, cur, 1);
    },
    { kind, quality },
  );
}

test.use({ video: 'on' });
test.describe('R1 art', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await page.goto('/?seed=43');
    await waitHooks(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
    await page.evaluate(() => {
      const cur = (window.__talad as unknown as TaladTestHooks).state();
      cur.tick += 10000;
      cur.events = [];
      cur.crates = [];
      cur.projectiles = [];
      for (const team of ['fruit', 'dessert'] as const)
        cur.pads[team].cells = [
          [null, null],
          [null, null],
          [null, null],
          [null, null],
        ];
      window.__r1Frames = { prev: structuredClone(cur), cur };
    });
    await inMatch(
      page,
      `scene.sys.sceneUpdate = scene.update = () => {
      const {prev, cur} = window.__r1Frames;
      window.__talad.renderSnapshot(prev, cur, 1);
    }; scene.update();`,
    );
  });

  test('super identity survives falling, landing, carrying and upper pad states at manifest ratios', async ({
    page,
  }) => {
    const samples = await page.evaluate(() => {
      const h = window.__talad as unknown as TaladTestHooks;
      const cur = window.__r1Frames.cur;
      cur.crates = [
        {
          id: 900,
          kind: 'super',
          state: 'falling',
          pos: { x: 18, y: 12 },
          landTick: cur.tick + 20,
        },
        { id: 901, kind: 'super', state: 'ground', pos: { x: 22, y: 12 }, landTick: 0 },
        { id: 902, kind: 'super', state: 'carried', pos: cur.units[0]!.pos, landTick: 0 },
        { id: 903, kind: 'normal', state: 'onPad', pos: { x: 0, y: 0 }, landTick: 0 },
        { id: 904, kind: 'super', state: 'onPad', pos: { x: 0, y: 0 }, landTick: 0 },
      ];
      cur.units[0]!.carrying = 902;
      cur.pads.fruit.cells[0] = [903, 904];
      window.__r1Frames.prev = structuredClone(cur);
      h.renderSnapshot(cur, cur, 1);
      const falling = h.artFeedback().sprites;
      cur.tick += 20;
      h.renderSnapshot(cur, cur, 1);
      const atLanding = h.artFeedback().sprites.find((s) => s.name === 'crate-900')!;
      cur.crates[0]!.state = 'ground';
      h.renderSnapshot(cur, cur, 1);
      return {
        falling,
        atLanding,
        ground: h.artFeedback().sprites.find((s) => s.name === 'crate-900')!,
      };
    });
    for (const [id, texture, width] of [
      [900, 'crate_super_air', 66],
      [901, 'crate_super', 66],
      [902, 'crate_super', 54],
      [903, 'crate', 59],
      [904, 'crate_super', 59],
    ] as const) {
      const s = samples.falling.find((s) => s.name === `crate-${id}`)!;
      expect(s.texture).toBe(texture);
      expect(s.width).toBeCloseTo(width, 5);
      const ratio =
        texture === 'crate_super_air'
          ? 430 / 425
          : texture === 'crate_super'
            ? 470 / 401
            : (await (await page.request.get('/art/manifest.json')).json()).props.crate.width /
              (await (await page.request.get('/art/manifest.json')).json()).props.crate.height;
      expect(s.width / s.height).toBeCloseTo(ratio, 5);
    }
    expect(samples.atLanding.texture).toBe('crate_super');
    expect(samples.ground.texture).toBe('crate_super');
  });

  for (const [lower, upper, wantLower, wantUpper] of [
    ['super', 'normal', 'crate_super', 'crate'],
    ['normal', 'super', 'crate', 'crate_super'],
    ['super', 'super', 'crate_super', 'crate_super'],
    ['normal', 'normal', 'crate', 'crate_stack2'],
  ] as const) {
    test(`stack ${lower}/${upper} preserves both identities without a normal composite covering a star`, async ({
      page,
    }) => {
      await page.evaluate(
        ({ lower, upper }) => {
          const cur = window.__r1Frames.cur;
          cur.crates = [lower, upper].map((kind, i) => ({
            id: 900 + i,
            kind,
            state: 'onPad',
            pos: { x: 0, y: 0 },
            landTick: 0,
          }));
          cur.pads.fruit.cells[0] = [900, 901];
          window.__talad.renderSnapshot(cur, cur, 1);
        },
        { lower, upper },
      );
      const ss = await sprites(page);
      const base = ss.find((s) => s.name === 'crate-900')!;
      const top = ss.find((s) => s.name === 'crate-901')!;
      expect(base.texture).toBe(wantLower);
      expect(top.texture).toBe(wantUpper);
      expect(base.y - top.y).toBe(38);
      // Phaser reports width as scale*texture and picks up 1-ulp float error.
      expect(base.width).toBeCloseTo(59, 4);
      expect(top.width).toBeCloseTo(59, 4);
    });
  }

  test('on-pad crates sit at the painted art cell centres (R2b round 2)', async ({ page }) => {
    await page.evaluate(() => {
      const cur = window.__r1Frames.cur;
      cur.crates = [910, 911, 912, 913].map((id, col) => ({
        id,
        kind: 'normal',
        state: 'onPad',
        pos: { x: 0, y: 0 },
        landTick: 0,
      }));
      cur.pads.fruit.cells = [[910], [911], [912], [913]];
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const origin = await page.evaluate(() =>
      (window.__talad as unknown as TaladTestHooks).state().pads.fruit.origin,
    );
    const ss = await sprites(page);
    // Lead finding 22:11: each crate must sit on the PAINTED tile of the pad
    // art (iso diamond N/E/S/W), not the world-rect cell span that drew the
    // back row above the art.
    for (const col of [0, 1, 2, 3]) {
      const s = ss.find((q) => q.name === `crate-${910 + col}`)!;
      const want = padPaintedCellStagePos(origin, col);
      expect(s.x, `col${col} x`).toBe(want.x);
      expect(s.y, `col${col} y`).toBe(want.y);
    }
  });

  test('top-edge super carrier fits the entire real cargo art inside the 720 stage', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const cur = window.__r1Frames.cur;
      cur.units[0]!.pos = { x: 12, y: 0.35 };
      cur.units[0]!.carrying = 900;
      cur.crates = [
        { id: 900, kind: 'super', state: 'carried', pos: cur.units[0]!.pos, landTick: 0 },
      ];
      window.__r1Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const ss = (await sprites(page)).filter((s) => ['unit-0', 'crate-900'].includes(s.name));
    expect(ss).toHaveLength(2);
    expect(ss.find((s) => s.name === 'crate-900')!.height).toBeCloseTo((54 * 401) / 470, 5);
    for (const s of ss) {
      expect(s.y - s.height * s.originY, s.name).toBeGreaterThanOrEqual(0);
      expect(s.y + s.height * (1 - s.originY), s.name).toBeLessThanOrEqual(720);
    }
  });

  test('coconut keeps its own quality, texture and velocity rotation after shooter removal/rearming; normal shots unchanged', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const cur = window.__r1Frames.cur;
      cur.units[0]!.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
      cur.projectiles = [
        {
          id: 900,
          kind: 'coconut',
          super: true,
          team: 'fruit',
          pos: { x: 18, y: 12 },
          vel: { x: 0, y: 12 },
          ttlTicks: 15,
        },
        {
          id: 901,
          kind: 'bullet',
          team: 'fruit',
          pos: { x: 20, y: 12 },
          vel: { x: 0, y: 18 },
          ttlTicks: 15,
        },
        {
          id: 902,
          kind: 'bullet',
          team: 'dessert',
          pos: { x: 22, y: 12 },
          vel: { x: -18, y: 0 },
          ttlTicks: 15,
        },
        {
          id: 903,
          kind: 'bomb',
          team: 'dessert',
          pos: { x: 24, y: 12 },
          vel: { x: 1, y: 0 },
          ttlTicks: 15,
        },
      ];
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    for (const holder of ['armed', 'absent', 'rearmed'] as const) {
      await page.evaluate((holder) => {
        const cur = window.__r1Frames.cur;
        if (holder === 'absent') cur.units = cur.units.filter((u) => u.id !== 0);
        if (holder === 'rearmed') {
          const unit = (window.__talad as unknown as TaladTestHooks).state().units[0]!;
          unit.gun = { ammoCooldownTicks: 0 };
          cur.units.push(unit);
        }
        window.__talad.renderSnapshot(cur, cur, 1);
      }, holder);
      const ss = await sprites(page);
      for (const [id, key, width] of [
        [900, 'shot_coconut', 42],
        [901, 'shot_fruit', 34],
        [902, 'shot_dessert', 34],
        [903, 'bomb', 26],
      ] as const) {
        expect(ss.find((s) => s.name === `projectile-${id}`)).toMatchObject({
          texture: key,
          width,
        });
      }
      const coconut = ss.find((s) => s.name === 'projectile-900')!;
      expect(coconut.width / coconut.height).toBeCloseTo(278 / 207, 5);
      const actual = await object(page, 'projectile-900');
      expect(actual.rotation).toBeCloseTo(Math.PI / 2, 5);
      // No alternate projectile recolour is specified: preserve the approved
      // coconut art and the projectile's own super metadata, never the holder.
      expect(actual.tint).toBe(0xffffff);
      expect(await page.evaluate(() => window.__r1Frames.cur.projectiles[0]!.super)).toBe(true);
    }
    await page.evaluate(() => {
      const cur = window.__r1Frames.cur;
      cur.projectiles[0]!.vel = { x: -12, y: 0 };
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    expect((await object(page, 'projectile-900')).rotation).toBeCloseTo(-Math.PI, 5);
  });

  for (const motion of ['no-preference', 'reduce'] as const) {
    test(`${motion}: heavy144 vs gun96 flash, hot-pink super outline, once per attack tick and 160ms hold/60ms fade`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: motion });
      for (const [kind, quality, size] of [
        ['gun', false, 96],
        ['heavy', false, 144],
        ['heavy', true, 144],
      ] as const) {
        await shot(page, kind, quality);
        const start = await object(page, 'attack-slash-0');
        expect(start).toMatchObject({
          kind,
          size,
          count: 1,
          outline: quality ? 0xff3fa4 : 0x251414,
        });
        const unit = (await sprites(page)).find((s) => s.name === 'unit-0')!;
        expect(unit.frame).toBe(14);
        const attackAt = await page.evaluate(() => window.__talad.unitFeedback(0).attackAt);
        await page.clock.runFor(96);
        const repeated = await object(page, 'attack-slash-0');
        expect(repeated).toEqual(start);
        expect(await page.evaluate(() => window.__talad.unitFeedback(0).attackAt)).toBe(attackAt);
        const moved = (await sprites(page)).find((s) => s.name === 'unit-0')!;
        if (motion === 'reduce') {
          expect(moved.width).toBe(92);
          expect(moved.x).toBe(unit.x);
          expect(moved.y).toBe(unit.y);
        } else expect(moved.width).toBeGreaterThan(94);
        await page.clock.runFor(48);
        expect((await object(page, 'attack-slash-0')).alpha).toBe(1);
        expect(
          await inMatch(
            page,
            `
          const fx = scene.children.getByName('attack-slash-0');
          const data = scene.tweens.getTweensOf(fx)[0].data[0];
          return { delay: data.delay, duration: data.duration };
        `,
          ),
        ).toEqual({ delay: 160, duration: 60 });
        // Phaser first initializes TweenData after its startDelay, then
        // interpolates on the following RAF (16ms). At 192ms the first
        // interpolation has not run yet; 208ms samples the actual fade.
        await page.clock.runFor(64);
        const fading = await object(page, 'attack-slash-0');
        expect(fading.alpha).toBeGreaterThan(0);
        expect(fading.alpha).toBeLessThan(1);
        await page.clock.runFor(48);
        expect(await object(page, 'attack-slash-0')).toBeNull();
        await page.clock.runFor(64); // same snapshot cannot resurrect an expired flash
        expect(await object(page, 'attack-slash-0')).toBeNull();
      }
    });
  }

  test('recorded normal/heavy/super shots and super carry/landing remain readable', async ({
    page,
  }) => {
    // Record real RAF-paced motion, not fast-forwarded virtual time with only
    // a handful of encoder frames. This fixture demonstrates rendering only.
    await page.clock.resume();
    for (const [kind, quality] of [
      ['gun', false],
      ['heavy', false],
      ['heavy', true],
    ] as const) {
      await shot(page, kind, quality);
      const path = test.info().outputPath(`${kind}-${quality ? 'super' : 'normal'}.png`);
      await page.screenshot({ path });
      await test.info().attach(`${kind}-${quality ? 'super' : 'normal'}`, {
        path,
        contentType: 'image/png',
      });
      // Bound capture by real elapsed time, not a fixed number of RAFs:
      // software-rendered CI frames can take >100ms each. The fixture still
      // advances at the sim's 50ms tick cadence; product timing is untouched.
      await page.evaluate(async () => {
        const start = performance.now();
        const startTick = window.__r1Frames.cur.tick;
        let elapsed = 0;
        while (elapsed < 600) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          elapsed = Math.min(performance.now() - start, 600);
          const cur = window.__r1Frames.cur;
          window.__r1Frames.prev = structuredClone(cur);
          cur.tick = startTick + Math.floor(elapsed / 50);
          cur.projectiles[0]!.pos.x = 20 + (12 * elapsed) / 1000;
        }
      });
    }
    await page.evaluate(() => {
      const cur = window.__r1Frames.cur;
      cur.projectiles = [];
      cur.units[0]!.pos = { x: 9, y: 18 };
      cur.units[0]!.carrying = 900;
      cur.crates = [
        { id: 900, kind: 'super', state: 'carried', pos: cur.units[0]!.pos, landTick: 0 },
        {
          id: 901,
          kind: 'super',
          state: 'falling',
          pos: { x: 12, y: 18 },
          landTick: cur.tick + 30,
        },
        { id: 902, kind: 'super', state: 'onPad', pos: { x: 0, y: 0 }, landTick: 0 },
        { id: 903, kind: 'normal', state: 'onPad', pos: { x: 0, y: 0 }, landTick: 0 },
      ];
      cur.pads.fruit.cells[0] = [902, 903];
      window.__r1Frames.prev = structuredClone(cur);
    });
    await page.evaluate(async () => {
      const start = performance.now();
      const startTick = window.__r1Frames.cur.tick;
      let elapsed = 0;
      // 30 staged ticks still take 1500ms; retain 300ms of the landed crate.
      while (elapsed < 1800) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        elapsed = Math.min(performance.now() - start, 1800);
        const cur = window.__r1Frames.cur;
        window.__r1Frames.prev = structuredClone(cur);
        cur.tick = startTick + Math.floor(elapsed / 50);
        if (cur.tick >= cur.crates[1]!.landTick) cur.crates[1]!.state = 'ground';
      }
    });
    expect((await sprites(page)).find((s) => s.name === 'crate-901')!.texture).toBe('crate_super');
    const path = test.info().outputPath('super-carry-mixed-stack-landing.png');
    await page.screenshot({ path });
    await test.info().attach('super-carry-mixed-stack-landing', {
      path,
      contentType: 'image/png',
    });
  });
});
