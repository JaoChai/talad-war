import { expect, test, type Page } from '@playwright/test';
import type { MatchState } from '@talad/sim';
import type { TaladTestHooks } from '../src/testHooks';
import { waitHooks } from './helpers';

type Frames = { prev: MatchState; cur: MatchState };
declare global {
  interface Window {
    __r2Control: Frames;
  }
}

interface Manifest {
  classArt: {
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

// Same renderer-only CDP fixture as r1Art/r2Art: replace only the scene's sim
// update; the Phaser clock, animations, tweens and render loop stay live.
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

type Sprite = Awaited<ReturnType<typeof sprites>>[number];

async function sprites(page: Page) {
  return page.evaluate(() => window.__talad.artFeedback().sprites);
}

function find(list: Sprite[], name: string): Sprite {
  const sprite = list.find((s) => s.name === name);
  expect(sprite, name).toBeDefined();
  return sprite!;
}

/** Exactly one visible ring image and one visible arrow image (art path). */
function expectOnePair(list: Sprite[]) {
  // artFeedback lists Sprite/Image children only; the primitive fallback
  // shapes are asserted through scene.children in the fallback test below.
  for (const part of ['ring', 'arrow'] as const) {
    const objects = list.filter((s) => s.name === `control-${part}`);
    expect(objects.length, `one control-${part} object`).toBe(1);
    expect(objects[0]!.visible, `control-${part} visible`).toBe(true);
  }
}

/** Render one interpolated frame of the staged state through the live scene. */
async function renderOnce(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { prev, cur } = window.__r2Control;
    window.__talad.renderSnapshot(prev, cur, 1);
  });
}

/**
 * Stage a paused, deterministic match: cleared pads, the 4th fruit buddy
 * (id 6) on the field with a super cargo and bombs, and unit 0 still in
 * control by default. The flip test splices id 1 out so the controlled body
 * holds a sparse numeric ID at a shifted array index.
 */
async function stageMatch(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto('/?seed=43');
  // The right port is not proof of the right project (§6; talad-war and
  // dice-bandits share 4173): assert the title before anything else.
  await expect(page).toHaveTitle('Talad War');
  await waitHooks(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
  await page.evaluate(() => {
    const talad = window.__talad as unknown as TaladTestHooks;
    const cur = talad.state();
    cur.tick += 10000;
    cur.events = [];
    cur.projectiles = [];
    for (const team of ['fruit', 'dessert'] as const)
      cur.pads[team].cells = [
        [null, null],
        [null, null],
        [null, null],
        [null, null],
      ];
    cur.units[0]!.classId = undefined;
    cur.units.push({
      id: 6,
      team: 'fruit',
      pos: { x: 20, y: 12 },
      facing: { x: 1, y: 0 },
      isBot: true,
      hp: 100,
      deadUntilTick: null,
      carrying: 902,
      gun: null,
      bombs: 2,
      bombsSuper: false,
      attackCooldownTicks: 0,
      classId: undefined,
    } as (typeof cur.units)[number]);
    cur.crates = [
      { id: 902, kind: 'super', state: 'carried', pos: cur.units[6]!.pos, landTick: 0 },
    ];
    window.__r2Control = { prev: structuredClone(cur), cur };
  });
  // Continuously render the staged frames through the real scene update hook
  // so every later mutation is picked up by the normal sync pipeline. The
  // clock is paused, so scene.time.now is pinned to a bob-zero instant and
  // geometry assertions are exact.
  await inMatch(
    page,
    `scene.sys.sceneUpdate = scene.update = () => {
    scene.time.now = 0;
    const {prev, cur} = window.__r2Control;
    window.__talad.renderSnapshot(prev, cur, 1);
  }; scene.update();`,
  );
  await renderOnce(page);
}

/** Hand control to the sparse-ID class-bearing body (id 6, index shifts). */
async function flipToGiant(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cur = window.__r2Control.cur;
    cur.units.splice(1, 1); // sparse numeric IDs: id 6 now sits at array index 4
    const me = cur.units.find((u) => u.id === 6)!;
    const released = cur.units.find((u) => u.id === 0)!;
    released.isBot = true;
    me.isBot = false;
    me.classId = 'giant';
    window.__r2Control.prev = structuredClone(cur);
  });
  await renderOnce(page);
}

/** Union top of unit 6's drawn parts (body, head, badge, carried crate). */
function unionTop(ss: Sprite[]): number {
  const parts = ['unit-6', 'unit-6-head', 'unit-6-badge', 'crate-902'];
  return Math.min(
    ...parts
      .map((name) => find(ss, name))
      .filter((s) => s.visible)
      .map((s) => s.y - s.height * (1 - s.originY)),
  );
}

test.use({ video: 'on' });

test.describe('R2 control marker', () => {
  test.beforeEach(async ({ page }) => {
    await stageMatch(page);
  });

  test('one white ring/arrow pair hands off from unit 0 to the sparse giant body', async ({
    page,
  }) => {
    const m = await manifest(page);
    // Default control: the pair marks unit 0 at 1.0x.
    let ss = await sprites(page);
    expectOnePair(ss);
    const ring0 = find(ss, 'control-ring');
    const arrow0 = find(ss, 'control-arrow');
    const body0 = find(ss, 'unit-0');
    expect(ring0.texture).toBe(m.classArt.control.ring);
    expect(arrow0.texture).toBe(m.classArt.control.arrow);
    expect(ring0.width).toBeCloseTo(52, 4);
    expect(ring0.height).toBeCloseTo(26, 4);
    expect(ring0.x).toBeCloseTo(body0.x, 4);
    expect(ring0.y).toBeCloseTo(body0.y - 2, 4); // drawn feet
    // Panel still shows the controlled body's BOTH primary/cargo and bombs.
    await expect(page.locator('.tw-loadout .tw-item-primary')).toHaveText(/มือเปล่า/);

    await flipToGiant(page);
    ss = await sprites(page);
    expectOnePair(ss); // still exactly one pair — never a second marker
    const ring = find(ss, 'control-ring');
    const arrow = find(ss, 'control-arrow');
    const body = find(ss, 'unit-6');
    expect(ring.texture).toBe(m.classArt.control.ring);
    expect(ring.width).toBeCloseTo(52 * 1.2, 4); // §5: Giant ring reads 1.20x
    expect(ring.height).toBeCloseTo(26 * 1.2, 4);
    expect(ring.x).toBeCloseTo(body.x, 4);
    expect(ring.y).toBeCloseTo(body.y - 2, 4); // drawn feet
    expect(arrow.width).toBeCloseTo(20, 4);
    expect(arrow.height).toBeCloseTo(20, 4);
    expect(arrow.originY).toBeCloseTo(1, 4);
    expect(arrow.x).toBeCloseTo(body.x, 4);
    expect(arrow.y).toBeCloseTo(unionTop(ss) - 4, 3); // 4 px over badge/crate union
    const releasedBody = find(ss, 'unit-0'); // the released bot is no longer marked
    expect(ring.x).not.toBeCloseTo(releasedBody.x, 1);
  });

  test('the panel follows the switch with independent cargo and bomb slots', async ({ page }) => {
    await flipToGiant(page);
    const panel = page.locator('.tw-loadout');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.tw-item-primary')).toHaveText('ลัง พิเศษ');
    await expect(panel.locator('.tw-item-bombs')).toHaveText('ระเบิด ×2');
    expect(await panel.getAttribute('aria-label')).toBe('ลัง พิเศษ · ระเบิด ×2');
  });

  test('no marker on a dead controlled body or in an all-bot state', async ({ page }) => {
    await flipToGiant(page);
    let ss = await sprites(page);
    expectOnePair(ss);
    await page.evaluate(() => {
      const cur = window.__r2Control.cur;
      const me = cur.units.find((u) => u.id === 6)!;
      me.deadUntilTick = cur.tick + 500;
      window.__r2Control.prev = structuredClone(cur);
    });
    await renderOnce(page);
    ss = await sprites(page);
    expect(find(ss, 'control-ring').visible).toBe(false);
    expect(find(ss, 'control-arrow').visible).toBe(false);

    // All-bot: no controlled body anywhere, no marker, no panel.
    await page.evaluate(() => {
      const cur = window.__r2Control.cur;
      cur.units.find((u) => u.id === 6)!.deadUntilTick = null;
      for (const u of cur.units) u.isBot = true;
      window.__r2Control.prev = structuredClone(cur);
    });
    await renderOnce(page);
    ss = await sprites(page);
    expect(find(ss, 'control-ring').visible).toBe(false);
    expect(find(ss, 'control-arrow').visible).toBe(false);
    await expect(page.locator('.tw-loadout')).toBeHidden();
  });

  test('upper edge: arrow stays on-canvas above the carried-cargo union at y=0.45', async ({
    page,
  }) => {
    await flipToGiant(page);
    await page.evaluate(() => {
      const cur = window.__r2Control.cur;
      const me = cur.units.find((u) => u.id === 6)!;
      me.pos = { x: 20, y: 0.45 };
      cur.crates[0]!.pos = me.pos;
      window.__r2Control.prev = structuredClone(cur);
    });
    await renderOnce(page);
    const ss = await sprites(page);
    const arrow = find(ss, 'control-arrow');
    const top = unionTop(ss);
    expect(top).toBeGreaterThanOrEqual(26 - 1e-6); // §4.3 clamp still holds
    expect(arrow.y).toBeCloseTo(top - 4, 3);
    expect(arrow.y - arrow.height).toBeGreaterThanOrEqual(-1e-6); // fully on-canvas
    expect(find(ss, 'control-ring').visible).toBe(true);
  });

  test('primitive fallback takes over with identical geometry when art is missing', async ({
    page,
  }) => {
    await flipToGiant(page);
    const m = await manifest(page);
    const before = await sprites(page);
    const artRing = find(before, 'control-ring');
    const artArrow = find(before, 'control-arrow');
    // Remove the control textures under CDP: the marker must fall back to its
    // white primitives without moving, resizing or duplicating. artFeedback
    // cannot run afterwards (displayWidth of the dead-texture image throws),
    // so the four objects are read through scene.children directly.
    await inMatch(
      page,
      `scene.textures.remove('${m.classArt.control.ring}'); scene.textures.remove('${m.classArt.control.arrow}');`,
    );
    await renderOnce(page);
    const read = (await inMatch(
      page,
      `const g = (n) => { const o = scene.children.getByName(n);
        if (!o) return null;
        return { visible: o.visible, x: o.x, y: o.y, w: o.width * (o.scaleX ?? 1), h: o.height * (o.scaleY ?? 1) }; };
      return { imgRing: g('control-ring'), imgArrow: g('control-arrow'),
               fbRing: g('control-ring-fallback'), fbArrow: g('control-arrow-fallback') };`,
    )) as {
      imgRing: { visible: boolean; x: number; y: number; w: number; h: number } | null;
      imgArrow: { visible: boolean; x: number; y: number; w: number; h: number } | null;
      fbRing: { visible: boolean; x: number; y: number; w: number; h: number } | null;
      fbArrow: { visible: boolean; x: number; y: number; w: number; h: number } | null;
    };
    expect(read.imgRing, 'ring image kept').not.toBeNull();
    expect(read.imgArrow, 'arrow image kept').not.toBeNull();
    expect(read.fbRing, 'ring fallback kept').not.toBeNull();
    expect(read.fbArrow, 'arrow fallback kept').not.toBeNull();
    expect(read.imgRing!.visible).toBe(false);
    expect(read.imgArrow!.visible).toBe(false);
    expect(read.fbRing!.visible).toBe(true);
    expect(read.fbArrow!.visible).toBe(true);
    // Identical geometry, never a second pair.
    expect(read.fbRing!.w).toBeCloseTo(artRing.width, 4);
    expect(read.fbRing!.h).toBeCloseTo(artRing.height, 4);
    expect(read.fbRing!.x).toBeCloseTo(artRing.x, 4);
    expect(read.fbRing!.y).toBeCloseTo(artRing.y, 4);
    expect(read.fbArrow!.w).toBeCloseTo(artArrow.width, 4);
    expect(read.fbArrow!.x).toBeCloseTo(artArrow.x, 4);
  });

  test('reduced motion keeps the arrow still; motion moves only the arrow bob', async ({
    page,
  }) => {
    // Deterministic phases on the paused clock: sin(now/250) is 0 at 0 ms and
    // ~1 at 393 ms, so the bob delta is exact — no RAF timing involved.
    const setPhase = (ms: number) => inMatch(page, `scene.time.now = ${ms};`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await setPhase(0);
    await renderOnce(page);
    const still = find(await sprites(page), 'control-arrow').y;
    await setPhase(393);
    await renderOnce(page);
    const raised = find(await sprites(page), 'control-arrow').y;
    expect(Math.abs(raised - still), 'arrow bobs under motion').toBeGreaterThan(2.5);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setPhase(0);
    await renderOnce(page);
    const a = find(await sprites(page), 'control-arrow').y;
    await setPhase(393);
    await renderOnce(page);
    const b = find(await sprites(page), 'control-arrow').y;
    expect(a).toBeCloseTo(b, 4); // stable reduced-motion position
  });
});

// Real-RAF clip of the marker handoff for media-check (§6).
test.describe('R2 control marker clip', () => {
  test('records the ring/arrow handoff between two bodies', async ({ page }) => {
    await page.goto('/?seed=43');
    await expect(page).toHaveTitle('Talad War'); // §6: right port ≠ right project.
    await waitHooks(page);
    await page.evaluate(() => {
      const talad = window.__talad as unknown as TaladTestHooks;
      const cur = talad.state();
      cur.tick += 10000;
      cur.events = [];
      cur.projectiles = [];
      for (const team of ['fruit', 'dessert'] as const)
        cur.pads[team].cells = [
          [null, null],
          [null, null],
          [null, null],
          [null, null],
        ];
      cur.units.push({
        id: 6,
        team: 'fruit',
        pos: { x: 20, y: 12 },
        facing: { x: 1, y: 0 },
        isBot: true,
        hp: 100,
        deadUntilTick: null,
        carrying: null,
        gun: null,
        bombs: 0,
        attackCooldownTicks: 0,
        classId: undefined,
      } as (typeof cur.units)[number]);
      // Only the two bodies in the shot; the marker handoff must read clearly.
      for (const u of cur.units) {
        if (u.id !== 0 && u.id !== 6) u.deadUntilTick = cur.tick + 100000;
      }
      window.__r2Control = { prev: structuredClone(cur), cur };
    });
    await inMatch(
      page,
      `scene.sys.sceneUpdate = scene.update = () => {
      const {prev, cur} = window.__r2Control;
      window.__talad.renderSnapshot(prev, cur, 1);
    };
    const loop = () => { scene.sys.sceneUpdate(); window.requestAnimationFrame(loop); };
    loop();
    scene.update();`,
    );
    await page.waitForTimeout(900);
    const before = find(await sprites(page), 'control-ring');
    await page.evaluate(() => {
      const cur = window.__r2Control.cur;
      const me = cur.units.find((u) => u.id === 6)!;
      cur.units.find((u) => u.id === 0)!.isBot = true;
      me.isBot = false;
      me.classId = 'giant';
      window.__r2Control.prev = structuredClone(cur);
    });
    await expect
      .poll(async () => {
        const ring = find(await sprites(page), 'control-ring');
        const body = find(await sprites(page), 'unit-6');
        return Math.abs(ring.x - body.x) < 1 ? 'marked' : 'not-yet';
      })
      .toBe('marked');
    expect(before.visible).toBe(true);
    await page.waitForTimeout(1100);
  });
});
