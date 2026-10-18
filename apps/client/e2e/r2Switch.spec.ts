import { expect, test, type Page } from '@playwright/test';
import {
  enterMatch,
  controlledHookUnit,
  getState,
  joyDriver,
  finishOpening,
  stepRealInputs,
  holdSceneTicks,
} from './helpers';
import type { HookState, HookUnit } from './helpers';

/**
 * R2-11 switch through REAL production input (plan §5): the R key, the
 * สลับตัว button, held-input non-transfer, dead sources and the staged
 * recruitment → switch → ability → death → respawn journey — all real sim.
 */

const switchButton = (page: Page) => page.getByRole('button', { name: /^สลับตัว/ });

/**
 * Fast-forward in real 60-tick chunks until `cond` holds on the live match
 * (real play between goto and staging shifts the tick, so fixed tick counts
 * cannot pin mid-match windows). Gives up on a match winner.
 */
async function stageUntil(
  page: Page,
  cond: (st: HookState) => boolean,
  maxChunks = 60,
): Promise<HookState> {
  for (let i = 0; i < maxChunks; i++) {
    const st = await getState(page);
    if (st.winner !== null || cond(st)) return st;
    await page.evaluate(() => window.__talad.fastForward(60));
  }
  return getState(page);
}

/** Stage a dessert enemy right next to a unit so a fire press can slap it. */
const dist2 = (p: { x: number; y: number }, q: { x: number; y: number }): number =>
  (p.x - q.x) ** 2 + (p.y - q.y) ** 2;

async function stageAdjacentEnemy(page: Page, near: HookUnit): Promise<HookUnit> {
  const st = await getState(page);
  // Nearest living dessert unit: the one with the least walking to do, so it
  // is still inside SLAP_RANGE when the strike lands.
  const enemy = st.units
    .filter((u) => u.team === 'dessert' && u.deadUntilTick === null)
    .sort((a, b) => dist2(a.pos, near.pos) - dist2(b.pos, near.pos))[0];
  expect(enemy, 'a living dessert unit to stage').toBeDefined();
  await page.evaluate(({ id, x, y }) => window.__talad.placeUnit(id, x, y), {
    id: enemy!.id,
    x: near.pos.x + 0.6,
    y: near.pos.y,
  });
  return enemy!;
}

/** White control-ring sprite position from artFeedback (art path). */
async function ringPos(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const ring = window.__talad
      .artFeedback()
      .sprites.find((s) => s.name === 'control-ring' && s.visible);
    if (!ring) throw new Error('visible control-ring sprite missing');
    return { x: ring.x, y: ring.y };
  });
}

async function loadoutLabel(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('.tw-loadout')?.getAttribute('aria-label') ?? '',
  );
}

test('R hands off control and the released body becomes a bot', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  const before = await getState(page);
  const from = controlledHookUnit(before)!;
  expect(from.id).toBe(0);
  await page.keyboard.press('KeyR');
  const after = await stepRealInputs(page, 1);
  expect(controlledHookUnit(after)?.id).not.toBe(from.id);
  expect(after.units.find((u) => u.id === from.id)?.isBot).toBe(true);
  // Exactly one controlled body exists after the handoff.
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
  expect(controlledHookUnit(after)!.isBot).toBe(false);
});

test('the สลับตัว button hands off the same way', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  const from = controlledHookUnit(await getState(page))!;
  await switchButton(page).click();
  const after = await stepRealInputs(page, 1);
  expect(controlledHookUnit(after)?.id).not.toBe(from.id);
  expect(after.units.find((u) => u.id === from.id)?.isBot).toBe(true);
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
});

test('loadout and the white ring bind to the new body, not the released one', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  // Give the controlled body a real loadout difference: recruit a bombs pair? No —
  // real bombs belong to the opener; stage a bomb wall and open it with E.
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'attack');
    for (const id of [1, 2]) {
      const u = window.__talad.state().units.find((x) => x.id === id);
      if (u && u.deadUntilTick === null) window.__talad.placeUnit(id, 31 + id, 9 + id);
    }
    window.__talad.setPadLayout('fruit', [
      { col: 0, layer: 0 },
      { col: 1, layer: 0 },
    ]);
    const st = window.__talad.state();
    const crate = st.crates.find((c) => c.id === st.pads.fruit!.cells[0]![0]);
    window.__talad.placeUnit(0, crate!.pos.x, crate!.pos.y);
  });
  await page.keyboard.press('KeyE'); // ordinary open on a bombs wall
  await finishOpening(page); // do not confuse slow live ticks with a rejected input
  expect((await getState(page)).units.find((u) => u.id === 0)?.bombs).toBeGreaterThan(0);
  expect(await loadoutLabel(page)).toContain('ระเบิด');
  const ringOn0 = await ringPos(page);
  // Switch: unit 1 is empty-handed and elsewhere — loadout and ring follow it.
  await page.keyboard.press('KeyR');
  const st = await stepRealInputs(page, 1);
  expect(controlledHookUnit(st)?.id).toBe(1);
  expect(await loadoutLabel(page)).not.toContain('ระเบิด');
  const unit1 = st.units.find((u) => u.id === 1)!;
  // Stage-space mapping: 720p strip, stage = (40 + 30x, 30y).
  const expected = { x: 40 + unit1.pos.x * 30, y: unit1.pos.y * 30 };
  const ringOn1 = await ringPos(page);
  expect(Math.hypot(ringOn1.x - expected.x, ringOn1.y - expected.y)).toBeLessThan(4);
  expect(Math.hypot(ringOn1.x - ringOn0.x, ringOn1.y - ringOn0.y)).toBeGreaterThan(10);
  expect(st.units.find((u) => u.id === 0)?.isBot).toBe(true);
});

test('held fire and WASD do not leak into the new body (desktop)', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-landscape', 'desktop keyboard/mouse variant');
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'attack');
    for (const id of [1, 2]) {
      const u = window.__talad.state().units.find((x) => x.id === id);
      if (u && u.deadUntilTick === null) window.__talad.placeUnit(id, 31 + id, 9 + id);
    }
  });
  const st = await getState(page);
  const me = controlledHookUnit(st)!;
  const enemy = await stageAdjacentEnemy(page, me);
  // Hold fire + hold D: the body attacks and walks.
  const canvas = page.locator('canvas');
  const cbox = await canvas.boundingBox();
  const k = cbox!.width / 1280;
  await page.mouse.move((40 + me.pos.x * 30) * k, me.pos.y * 30 * k);
  await page.mouse.down();
  await page.keyboard.down('KeyD');
  const mePos0 = controlledHookUnit(await getState(page))!.pos;
  const walked = controlledHookUnit(await stepRealInputs(page, 10, enemy.id))!.pos;
  expect(Math.hypot(walked.x - mePos0.x, walked.y - mePos0.y)).toBeGreaterThan(0.5);
  // Handoff while everything is still held.
  await page.keyboard.press('KeyR');
  const switched = await stepRealInputs(page, 1);
  expect(controlledHookUnit(switched)?.id).toBe(1);
  const newBody = controlledHookUnit(switched)!;
  const at0 = await page.evaluate(() => window.__talad.unitFeedback(1).attackAt);
  // D/mouse STILL physically held; twelve sampled ticks make the negative
  // check non-vacuous, with an enemy in range if a fire latch leaked.
  const after = await stepRealInputs(page, 12, enemy.id);
  expect(controlledHookUnit(after)!.id).toBe(1);
  expect(
    Math.hypot(
      controlledHookUnit(after)!.pos.x - newBody.pos.x,
      controlledHookUnit(after)!.pos.y - newBody.pos.y,
    ),
  ).toBeLessThan(0.2); // held WASD suppressed after the handoff
  expect(await page.evaluate(() => window.__talad.unitFeedback(1).attackAt)).toBe(at0);
  // Fresh cycle works: re-press moves, re-press fire attacks.
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyD');
  const moved = controlledHookUnit(await stepRealInputs(page, 8))!.pos;
  expect(Math.hypot(moved.x - newBody.pos.x, moved.y - newBody.pos.y)).toBeGreaterThan(0.3);
  await page.keyboard.up('KeyD');
  // The released bot may have walked under the right-hand HUD before we took
  // control. Stage the fresh-fire fixture in clear canvas space, not on a DOM
  // command button (which correctly swallows a mouse press).
  await page.evaluate(() => window.__talad.placeUnit(1, 14, 11));
  const enemy2 = await stageAdjacentEnemy(page, controlledHookUnit(await getState(page))!);
  const fresh = controlledHookUnit(await getState(page))!;
  const firePoint = {
    x: cbox!.x + (40 + fresh.pos.x * 30) * k,
    y: cbox!.y + fresh.pos.y * 30 * k,
  };
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, firePoint),
  ).toBe('CANVAS');
  await page.mouse.move(firePoint.x, firePoint.y);
  await page.mouse.up();
  await page.mouse.down();
  await stepRealInputs(page, 40, enemy2.id);
  expect(await page.evaluate(() => window.__talad.unitFeedback(1).attackAt)).toBeGreaterThan(at0);
  await page.mouse.up();
});

test('held joystick does not leak into the new body (touch)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch joystick variant');
  const cdp = await page.context().newCDPSession(page);
  const driver = await joyDriver(page, cdp);
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  const mePos0 = controlledHookUnit(await getState(page))!.pos;
  await driver.steer(1, 0); // hold the joystick right
  const walked = controlledHookUnit(await stepRealInputs(page, 10))!.pos;
  expect(Math.hypot(walked.x - mePos0.x, walked.y - mePos0.y)).toBeGreaterThan(0.5);
  // Tap สลับตัว with the joystick still held. Playwright's tap synthesises a
  // real trusted tap (touch → click activation); a raw CDP touchStart/touchEnd
  // pair does not produce a click on this page (the app's touch handlers
  // cancel default activation), so the switch would never queue.
  await page.tap('#tw-btn-switch');
  const switched = await stepRealInputs(page, 1);
  expect(controlledHookUnit(switched)?.id).toBe(1);
  const newBody = controlledHookUnit(switched)!;
  // Twelve real-input ticks, joystick still physically held by pointer 1.
  const after = controlledHookUnit(await stepRealInputs(page, 12))!;
  expect(after.id).toBe(1);
  expect(Math.hypot(after.pos.x - newBody.pos.x, after.pos.y - newBody.pos.y)).toBeLessThan(0.2);
  // Release, then a fresh steer moves the new body.
  await driver.release();
  await driver.steer(0, 1);
  const moved = controlledHookUnit(await stepRealInputs(page, 8))!.pos;
  expect(Math.hypot(moved.x - newBody.pos.x, moved.y - newBody.pos.y)).toBeGreaterThan(0.3);
  await driver.release();
});

test('a dead controlled source switches through the R key', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  const st = await stageUntil(page, (s) => {
    const c = controlledHookUnit(s);
    return (
      c !== null &&
      c.deadUntilTick !== null &&
      s.units.some((u) => u.team === 'fruit' && u.id !== c.id && u.deadUntilTick === null)
    );
  });
  expect(st.winner).toBeNull();
  const dead = controlledHookUnit(st)!;
  expect(dead.deadUntilTick).not.toBeNull();
  // A living teammate keeps the switch available for the dead source.
  await expect(switchButton(page)).toBeVisible();
  await expect(switchButton(page)).toBeEnabled();
  await page.keyboard.press('KeyR');
  const after = await stepRealInputs(page, 1);
  expect(after.units.find((u) => u.id === dead.id)?.isBot).toBe(true);
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
  expect(controlledHookUnit(after)!.deadUntilTick).toBeNull();
});

test('a dead controlled source switches through the button too', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  const st = await stageUntil(page, (s) => {
    const c = controlledHookUnit(s);
    return (
      c !== null &&
      c.deadUntilTick !== null &&
      s.units.some((u) => u.team === 'fruit' && u.id !== c.id && u.deadUntilTick === null)
    );
  });
  expect(st.winner).toBeNull();
  const dead = controlledHookUnit(st)!;
  expect(dead.deadUntilTick).not.toBeNull();
  await switchButton(page).click();
  const after = await stepRealInputs(page, 1);
  expect(after.units.find((u) => u.id === dead.id)?.isBot).toBe(true);
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
  expect(controlledHookUnit(after)!.deadUntilTick).toBeNull();
});

test('no living teammate: switch visible but disabled with the Thai description', async ({
  page,
}) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  // The live RAF must not tick between staging, the death check and the HUD
  // probe: on CI a teammate could respawn during a protocol round trip.
  const probe = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    window.__talad.setSeed(1);
    window.__talad.setCommand('fruit', 'guard');
    window.__talad.setCommand('dessert', 'guard');
    for (let attempt = 0; attempt < 120; attempt++) {
      const s = window.__talad.state();
      // Use living guard posts: a fixed guard can itself move or die.
      const bots = s.units.filter((u) => u.team === 'dessert' && u.deadUntilTick === null);
      for (let id = 1; id <= 2; id++) {
        const u = s.units.find((x) => x.id === id);
        const bot = bots.length > 0 ? bots[(id - 1) % bots.length] : undefined;
        if (!u || !bot || u.deadUntilTick !== null) continue;
        window.__talad.placeUnit(id, bot.pos.x, bot.pos.y);
      }
      window.__talad.fastForward(10);
      const st = window.__talad.state();
      if (st.units.some((u) => u.team === 'fruit' && u.isBot && u.deadUntilTick === null)) continue;
      // Both teammates really died through the sim. Check and probe in this
      // SAME browser task; no live tick can invalidate the no-target window.
      const btn = document.querySelector<HTMLButtonElement>('#tw-btn-switch');
      const desc = document.getElementById('tw-switch-desc');
      return {
        attempts: attempt + 1,
        tick: st.tick,
        aliveFruit: st.units.filter((u) => u.team === 'fruit' && u.deadUntilTick === null).length,
        controlledId: st.units.find((u) => !u.isBot)?.id ?? null,
        winner: st.winner,
        hidden: btn?.hidden ?? null,
        disabled: btn?.disabled ?? null,
        describedBy: btn?.getAttribute('aria-describedby') ?? null,
        descText: desc?.textContent ?? null,
      };
    }
    throw new Error('Both teammates must die within 1200 deterministic staging ticks');
  });
  expect(probe.attempts).toBeLessThanOrEqual(120);
  expect(probe.winner).toBeNull();
  expect(probe.aliveFruit).toBe(1); // only the controlled body is alive
  expect(probe.controlledId).toBe(0);
  expect(probe.hidden).toBe(false);
  expect(probe.disabled).toBe(true);
  expect(probe.describedBy).toBe('tw-switch-desc');
  expect(probe.descText).toBe('ไม่มีลูกทีมที่สลับได้');
  // Real pointer press without locator.click's disabled auto-wait/catch.
  const box = await switchButton(page).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  // Sample the disabled activation BEFORE resuming could drop the request.
  const st = await stepRealInputs(page, 1);
  expect(st.tick).toBeGreaterThan(probe.tick);
  expect(controlledHookUnit(st)?.id).toBe(0);
  expect(st.units.find((u) => u.id === 0)?.isBot).toBe(false);
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
  });
});

test('journey: recruit a super class, switch to it, use its ability, die, respawn with class and quality intact', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/?seed=7');
  await enterMatch(page);
  await holdSceneTicks(page); // fixture clock, before staging/activation
  // Stage the SUPER class wall (one star crate) with the body standing on it.
  // Fruit stays on its default commands: parking 'attack' made the fruit push
  // end the whole match before the boxer could die (measured in the first
  // GREEN run); only dessert is parked on attack, for the death phase.
  await page.evaluate(() => {
    for (const id of [1, 2]) {
      const u = window.__talad.state().units.find((x) => x.id === id);
      if (u && u.deadUntilTick === null) window.__talad.placeUnit(id, 31 + id, 9 + id);
    }
    window.__talad.setPadLayout('fruit', [
      { col: 0, layer: 0, kind: 'super' },
      { col: 0, layer: 1 },
      { col: 1, layer: 0 },
      { col: 1, layer: 1 },
    ]);
    const st = window.__talad.state();
    const crate = st.crates.find((c) => c.id === st.pads.fruit!.cells[0]![0]);
    window.__talad.placeUnit(0, crate!.pos.x, crate!.pos.y);
  });
  await expect(page.locator('#tw-class-pick')).toBeVisible();
  await page.getByRole('button', { name: /^นักมวย/ }).click();
  await stepRealInputs(page, 1);
  await expect(page.locator('#tw-class-pick .tw-class-status')).toBeVisible();
  await finishOpening(page);
  let st = await getState(page);
  expect(st.winner).toBeNull();
  expect(st.pads.fruit!.opening).toBeNull();
  const boxer = st.units.find((u) => u.classId === 'boxer');
  expect(boxer, 'super boxer spawned').toBeDefined();
  expect(boxer!.superBuddy).toBe(true);
  expect(boxer!.isBot).toBe(true); // spawns as a bot; the switch brings it under control
  // Cycle R until the boxer is the controlled body.
  let controlled: HookUnit | undefined;
  for (let i = 0; i < 6; i++) {
    controlled = controlledHookUnit(await getState(page)) ?? undefined;
    if (controlled?.classId === 'boxer') break;
    const fromId = controlled!.id;
    await page.keyboard.press('KeyR');
    const switched = await stepRealInputs(page, 1);
    expect(controlledHookUnit(switched)?.id).not.toBe(fromId);
  }
  controlled = controlledHookUnit(await getState(page)) ?? undefined;
  expect(controlled?.classId).toBe('boxer');
  const boxerId = controlled!.id;
  // Keep the real per-device fire press. Sample its production input merge
  // and re-dock/step atomically below: a 150ms wall wait can contain NO tick
  // on a starved runner, or let the enemy sprint out of range before a tick.
  const enemy = await stageAdjacentEnemy(page, controlled!);
  const enemyHp0 = (await getState(page)).units.find((u) => u.id === enemy.id)!.hp;
  const attackAt0 = await page.evaluate((id) => window.__talad.unitFeedback(id).attackAt, boxerId);
  const fireBtn = page.locator('#tw-btn-fire');
  const touchFire = (await fireBtn.count()) > 0;
  if (touchFire) {
    // `fire` is a level sampled at 20 Hz (no latch), so a short tap can fall
    // between reads and never fire (measured). Hold a real pointer press on
    // the button across several ticks — the button's pointerdown/up handlers
    // are the same ones a finger uses.
    const fbox = (await fireBtn.boundingBox())!;
    await page.mouse.move(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2);
    await page.mouse.down();
  } else {
    const cbox = await page.locator('canvas').boundingBox();
    const k = cbox!.width / 1280;
    await page.mouse.move(
      cbox!.x + (40 + (controlled!.pos.x + 0.6) * 30) * k,
      cbox!.y + controlled!.pos.y * 30 * k,
    );
    await page.mouse.down();
  }
  // Forty real-input ticks cover the existing slap cooldown without waiting
  // for renderer cadence. No synthetic fire:true or fabricated combat event.
  let struck: HookState;
  try {
    struck = await stepRealInputs(page, 40, enemy.id);
  } finally {
    await page.mouse.up();
  }
  expect(
    await page.evaluate((id) => window.__talad.unitFeedback(id).attackAt, boxerId),
  ).toBeGreaterThan(attackAt0);
  const struckEnemy = struck.units.find((u) => u.id === enemy.id);
  expect(struckEnemy, 'the enemy is present in the fresh post-step state').toBeDefined();
  expect(struckEnemy!.hp, 'enemy hp dropped below the pre-slap value').toBeLessThan(enemyHp0);
  // Death: park the CONTROLLED boxer on a dessert guard post. The post's bot
  // holds position (guard), so SLAP_RANGE adjacency is sustained and it slaps
  // the idle boxer down; the boxer never fights back and no team pushes a
  // stall, so the match cannot end while we wait. Parking dessert on attack
  // (the first attempt) walked every bot away from the boxer and nobody died
  // (measured). One placement sticks: a controlled body idles where placed.
  await page.evaluate(
    ({ id }) => {
      const s = window.__talad.state();
      window.__talad.setCommand('dessert', 'guard');
      const bot = s.units.find(
        (u) => u.team === 'dessert' && u.deadUntilTick === null && u.id !== 0,
      )!;
      window.__talad.placeUnit(id, bot.pos.x, bot.pos.y);
    },
    { id: boxerId },
  );
  let dead = false;
  for (let i = 0; i < 40 && !dead; i++) {
    // Re-place each chunk: the guard bot patrols its post (~±1.5 units,
    // measured), so a single placement drifts out of SLAP_RANGE after a few
    // slaps. The controlled boxer idles, so teleporting it back onto the
    // bot's current position keeps the slapping one-sided and sustained.
    await page.evaluate((pid) => {
      const s = window.__talad.state();
      const u = s.units.find((x) => x.id === pid);
      const bot = s.units.find(
        (x) => x.team === 'dessert' && x.deadUntilTick === null && x.id !== 0,
      );
      if (u && bot && u.deadUntilTick === null) {
        window.__talad.placeUnit(pid, bot.pos.x, bot.pos.y);
      }
    }, boxerId);
    await page.evaluate(() => window.__talad.fastForward(15));
    st = await getState(page);
    if (st.winner !== null) break;
    dead = st.units.find((u) => u.id === boxerId)!.deadUntilTick !== null;
  }
  expect(st.winner).toBeNull();
  expect(dead, 'the boxer died in real combat').toBe(true);
  const corpse = st.units.find((u) => u.id === boxerId)!;
  expect(corpse.classId).toBe('boxer'); // class survives death
  expect(corpse.superBuddy).toBe(true); // quality survives death
  expect(corpse.gun).toBeNull(); // slots cleared
  expect(corpse.bombs).toBe(0);
  expect(corpse.carrying).toBeNull();
  // Respawn: class and quality persist; control returns to the boxer body.
  await page.evaluate(() => window.__talad.fastForward(120));
  st = await getState(page);
  const reborn = st.units.find((u) => u.id === boxerId)!;
  expect(reborn.deadUntilTick).toBeNull();
  expect(reborn.classId).toBe('boxer');
  expect(reborn.superBuddy).toBe(true);
  expect(controlledHookUnit(st)?.id).toBe(boxerId);
});
