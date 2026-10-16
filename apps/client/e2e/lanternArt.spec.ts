import { expect, test } from '@playwright/test';
import type { TaladTestHooks } from '../src/testHooks';
import { waitHooks } from './helpers';

// Real Phaser observations: removing registration, restarting run each sync,
// classifying alpha>0 as movement, or stretching a prop breaks these tests.
test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/?seed=43');
  await waitHooks(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
});

test('all eight characters register seven manifest animations with exact ranges and rates', async ({
  page,
}) => {
  const manifest = await (await page.request.get('/art/manifest.json')).json();
  const animations = await page.evaluate(() => window.__talad.artFeedback().animations);
  const ranges = {
    idle: [0, 4, 6],
    run: [4, 6, 12],
    carry: [10, 4, 10],
    windup: [14, 1, 1],
    slap: [15, 1, 1],
    hurt: [16, 1, 1],
    ko: [17, 1, 1],
  };
  expect(Object.keys(manifest.characters)).toHaveLength(8);
  for (const skin of Object.keys(manifest.characters)) {
    for (const [name, [first, count, fps]] of Object.entries(ranges)) {
      const anim = animations.find((a) => a.key === `${skin}:${name}`);
      expect(anim, `${skin}:${name} must be registered`).toBeDefined();
      expect(anim!.frames).toEqual(Array.from({ length: count! }, (_, i) => first! + i));
      expect(manifest.characters[skin].anims[name]).toEqual([first, count]);
      expect(anim!.fps).toBe(fps);
      expect(anim!.repeat).toBe(count! > 1 ? -1 : 0);
    }
  }
});

test('still human breathes idle; moving human runs through frames over 500ms', async ({ page }) => {
  const unit = () =>
    page.evaluate(() => window.__talad.artFeedback().sprites.find((s) => s.name === 'unit-0')!);
  await page.clock.runFor(80);
  expect((await unit()).anim).toBe('fruit_mangosteen:idle');
  await page.evaluate(() => window.__talad.placeUnit(0, 12, 12));
  await page.keyboard.down('KeyD');
  // Input is consumed by the next 20Hz sim tick, not the keyboard event itself.
  // Let that boundary commit before measuring the full 500ms run cycle.
  await page.clock.runFor(100);
  const frames = new Set<number>();
  for (let i = 0; i < 10; i++) {
    await page.clock.runFor(50);
    const sprite = await unit();
    expect(sprite.anim).toBe('fruit_mangosteen:run');
    expect(sprite.playing).toBe(true);
    expect(sprite.timeScale).toBeCloseTo(1, 2);
    expect(sprite.frame).toBeGreaterThanOrEqual(4);
    expect(sprite.frame).toBeLessThan(10);
    frames.add(sprite.frame);
  }
  expect(frames.size).toBeGreaterThanOrEqual(4);
  await page.keyboard.up('KeyD');
  await page.clock.runFor(100);
  expect((await unit()).anim).toBe('fruit_mangosteen:idle');
});

test('moving carrier loops carry; still carrier holds carry0', async ({ page }) => {
  await page.evaluate(() => {
    const h = window.__talad;
    h.setCommand('fruit', 'guard');
    h.setCommand('dessert', 'guard');
    h.fastForward(100);
    const crate = h.state().crates.find((c) => c.state === 'ground')!;
    h.placeUnit(0, crate.pos.x, crate.pos.y);
  });
  await page.keyboard.press('KeyE');
  await page.clock.runFor(80);
  expect(await page.evaluate(() => window.__talad.state().units[0]!.carrying)).not.toBeNull();
  await page.keyboard.down('KeyD');
  await page.clock.runFor(200);
  const moving = await page.evaluate(() =>
    window.__talad.artFeedback().sprites.find((s) => s.name === 'unit-0')!,
  );
  expect(moving.anim).toBe('fruit_mangosteen:carry');
  expect(moving.playing).toBe(true);
  await page.keyboard.up('KeyD');
  await page.clock.runFor(100);
  const still = await page.evaluate(() =>
    window.__talad.artFeedback().sprites.find((s) => s.name === 'unit-0')!,
  );
  expect(still.frame).toBe(10);
  expect(still.playing).toBe(false);
});

for (const gun of [false, true]) {
  test(`${gun ? 'gun' : 'melee'} attack shows windup then slap within the 220ms pulse`, async ({
    page,
  }) => {
    const initial = await page.evaluate((armed) => {
      const h = window.__talad as unknown as TaladTestHooks;
      const prev = h.state();
      prev.units[0]!.attackCooldownTicks = 0;
      prev.units[0]!.gun = armed ? { ammoCooldownTicks: 0 } : null;
      const cur = structuredClone(prev);
      if (armed) cur.units[0]!.gun!.ammoCooldownTicks = 10;
      else cur.units[0]!.attackCooldownTicks = 10;
      h.renderSnapshot(prev, cur, 0.5);
      return h.artFeedback().sprites.find((s) => s.name === 'unit-0')!;
    }, gun);
    expect(initial.frame).toBe(14);
    await page.clock.runFor(96);
    const slap = await page.evaluate(() =>
      window.__talad.artFeedback().sprites.find((s) => s.name === 'unit-0')!,
    );
    expect(slap.frame).toBe(15);
    await page.clock.runFor(144);
    expect(
      (
        await page.evaluate(() =>
          window.__talad.artFeedback().sprites.find((s) => s.name === 'unit-0')!,
        )
      ).anim,
    ).toBe('fruit_mangosteen:idle');
  });
}

test('props preserve manifest ratios across stall states, pad, crates, shots, bomb and expanding explosion', async ({
  page,
}) => {
  const manifest = await (await page.request.get('/art/manifest.json')).json();
  const samples = await page.evaluate(() => {
    const h = window.__talad as unknown as TaladTestHooks;
    const cur = h.state();
    cur.tick += 1;
    cur.events = [{ kind: 'explosion', tick: cur.tick, pos: { x: 20, y: 12 } }];
    cur.crates = [
      { id: 900, pos: { x: 14, y: 12 }, state: 'ground', landTick: 0 },
      { id: 901, pos: { x: 16, y: 12 }, state: 'falling', landTick: cur.tick + 20 },
      { id: 902, pos: { x: 18, y: 12 }, state: 'onPad', landTick: 0 },
    ];
    cur.pads.fruit.cells[0]![1] = 902;
    cur.projectiles = [
      {
        id: 910,
        team: 'fruit',
        kind: 'bullet',
        pos: { x: 20, y: 12 },
        vel: { x: 18, y: 0 },
        ttlTicks: 20,
      },
      {
        id: 911,
        team: 'dessert',
        kind: 'bullet',
        pos: { x: 22, y: 12 },
        vel: { x: 18, y: 0 },
        ttlTicks: 20,
      },
      {
        id: 912,
        team: 'dessert',
        kind: 'bomb',
        pos: { x: 24, y: 12 },
        vel: { x: 1, y: 0 },
        ttlTicks: 20,
      },
    ];
    const samples = [];
    for (const hp of [10000, 1, 0]) {
      cur.stalls.fruit.hp = hp;
      cur.stalls.dessert.hp = hp;
      h.renderSnapshot(cur, cur, 0.5);
      samples.push(...h.artFeedback().sprites);
    }
    return samples;
  });
  const keys = [
    'stall_fruit_ok',
    'stall_fruit_damaged',
    'stall_fruit_destroyed',
    'stall_dessert_ok',
    'stall_dessert_damaged',
    'stall_dessert_destroyed',
    'pad_fruit',
    'pad_dessert',
    'crate',
    'crate_air',
    'crate_stack2',
    'shot_fruit',
    'shot_dessert',
    'bomb',
    'explosion',
  ];
  for (const key of keys) {
    const sprites = samples.filter((s) => s.texture === key);
    expect(sprites.length, `${key} rendered`).toBeGreaterThan(0);
    const ratio = manifest.props[key].width / manifest.props[key].height;
    for (const sprite of sprites)
      expect(Math.abs(sprite.width / sprite.height / ratio - 1), key).toBeLessThan(0.02);
  }
  const ground = samples.find((s) => s.texture === 'crate')!;
  expect(ground.width).toBeCloseTo(54, 0);
  await page.clock.runFor(160);
  for (const boom of await page.evaluate(() =>
    window.__talad.artFeedback().sprites.filter((s) => s.texture === 'explosion'),
  )) {
    expect(
      Math.abs(
        boom.width /
          boom.height /
          (manifest.props.explosion.width / manifest.props.explosion.height) -
          1,
      ),
    ).toBeLessThan(0.02);
  }
});

test('top-edge carrier and its overhead crate both remain inside the canvas', async ({ page }) => {
  const sprites = await page.evaluate(() => {
    const h = window.__talad as unknown as TaladTestHooks;
    const cur = h.state();
    cur.units[0]!.pos = { x: 12, y: 0.35 };
    cur.units[0]!.carrying = 999;
    cur.crates = [{ id: 999, pos: cur.units[0]!.pos, state: 'carried', landTick: 0 }];
    h.renderSnapshot(cur, cur, 0.5);
    return h.artFeedback().sprites.filter((s) => s.name === 'unit-0' || s.name === 'crate-999');
  });
  expect(sprites).toHaveLength(2);
  for (const sprite of sprites) {
    expect(sprite.y - sprite.height * sprite.originY, sprite.name).toBeGreaterThanOrEqual(0);
    expect(sprite.y + sprite.height * (1 - sprite.originY), sprite.name).toBeLessThanOrEqual(720);
  }
});

test('reduced motion uses still idle/run/carry frames rather than looping', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.resume();
  await page.reload();
  await waitHooks(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
  await page.clock.runFor(200);
  const still = await page.evaluate(() =>
    window.__talad.artFeedback().sprites.find((s) => s.name === 'unit-0')!,
  );
  expect(still.frame).toBe(0);
  expect(still.playing).toBe(false);
  await page.keyboard.down('KeyD');
  await page.clock.runFor(500);
  const moving = await page.evaluate(() =>
    window.__talad.artFeedback().sprites.find((s) => s.name === 'unit-0')!,
  );
  expect(moving.frame).toBe(4);
  expect(moving.playing).toBe(false);
});
