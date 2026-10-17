import { expect, test, type Page } from '@playwright/test';
import { enterMatch, controlledHookUnit, getState, joyDriver } from './helpers';
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
async function stageAdjacentEnemy(page: Page, near: HookUnit): Promise<HookUnit> {
  const st = await getState(page);
  const enemy = st.units.find((u) => u.team === 'dessert' && u.deadUntilTick === null);
  expect(enemy).toBeDefined();
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
  const before = await getState(page);
  const from = controlledHookUnit(before)!;
  expect(from.id).toBe(0);
  await page.keyboard.press('KeyR');
  await expect.poll(async () => controlledHookUnit(await getState(page))?.id).not.toBe(from.id);
  const after = await getState(page);
  expect(after.units.find((u) => u.id === from.id)?.isBot).toBe(true);
  // Exactly one controlled body exists after the handoff.
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
  expect(controlledHookUnit(after)!.isBot).toBe(false);
});

test('the สลับตัว button hands off the same way', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  const from = controlledHookUnit(await getState(page))!;
  await switchButton(page).click();
  await expect.poll(async () => controlledHookUnit(await getState(page))?.id).not.toBe(from.id);
  const after = await getState(page);
  expect(after.units.find((u) => u.id === from.id)?.isBot).toBe(true);
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
});

test('loadout and the white ring bind to the new body, not the released one', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
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
  await expect
    .poll(async () => (await getState(page)).units.find((u) => u.id === 0)?.bombs)
    .toBeGreaterThan(0);
  expect(await loadoutLabel(page)).toContain('ระเบิด');
  const ringOn0 = await ringPos(page);
  // Switch: unit 1 is empty-handed and elsewhere — loadout and ring follow it.
  await page.keyboard.press('KeyR');
  await expect.poll(async () => controlledHookUnit(await getState(page))?.id).toBe(1);
  expect(await loadoutLabel(page)).not.toContain('ระเบิด');
  const st = await getState(page);
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
  await page.evaluate(() => {
    window.__talad.setCommand('fruit', 'attack');
    for (const id of [1, 2]) {
      const u = window.__talad.state().units.find((x) => x.id === id);
      if (u && u.deadUntilTick === null) window.__talad.placeUnit(id, 31 + id, 9 + id);
    }
  });
  const st = await getState(page);
  const me = controlledHookUnit(st)!;
  await stageAdjacentEnemy(page, me);
  // Hold fire + hold D: the body attacks and walks.
  const canvas = page.locator('canvas');
  const cbox = await canvas.boundingBox();
  const k = cbox!.width / 1280;
  await page.mouse.move((40 + me.pos.x * 30) * k, me.pos.y * 30 * k);
  await page.mouse.down();
  await page.keyboard.down('KeyD');
  const mePos0 = controlledHookUnit(await getState(page))!.pos;
  await page.waitForTimeout(500);
  const walked = controlledHookUnit(await getState(page))!.pos;
  expect(Math.hypot(walked.x - mePos0.x, walked.y - mePos0.y)).toBeGreaterThan(0.5);
  // Handoff while everything is still held.
  await page.keyboard.press('KeyR');
  await expect.poll(async () => controlledHookUnit(await getState(page))?.id).toBe(1);
  const newBody = controlledHookUnit(await getState(page))!;
  const at0 = await page.evaluate(() => window.__talad.unitFeedback(1).attackAt);
  await page.waitForTimeout(600); // D and the mouse are STILL physically held
  const after = await getState(page);
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
  await page.waitForTimeout(400);
  const moved = controlledHookUnit(await getState(page))!.pos;
  expect(Math.hypot(moved.x - newBody.pos.x, moved.y - newBody.pos.y)).toBeGreaterThan(0.3);
  await page.keyboard.up('KeyD');
  const enemy2 = await stageAdjacentEnemy(page, controlledHookUnit(await getState(page))!);
  void enemy2;
  const fresh = controlledHookUnit(await getState(page))!;
  await page.mouse.move((40 + fresh.pos.x * 30) * k, fresh.pos.y * 30 * k);
  await page.mouse.up();
  await page.mouse.down();
  await expect
    .poll(async () => page.evaluate(() => window.__talad.unitFeedback(1).attackAt), {
      timeout: 3_000,
    })
    .toBeGreaterThan(at0);
  await page.mouse.up();
});

test('held joystick does not leak into the new body (touch)', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-landscape', 'touch joystick variant');
  const cdp = await page.context().newCDPSession(page);
  const driver = await joyDriver(page, cdp);
  await page.goto('/?seed=1');
  await enterMatch(page);
  const mePos0 = controlledHookUnit(await getState(page))!.pos;
  await driver.steer(1, 0); // hold the joystick right
  await page.waitForTimeout(500);
  const walked = controlledHookUnit(await getState(page))!.pos;
  expect(Math.hypot(walked.x - mePos0.x, walked.y - mePos0.y)).toBeGreaterThan(0.5);
  // Tap สลับตัว with the joystick still held. Playwright's tap synthesises a
  // real trusted tap (touch → click activation); a raw CDP touchStart/touchEnd
  // pair does not produce a click on this page (the app's touch handlers
  // cancel default activation), so the switch would never queue.
  await page.tap('#tw-btn-switch');
  await expect.poll(async () => controlledHookUnit(await getState(page))?.id).toBe(1);
  const newBody = controlledHookUnit(await getState(page))!;
  await page.waitForTimeout(600); // joystick still held by pointer 1
  const after = controlledHookUnit(await getState(page))!;
  expect(after.id).toBe(1);
  expect(Math.hypot(after.pos.x - newBody.pos.x, after.pos.y - newBody.pos.y)).toBeLessThan(0.2);
  // Release, then a fresh steer moves the new body.
  await driver.release();
  await driver.steer(0, 1);
  await page.waitForTimeout(400);
  const moved = controlledHookUnit(await getState(page))!.pos;
  expect(Math.hypot(moved.x - newBody.pos.x, moved.y - newBody.pos.y)).toBeGreaterThan(0.3);
  await driver.release();
});

test('a dead controlled source switches through the R key', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
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
  await expect
    .poll(
      async () => {
        const s = await getState(page);
        return s.units.find((u) => u.id === dead.id)?.isBot;
      },
      { timeout: 3_000 },
    )
    .toBe(true);
  const after = await getState(page);
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
  expect(controlledHookUnit(after)!.deadUntilTick).toBeNull();
});

test('a dead controlled source switches through the button too', async ({ page }) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
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
  await expect
    .poll(async () => (await getState(page)).units.find((u) => u.id === dead.id)?.isBot, {
      timeout: 3_000,
    })
    .toBe(true);
  const after = await getState(page);
  expect(after.units.filter((u) => !u.isBot)).toHaveLength(1);
  expect(controlledHookUnit(after)!.deadUntilTick).toBeNull();
});

test('no living teammate: switch visible but disabled with the Thai description', async ({
  page,
}) => {
  await page.goto('/?seed=1');
  await enterMatch(page);
  // Deterministic staging: re-place both fruit teammates on dessert guard
  // posts every 15-tick chunk so SLAP_RANGE adjacency is sustained and both
  // die in the same combat window. A guard bot walks home after a single
  // teleport of a teammate (measured), so the re-place loop is what makes
  // the staging stick. RESPAWN_TICKS=100 bounds the "no living teammate"
  // window; the probe below runs immediately inside it.
  let staged: HookState | null = null;
  for (let i = 0; i < 120 && staged === null; i++) {
    await page.evaluate(() => {
      const s = window.__talad.state();
      window.__talad.setCommand('fruit', 'guard');
      window.__talad.setCommand('dessert', 'guard');
      // Pool-based posts: patrol and mutual combat can kill or move a fixed
      // bot, so each victim re-docks on a LIVING dessert bot every chunk.
      const bots = s.units.filter((u) => u.team === 'dessert' && u.deadUntilTick === null);
      for (let id = 1; id <= 2; id++) {
        const u = s.units.find((x) => x.id === id);
        const bot = bots.length > 0 ? bots[(id - 1) % bots.length] : undefined;
        if (!u || !bot || u.deadUntilTick !== null) continue;
        window.__talad.placeUnit(id, bot.pos.x, bot.pos.y);
      }
    });
    await page.evaluate(() => window.__talad.fastForward(10));
    const s = await getState(page);
    if (
      s.winner !== null ||
      !s.units.some((u) => u.team === 'fruit' && u.id !== 0 && u.deadUntilTick === null)
    ) {
      staged = s;
    }
  }
  expect(staged, 'both fruit teammates died in the staged combat').not.toBeNull();
  expect(staged!.winner).toBeNull();
  // One atomic read: the state window (every teammate dead) and the button.
  const probe = await page.evaluate(() => {
    const st = window.__talad.state();
    const btn = document.querySelector<HTMLButtonElement>('#tw-btn-switch');
    const desc = document.getElementById('tw-switch-desc');
    return {
      aliveFruit: st.units.filter((u) => u.team === 'fruit' && u.deadUntilTick === null).length,
      controlledId: st.units.find((u) => !u.isBot)?.id ?? null,
      winner: st.winner,
      hidden: btn?.hidden ?? null,
      disabled: btn?.disabled ?? null,
      describedBy: btn?.getAttribute('aria-describedby') ?? null,
      descText: desc?.textContent ?? null,
    };
  });
  expect(probe.winner).toBeNull();
  expect(probe.aliveFruit).toBe(1); // only the controlled body is alive
  expect(probe.controlledId).toBe(0);
  expect(probe.hidden).toBe(false);
  expect(probe.disabled).toBe(true);
  expect(probe.describedBy).toBe('tw-switch-desc');
  expect(probe.descText).toBe('ไม่มีลูกทีมที่สลับได้');
  // A click on the disabled button queues nothing: control stays.
  await switchButton(page)
    .click({ force: true })
    .catch(() => {});
  await page.waitForTimeout(400);
  const st = await getState(page);
  expect(controlledHookUnit(st)?.id).toBe(0);
  expect(st.units.find((u) => u.id === 0)?.isBot).toBe(false);
});

test('journey: recruit a super class, switch to it, use its ability, die, respawn with class and quality intact', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/?seed=7');
  await enterMatch(page);
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
  await expect(page.locator('#tw-class-pick .tw-class-status')).toBeVisible();
  await page.evaluate(() => window.__talad.fastForward(22));
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
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(250);
  }
  controlled = controlledHookUnit(await getState(page)) ?? undefined;
  expect(controlled?.classId).toBe('boxer');
  const boxerId = controlled!.id;
  // Ability: the boxer's slap. An adjacent enemy + a real fire press.
  const enemy = await stageAdjacentEnemy(page, controlled!);
  const canvas = page.locator('canvas');
  const cbox = await canvas.boundingBox();
  const k = cbox!.width / 1280;
  await page.mouse.move((40 + controlled!.pos.x * 30) * k, controlled!.pos.y * 30 * k);
  const enemyHp0 = enemy.hp;
  await page.mouse.down();
  await expect
    .poll(async () => page.evaluate(() => window.__talad.unitFeedback(0).attackAt), {
      timeout: 3_000,
    })
    .toBeGreaterThanOrEqual(0);
  await page.mouse.up();
  expect(enemy.hp).toBeLessThanOrEqual(enemyHp0);
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
