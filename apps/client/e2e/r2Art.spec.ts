import { expect, test, type Page } from '@playwright/test';
import type { MatchState } from '@talad/sim';
import type { TaladTestHooks } from '../src/testHooks';
import { waitHooks } from './helpers';

type Frames = { prev: MatchState; cur: MatchState };
declare global {
  interface Window {
    __r2Frames: Frames;
  }
}

interface Manifest {
  classArt: {
    headFrames: Record<string, { x: number; y: number; width: number }[]>;
    classes: Record<string, { head: string; badge: string; bodyScale: number }>;
    control: { ring: string; arrow: string; switchIcon: string };
  };
  props: Record<string, { file: string; width: number; height: number }>;
}

let manifestPromise: Promise<Manifest> | null = null;
function manifest(page: Page): Promise<Manifest> {
  manifestPromise ??= page.request.get('/art/manifest.json').then((r) => r.json());
  return manifestPromise;
}

// Read real Phaser objects through CDP, not new production hooks (same
// renderer-only fixture as r1Art: replace only the scene's sim update; the
// Phaser clock, animations, tweens and render loop still run normally).
async function inMatch(page: Page, body: string, args: unknown[] = []) {
  const cdp = await page.context().newCDPSession(page);
  try {
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
        const result = await cdp.send('Runtime.callFunctionOn', {
          objectId: games.objects.objectId!,
          functionDeclaration: `function(...args) { const scene = this.find(g => g.scene?.isActive('match')).scene.getScene('match'); ${body} }`,
          arguments: args.map((value) => ({ value })),
          returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      }
    }
    throw new Error('Live match game not found in renderer module');
  } finally {
    await cdp.detach();
  }
}

async function sprites(page: Page) {
  return page.evaluate(() => window.__talad.artFeedback().sprites);
}

function find(list: Awaited<ReturnType<typeof sprites>>, name: string) {
  const sprite = list.find((s) => s.name === name);
  expect(sprite, name).toBeDefined();
  return sprite!;
}

/** Pure §4.3 recompute used to check the live pipeline's head placement. */
function headGeom(
  body: {
    x: number;
    y: number;
    width: number;
    height: number;
    originX: number;
    originY: number;
    flipX: boolean;
  },
  head: { x: number; y: number; width: number },
) {
  const sx = body.width / 256;
  const sy = body.height / 256;
  const ox = head.x - body.originX * 256;
  const oy = head.y - body.originY * 256;
  return {
    x: body.x + (body.flipX ? -ox : ox) * sx,
    y: body.y + oy * sy,
    width: (head.width / 128) * 256 * sx,
    height: (head.width / 128) * 256 * sy,
  };
}

async function stageMatch(page: Page): Promise<void> {
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
    // Two extra buddies so all 8 skins are visible (id 6 → 4th fruit skin,
    // id 7 → 4th dessert skin, mirroring the view's teamMates mapping).
    cur.units.push(
      {
        id: 6,
        team: 'fruit',
        pos: { x: 6, y: 8 },
        facing: { x: 1, y: 0 },
        isBot: true,
        hp: 100,
        deadUntilTick: null,
        carrying: null,
        gun: null,
        bombs: 0,
        attackCooldownTicks: 0,
        classId: 'giant',
      } as (typeof cur.units)[number],
      {
        id: 7,
        team: 'dessert',
        pos: { x: 22, y: 16 },
        facing: { x: 1, y: 0 },
        isBot: true,
        hp: 100,
        deadUntilTick: null,
        carrying: null,
        gun: null,
        bombs: 0,
        attackCooldownTicks: 0,
        classId: undefined,
      } as (typeof cur.units)[number],
    );
    window.__r2Frames = { prev: structuredClone(cur), cur };
  });
  await inMatch(
    page,
    `scene.sys.sceneUpdate = scene.update = () => {
    const {prev, cur} = window.__r2Frames;
    window.__talad.renderSnapshot(prev, cur, 1);
  }; scene.update();`,
  );
}

test.use({ video: 'on' });

test.describe('R2 class art', () => {
  test.beforeEach(async ({ page }) => {
    await stageMatch(page);
  });

  test('head accessory and badge follow the idle frames with no offset', async ({ page }) => {
    const m = await manifest(page);
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      cur.units[0]!.classId = 'healer';
      cur.units[0]!.pos = { x: 20, y: 12 };
      cur.units[0]!.facing = { x: 1, y: 0 };
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const skin = 'fruit_mangosteen';
    const head = await find(await sprites(page), 'unit-0-head');
    const body = await find(await sprites(page), 'unit-0');
    expect(head.texture).toBe(m.classArt.classes.healer!.head);
    expect(body.frame).toBe(0);
    const want = headGeom(
      {
        x: body.x,
        y: body.y,
        width: body.width,
        height: body.height,
        originX: body.originX,
        originY: body.originY,
        flipX: false,
      },
      m.classArt.headFrames[skin]![0]!,
    );
    expect(head.x).toBeCloseTo(want.x, 4);
    expect(head.y).toBeCloseTo(want.y, 4);
    expect(head.width).toBeCloseTo(want.width, 4);
    expect(head.height).toBeCloseTo(want.height, 4);
    // Controlled animation-clock advancement: idle runs at 6 fps, so one run
    // of a frame period lands frame 1 and the head must ride its landmark.
    await page.clock.runFor(1000 / 6);
    const advanced = await sprites(page);
    const head1 = find(advanced, 'unit-0-head');
    const body1 = find(advanced, 'unit-0');
    expect(body1.frame).toBe(1);
    const want1 = headGeom(
      {
        x: body1.x,
        y: body1.y,
        width: body1.width,
        height: body1.height,
        originX: body1.originX,
        originY: body1.originY,
        flipX: false,
      },
      m.classArt.headFrames[skin]![1]!,
    );
    expect(head1.y).toBeCloseTo(want1.y, 4);
    expect(head1.x).toBeCloseTo(want1.x, 4);
    // Badge floats 4 px above the drawn union at 24x24.
    const badge = find(advanced, 'unit-0-badge');
    expect(badge.texture).toBe(m.classArt.classes.healer!.badge);
    expect(badge.width).toBeCloseTo(24, 4);
    expect(badge.height).toBeCloseTo(24, 4);
  });

  test('flip mirrors the landmark offset while poses stay attached', async ({ page }) => {
    const m = await manifest(page);
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      cur.units[0]!.classId = 'boxer';
      cur.units[0]!.pos = { x: 20, y: 12 };
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const plain = find(await sprites(page), 'unit-0-head');
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      cur.units[0]!.facing = { x: -1, y: 0 };
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const mirrored = find(await sprites(page), 'unit-0-head');
    const body = find(await sprites(page), 'unit-0');
    const flipX = (await inMatch(
      page,
      "return scene.children.getByName('unit-0').flipX;",
    )) as boolean;
    expect(flipX).toBe(true);
    const plainBody = {
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
      originX: body.originX,
      originY: body.originY,
      flipX: false,
    };
    const wantPlain = headGeom(plainBody, m.classArt.headFrames.fruit_mangosteen![0]!);
    const wantMirror = headGeom(
      { ...plainBody, flipX: true },
      m.classArt.headFrames.fruit_mangosteen![0]!,
    );
    expect(plain.x).toBeCloseTo(wantPlain.x, 4);
    expect(mirrored.x).toBeCloseTo(wantMirror.x, 4);
    expect(plain.y).toBeCloseTo(mirrored.y, 4);
  });

  test('all 8 skins wear the right class kit, Giant at 1.20x, classless without kit', async ({
    page,
  }) => {
    const m = await manifest(page);
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      // units 0-2 fruit (mangosteen/rambutan/durian), 3-5 dessert
      // (khanomkrok/thongyod/lookchup), 6 longan, 7 khanomchan.
      const classes = [
        'boxer',
        'ninja',
        'giant',
        'healer',
        'boxer',
        'ninja',
        'giant',
        undefined,
      ] as const;
      cur.units.forEach((u, i) => {
        u.classId = classes[i] as typeof u.classId;
      });
      cur.units[6]!.superBuddy = true;
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const ss = await sprites(page);
    const skins = [
      'fruit_mangosteen',
      'fruit_rambutan',
      'fruit_durian',
      'dessert_khanomkrok',
      'dessert_thongyod',
      'dessert_lookchup',
      'fruit_longan',
      'dessert_khanomchan',
    ];
    for (let i = 0; i < 8; i += 1) {
      const body = find(ss, `unit-${i}`);
      expect(body.texture, `skin ${i}`).toBe(skins[i]);
      const cls = (await page.evaluate((idx) => window.__r2Frames.cur.units[idx]!.classId, i)) as
        string | undefined;
      const head = find(ss, `unit-${i}-head`);
      const badge = find(ss, `unit-${i}-badge`);
      if (cls) {
        expect(head.texture, `head ${i}`).toBe(m.classArt.classes[cls]!.head);
        expect(badge.texture, `badge ${i}`).toBe(m.classArt.classes[cls]!.badge);
        expect(head.visible, `head visible ${i}`).toBe(true);
        expect(badge.visible, `badge visible ${i}`).toBe(true);
        const scale = m.classArt.classes[cls]!.bodyScale;
        expect(body.width, `body ${i}`).toBeCloseTo(92 * scale, 4);
        expect(body.height, `body height ${i}`).toBeCloseTo(92 * scale, 4);
        const want = headGeom(
          {
            x: body.x,
            y: body.y,
            width: body.width,
            height: body.height,
            originX: body.originX,
            originY: body.originY,
            flipX: false,
          },
          m.classArt.headFrames[skins[i]!]![body.frame]!,
        );
        expect(head.width, `head width ${i}`).toBeCloseTo(want.width, 4);
      } else {
        expect(head.visible, `classless head hidden ${i}`).toBe(false);
        expect(badge.visible, `classless badge hidden ${i}`).toBe(false);
        expect(body.width).toBeCloseTo(92, 4);
      }
    }
    // Super star: only for superBuddy, 16 px, from the existing R1 art.
    const star6 = find(ss, 'unit-6-star');
    expect(star6.texture).toBe('badge_super');
    expect(star6.width).toBeCloseTo(16, 4);
    expect(star6.visible).toBe(true);
    const star0 = find(ss, 'unit-0-star');
    expect(star0.visible).toBe(false);
  });

  test('y=0.45 with super cargo clamps the whole union on-canvas for the controlled body', async ({
    page,
  }) => {
    const m = await manifest(page);
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      cur.units[0]!.classId = 'boxer';
      cur.units[0]!.pos = { x: 20, y: 0.45 };
      cur.units[0]!.carrying = 902;
      cur.units[0]!.facing = { x: 1, y: 0 };
      cur.crates = [
        { id: 902, kind: 'super', state: 'carried', pos: cur.units[0]!.pos, landTick: 0 },
      ];
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const ss = await sprites(page);
    const body = find(ss, 'unit-0');
    const head = find(ss, 'unit-0-head');
    const badge = find(ss, 'unit-0-badge');
    const cargo = find(ss, 'crate-902');
    expect(cargo.texture).toBe('crate_super');
    expect(cargo.width).toBeCloseTo(54, 4);
    // Carried super crate hangs from the raised hands at 207/256 of 92 px.
    expect(body.y - cargo.y).toBeCloseTo((207 / 256) * 92, 4);
    // §4.3: the badge never covers the carried crate — its bottom edge keeps a
    // 4 px gap above the crate's top (centre-origin badge, origin 0.5 crate).
    expect(badge.y + badge.height / 2).toBeLessThanOrEqual(cargo.y - cargo.height - 4 + 1e-6);
    // The §4.3 guard: drawn union top (incl. badge band) at exactly +2 +24.
    const tops = [
      body.y - body.height * body.originY,
      head.y - head.height / 2,
      cargo.y - cargo.height,
      badge.y - badge.height / 2,
    ];
    const unionTop = Math.min(...tops);
    expect(unionTop).toBeGreaterThanOrEqual(26 - 1e-6);
    for (const top of tops) expect(top).toBeGreaterThanOrEqual(0);
    expect(m.classArt.classes.boxer!.head).toBe('class_head_boxer');
  });

  test('dead units hide body and kit, revive restores them (KO stays hidden art)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      cur.units[1]!.classId = 'ninja';
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
      cur.units[1]!.deadUntilTick = cur.tick + 500;
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const dead = await sprites(page);
    expect(find(dead, 'unit-1').visible).toBe(false);
    expect(find(dead, 'unit-1-head').visible).toBe(false);
    expect(find(dead, 'unit-1-badge').visible).toBe(false);
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      cur.units[1]!.deadUntilTick = null;
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    const alive = await sprites(page);
    expect(find(alive, 'unit-1').visible).toBe(true);
    expect(find(alive, 'unit-1-head').visible).toBe(true);
    expect(find(alive, 'unit-1-head').texture).toBe('class_head_ninja');
  });

  test('contact sheet: all kits, Giant and super cargo at y=0.45', async ({ page }, testInfo) => {
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      const classes = [
        'boxer',
        'ninja',
        'giant',
        'healer',
        'boxer',
        'ninja',
        'giant',
        undefined,
      ] as const;
      cur.units.forEach((u, i) => {
        u.classId = classes[i] as typeof u.classId;
      });
      cur.units[0]!.pos = { x: 20, y: 0.45 };
      cur.units[0]!.carrying = 902;
      // Mid-arena Giant carry: probes the same 4 px badge-vs-crate gap away
      // from the stage top and at the 1.20x display scale.
      cur.units[2]!.carrying = 903;
      cur.units[6]!.superBuddy = true;
      cur.crates = [
        { id: 902, kind: 'super', state: 'carried', pos: cur.units[0]!.pos, landTick: 0 },
        { id: 903, kind: 'normal', state: 'carried', pos: cur.units[2]!.pos, landTick: 0 },
      ];
      window.__r2Frames.prev = structuredClone(cur);
      window.__talad.renderSnapshot(cur, cur, 1);
    });
    await page.waitForTimeout(150);
    const shot = await page.screenshot({ path: 'test-results/r2-contact-sheet.png' });
    await testInfo.attach('r2-contact-sheet', { body: shot, contentType: 'image/png' });
    const ss = await sprites(page);
    expect(find(ss, 'unit-2-head').texture).toBe('class_head_giant');
    expect(find(ss, 'unit-2').width).toBeCloseTo(92 * 1.2, 4);
    expect(find(ss, 'crate-902').texture).toBe('crate_super');
    // Mid-arena Giant carry: badge bottom keeps 4 px above the crate top.
    const badge2 = find(ss, 'unit-2-badge');
    const cargo903 = find(ss, 'crate-903');
    expect(badge2.y + badge2.height / 2).toBeLessThanOrEqual(
      cargo903.y - cargo903.height - 4 + 1e-6,
    );
  });
});

// Real-RAF clip: run/carry/slap motion at wall-clock pace for media-check.
test.describe('R2 class art clip', () => {
  test('records run, carry and slap with attached accessories', async ({ page }) => {
    await page.goto('/?seed=43');
    await waitHooks(page);
    await page.evaluate(() => {
      const cur = (window.__talad as unknown as TaladTestHooks).state();
      cur.tick += 10000;
      cur.events = [];
      cur.crates = [];
      cur.projectiles = [];
      cur.units[0]!.classId = 'healer';
      cur.units[2]!.classId = 'giant';
      cur.units[3]!.classId = 'boxer';
      for (const team of ['fruit', 'dessert'] as const)
        cur.pads[team].cells = [
          [null, null],
          [null, null],
          [null, null],
          [null, null],
        ];
      window.__r2Frames = { prev: structuredClone(cur), cur };
    });
    await inMatch(
      page,
      `scene.sys.sceneUpdate = scene.update = () => {
      const {prev, cur} = window.__r2Frames;
      const realNow = scene.time.now;
      // This renderer-only clip owns its attack clock, not the game/RAF clock.
      if (scene.__r2ClipNow !== undefined) scene.time.now = scene.__r2ClipNow;
      try { window.__talad.renderSnapshot(prev, cur, 1); }
      finally { scene.time.now = realNow; }
    };
    // Phaser 4 does not guarantee the sceneUpdate hook swap fires, so drive
    // the continuous render with a real-RAF loop for wall-clock motion.
    const loop = () => { scene.sys.sceneUpdate(); window.requestAnimationFrame(loop); };
    loop();
    scene.update();`,
    );
    // Idle 0.8s → run 1.5s → carry 1.5s → windup/slap via a cooldown jump.
    // Each stage is probed through artFeedback so the clip provably contains
    // the run/carry/slap motion it records. Teammates are hidden (dead branch)
    // so the clip shows one healer actor plus one Giant for accessory reads.
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      for (const u of cur.units) {
        if (u.id !== 0 && u.id !== 2) u.deadUntilTick = cur.tick + 100000;
      }
    });
    const probe = () =>
      page.evaluate(() => {
        const s = window.__talad.artFeedback().sprites;
        const body = s.find((sp) => sp.name === 'unit-0');
        const crate = s.find((sp) => sp.name === 'crate-902');
        return {
          anim: body?.anim ?? '',
          playing: body?.playing ?? false,
          frame: body?.frame ?? -1,
          x: body?.x ?? -1,
          y: body?.y ?? -1,
          crateY: crate?.y ?? -1,
        };
      });
    await page.waitForTimeout(800);
    const idle = await probe();
    expect(idle.anim).toBe('fruit_mangosteen:idle');
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      // prev must capture the PRE-move position so the interp sees speed.
      window.__r2Frames.prev = structuredClone(cur);
      cur.units[0]!.pos = { x: cur.units[0]!.pos.x + 3, y: cur.units[0]!.pos.y };
      cur.units[0]!.facing = { x: 1, y: 0 };
    });
    await page.waitForTimeout(1500);
    const run = await probe();
    expect(run.anim).toBe('fruit_mangosteen:run');
    expect(run.playing).toBe(true);
    expect(run.x - idle.x).toBeGreaterThan(60);
    await page.evaluate(() => {
      const cur = window.__r2Frames.cur;
      window.__r2Frames.prev = structuredClone(cur);
      cur.units[0]!.carrying = 902;
      cur.crates = [
        { id: 902, kind: 'normal', state: 'carried', pos: cur.units[0]!.pos, landTick: 0 },
      ];
    });
    await page.waitForTimeout(1500);
    const carry = await probe();
    // Carry while stationary is a still pose: frame carry0, no anim playing.
    expect(carry.frame).toBe(10);
    expect(carry.playing).toBe(false);
    expect(carry.crateY).toBeGreaterThan(0);
    expect(carry.y - carry.crateY).toBeGreaterThan(40);
    // Stage and capture in ONE browser task: a protocol round trip can miss
    // the entire 220ms attack window. Hold the renderer-only clock during the
    // recorded pose, without modifying production timing or global RAF.
    const attack = await inMatch(
      page,
      `const cur = window.__r2Frames.cur;
       const prev = structuredClone(cur);
       prev.units[0].attackCooldownTicks = 0;
       cur.units[0].attackCooldownTicks = 30;
       cur.tick++;
       window.__r2Frames.prev = prev;
       scene.__r2ClipNow = scene.time.now;
       scene.update();
       const windup = window.__talad.artFeedback().sprites.find(s => s.name === 'unit-0').frame;
       scene.__r2ClipNow += 165;
       scene.update();
       const slap = window.__talad.artFeedback().sprites.find(s => s.name === 'unit-0').frame;
       return { windup, slap };`,
    );
    expect(attack.windup).toBe(14);
    expect(attack.slap).toBe(15);
    expect([14, 15].includes(attack.slap) ? 'slap-window' : `frame-${attack.slap}`).toBe(
      'slap-window',
    );
    await page.waitForTimeout(550);
    await inMatch(page, 'delete scene.__r2ClipNow; scene.update();');
    const sprites = await page.evaluate(() => window.__talad.artFeedback().sprites);
    const head = sprites.find((s) => s.name === 'unit-0-head');
    expect(head, 'healer head rendered through the clip').toBeDefined();
  });
});
