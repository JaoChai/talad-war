import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLASS_IDS, OPEN_TICKS, createMatch, padCellCenter, step, switchControl } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { R2Controls, classPickContext } from '../src/input/r2Controls';
import type { ClassPickContext } from '../src/input/r2Controls';
import { ClassPickHud } from '../src/hud/classPick';
import { SwitchHud } from '../src/hud/switch';
import { KeyboardInput } from '../src/input/keyboard';
import { TouchControls } from '../src/input/touch';

/**
 * R2-10: class-choice context/queues and the compact HUD components.
 * Everything runs on real createMatch state. Channel progress is computed
 * from sim ticks — no wall-clock timers exist in these components.
 */

/** Real pad records: a class wall is two fully occupied side-adjacent columns. */
function layoutClassWall(s: MatchState, cols: [number, number]): string {
  s.crates = s.crates.filter((c) => c.state !== 'onPad');
  s.pads.fruit.cells = Array.from({ length: 4 }, () => [null, null] as (number | null)[]);
  for (const col of cols) {
    for (const layer of [0, 1] as const) {
      const id = s.nextId++;
      s.pads.fruit.cells[col]![layer] = id;
      s.crates.push({
        id,
        pos: { x: 8.75, y: 18.75 },
        state: 'onPad',
        landTick: 0,
        kind: 'normal',
      });
    }
  }
  return JSON.stringify(s.pads.fruit.cells);
}

function standOnWall(s: MatchState): void {
  const on = padCellCenter(s.pads.fruit, 0);
  s.units[0]!.pos = { x: on.x, y: on.y };
}

function wallContext(s: MatchState): ClassPickContext {
  const ctx = classPickContext(s);
  if (ctx === null) throw new Error('fixture: controlled unit cannot open the class wall');
  return ctx;
}

/** Minimal pointer-ish event: behaviour only reads pointerId/clientX/clientY. */
function pointerEvent(
  type: string,
  init: { pointerId: number; clientX?: number; clientY?: number },
): Event {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, init);
  return event;
}

describe('R2 class/switch controls', () => {
  it('choice_context_and_stale_source_snapshot_are_one_shot', () => {
    const s = createMatch(1);
    // No wall, unit at its stall: no choices.
    expect(classPickContext(s)).toBeNull();
    const snapshot = layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const ctx = wallContext(s);
    expect(ctx.unitId).toBe(0);
    expect(ctx.snapshot).toBe(snapshot);

    // A queued pick is one-shot and carries the exact displayed context.
    const controls = new R2Controls();
    controls.queuePick(ctx, 'healer');
    expect(controls.read(s).classPick).toEqual({ classId: 'healer', snapshot });
    expect(controls.read(s).classPick).toBeUndefined();

    // Stale snapshot: the wall content changed after display. Consumed, no reissue.
    controls.queuePick(ctx, 'ninja');
    s.pads.fruit.cells[1]![1] = null;
    expect(controls.read(s).classPick).toBeUndefined();
    expect(controls.read(s).classPick).toBeUndefined();

    // Stale source: control moved to another body after display. Consumed, no reissue.
    const snapshot2 = layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const ctx2 = wallContext(s);
    expect(ctx2.snapshot).toBe(snapshot2);
    controls.queuePick(ctx2, 'giant');
    expect(switchControl(s, 0)).not.toBeNull();
    expect(controls.read(s).classPick).toBeUndefined();
    expect(controls.read(s).classPick).toBeUndefined();

    // The context only ever tracks the CONTROLLED unit: the released opener is
    // a bot now, so even standing on the intact wall it yields no context.
    standOnWall(s);
    expect(classPickContext(s)).toBeNull();
  });

  it('four_named_buttons_and_channel_states', () => {
    const s = createMatch(1);
    const snapshot = layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const mount = document.createElement('div');
    const picks: Array<{ context: ClassPickContext; classId: string }> = [];
    const hud = new ClassPickHud(mount, (context, classId) => picks.push({ context, classId }));
    hud.sync(s);

    const tray = mount.querySelector('#tw-class-pick') as HTMLElement;
    expect(tray).not.toBeNull();
    expect(tray.hidden).toBe(false);
    expect(tray.getAttribute('role')).toBe('group');
    expect(tray.getAttribute('aria-label')).toBe('เลือกอาชีพ');

    // Order boxer/healer/ninja/giant = CLASS_IDS = digits 1–4.
    expect([...CLASS_IDS]).toEqual(['boxer', 'healer', 'ninja', 'giant']);
    const buttons = [...tray.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => b.querySelector('.tw-class-label')!.textContent)).toEqual([
      'นักมวย',
      'หมอยา',
      'นินจา',
      'ยักษ์',
    ]);
    expect(buttons.map((b) => b.querySelector('.tw-class-key')!.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);

    // Clicking sends the exact displayed context with the chosen class.
    buttons[1]!.click();
    expect(picks).toEqual([{ context: { unitId: 0, snapshot }, classId: 'healer' }]);

    // Tray pointer starts never propagate toward canvas/joystick listeners.
    let sawPointer = 0;
    const onDoc = () => {
      sawPointer += 1;
    };
    document.addEventListener('pointerdown', onDoc);
    buttons[0]!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.removeEventListener('pointerdown', onDoc);
    expect(sawPointer).toBe(0);

    // A banned class stays labelled but disabled; ordinary matches have none.
    s.itemBans = { fruit: ['ninja'] };
    hud.sync(s);
    const banned = [...tray.querySelectorAll<HTMLButtonElement>('button')];
    expect(banned[2]!.disabled).toBe(true);
    expect(banned[2]!.querySelector('.tw-class-label')!.textContent).toBe('นินจา');
    expect(banned[1]!.disabled).toBe(false);
    s.itemBans = undefined;

    // Opening: choices are replaced by a noninteractive status whose remaining
    // fraction is computed from sim ticks, not a wall-clock interval.
    s.pads.fruit.opening = {
      byUnit: 0,
      doneTick: s.tick + OPEN_TICKS,
      snapshot,
      classId: 'healer',
    };
    expect(classPickContext(s)).toBeNull(); // no choices while the channel runs
    hud.sync(s);
    const status = tray.querySelector('.tw-class-status') as HTMLElement;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('กำลังสร้างลูกทีม…');
    expect(buttons.every((b) => b.hidden)).toBe(true);
    const progress = tray.querySelector('.tw-class-progress') as HTMLElement;
    expect(progress.getAttribute('role')).toBe('progressbar');
    expect(Number(progress.getAttribute('aria-valuenow'))).toBeCloseTo(1, 5);
    s.tick += OPEN_TICKS / 4; // sim clock only — no timer was touched
    hud.sync(s);
    expect(Number(progress.getAttribute('aria-valuenow'))).toBeCloseTo(0.75, 5);

    // A bot's channel never shows for the human.
    s.pads.fruit.opening = null;
    hud.sync(s);
    s.pads.fruit.opening = {
      byUnit: 1,
      doneTick: s.tick + OPEN_TICKS,
      snapshot,
      classId: 'boxer',
    };
    hud.sync(s);
    expect((tray.querySelector('.tw-class-status') as HTMLElement).hidden).toBe(true);
    s.pads.fruit.opening = null;

    // Death clears the pending view; no auto-selection, tray hides.
    s.units[0]!.deadUntilTick = s.tick + 10;
    hud.sync(s);
    expect(tray.hidden).toBe(true);

    // Empty/basic pad hides the tray entirely.
    s.units[0]!.deadUntilTick = null;
    s.pads.fruit.cells = Array.from({ length: 4 }, () => [null, null] as (number | null)[]);
    hud.sync(s);
    expect(tray.hidden).toBe(true);

    hud.destroy();
    expect(mount.querySelector('#tw-class-pick')).toBeNull();
  });

  it('switch_enabled_for_dead_source_with_live_target', () => {
    const mount = document.createElement('div');
    document.body.appendChild(mount); // the accessible description lives in the document
    let switches = 0;
    const hud = new SwitchHud(mount, () => {
      switches += 1;
    });
    const s = createMatch(1);
    hud.sync(s);

    const btn = mount.querySelector('#tw-btn-switch') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('สลับตัว');
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(switches).toBe(1);

    // A dead source with a living teammate stays enabled and still drains.
    s.units[0]!.deadUntilTick = s.tick + 100;
    hud.sync(s);
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(false);
    const controls = new R2Controls();
    controls.queueSwitch();
    expect(controls.read(s).switchNext).toBe(true);
    expect(controls.read(s).switchNext).toBeUndefined();

    // No living teammate: visible, disabled, Thai accessible description.
    s.units[1]!.deadUntilTick = s.tick + 100;
    s.units[2]!.deadUntilTick = s.tick + 100;
    hud.sync(s);
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(true);
    const descId = btn.getAttribute('aria-describedby');
    expect(descId).not.toBeNull();
    expect(document.getElementById(descId!)!.textContent).toBe('ไม่มีลูกทีมที่สลับได้');
    btn.click();
    expect(switches).toBe(1); // disabled button cannot fire

    // All-bot match and finished matches hide the button entirely.
    const bots = createMatch(1, { humanUnit: null });
    hud.sync(bots);
    expect(btn.hidden).toBe(true);
    s.winner = 'fruit';
    hud.sync(s);
    expect(btn.hidden).toBe(true);

    hud.destroy();
    expect(mount.querySelector('#tw-btn-switch')).toBeNull();
    mount.remove();
  });

  it('r2_css_pins_plan_section_5_tokens_widths_and_stays_unwired', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'r2.css'), 'utf8');
    const shell = readFileSync(join(process.cwd(), 'src', 'shell.css'), 'utf8');
    // R2-10 ships rules only: the shell must not import the stylesheet yet.
    expect(shell).not.toContain('r2.css');
    // §5 scoped tokens on .tw-screen-hud.
    for (const token of [
      '--tw-r2-ink: #1b1030',
      '--tw-r2-paper: #fff5d9',
      '--tw-r2-panel: rgba(27, 16, 48, 0.92)',
      '--tw-r2-focus: #ffd75e',
      '--tw-r2-super: #ff3fa4',
      "'Noto Sans Thai', Tahoma, sans-serif",
    ]) {
      expect(css).toContain(token);
    }
    // §5 geometry: 336 tray with 72×76 buttons, ≤740: 280 tray with 60×72 and
    // 14/20 labels, 112×56 switch on safe-area edges, visible 3px focus.
    for (const rule of [
      'width: 336px',
      'width: 72px',
      'height: 76px',
      'width: 280px',
      'width: 60px',
      'height: 72px',
      'width: 112px',
      'height: 56px',
      'max-width: 740px',
      'env(safe-area-inset-bottom)',
      'env(safe-area-inset-left)',
      'env(safe-area-inset-top)',
      'border-box',
      'outline: 3px solid',
      'pointer-events: auto',
    ]) {
      expect(css).toContain(rule);
    }
  });

  it('handoff_clears_all_control_latches', () => {
    // Shared controller: the card's pinned one-shot + reset semantics.
    const controls = new R2Controls();
    controls.queueSwitch();
    expect(controls.read(createMatch(1)).switchNext).toBe(true);
    expect(controls.read(createMatch(1)).switchNext).not.toBe(true);
    controls.queueSwitch();
    controls.resetForHandoff();
    expect(controls.read(createMatch(1)).switchNext).not.toBe(true);

    // A queued pick dies with the handoff too.
    const s = createMatch(1);
    layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const ctx = wallContext(s);
    controls.queuePick(ctx, 'boxer');
    controls.resetForHandoff();
    expect(controls.read(s).classPick).toBeUndefined();

    // Keyboard: held movement, E/Q/R pulses and a cached digit pick all clear,
    // and auto-repeat keydowns stay ignored until a fresh physical press.
    const kb = new KeyboardInput();
    kb.handleKey('KeyD', true);
    kb.handleKey('Digit2', true, ctx);
    kb.handleKey('KeyR', true);
    kb.handleKey('KeyE', true);
    kb.resetForHandoff();
    const after = kb.read(s, 0);
    expect(after.move.x).toBe(0);
    expect(after.move.y).toBe(0);
    expect(after.classPick).toBeUndefined();
    expect(after.switchNext).toBeUndefined();
    expect(after.throwBomb).toBe(false);
    expect(after.pickDrop).toBe(false);
    expect(after.open).toBe(false);
    kb.handleKey('KeyD', true); // OS auto-repeat without a keyup
    expect(kb.read(s, 0).move.x).toBe(0);
    kb.handleKey('KeyD', false); // fresh physical cycle
    kb.handleKey('KeyD', true);
    expect(kb.read(s, 0).move.x).toBe(1);

    // Touch: vector, fire latch and pulses release; stale pointer events
    // cannot resurrect the joystick, and double reset is safe.
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const touch = new TouchControls(mount);
    const zone = mount.querySelector('.tw-joy-zone') as HTMLElement;
    const fireBtn = mount.querySelector('#tw-btn-fire') as HTMLElement;
    const openBtn = mount.querySelector('#tw-btn-open') as HTMLElement;
    zone.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 10, clientY: 10 }));
    zone.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 66, clientY: 10 }));
    fireBtn.dispatchEvent(pointerEvent('pointerdown', { pointerId: 8 }));
    openBtn.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9 }));
    touch.resetForHandoff();
    const cleared = touch.read();
    expect(cleared.move).toEqual({ x: 0, y: 0 });
    expect(cleared.fire).toBe(false);
    expect(cleared.pickDrop).toBe(false);
    expect(cleared.throwBomb).toBe(false);
    expect(cleared.open).toBe(false);
    // The old pointer's move/up arrive after the handoff: no stuck joystick/fire.
    zone.dispatchEvent(pointerEvent('pointermove', { pointerId: 7, clientX: 100, clientY: 10 }));
    expect(touch.read().move).toEqual({ x: 0, y: 0 });
    fireBtn.dispatchEvent(pointerEvent('pointerup', { pointerId: 8 }));
    expect(touch.read().fire).toBe(false);
    touch.resetForHandoff();
    touch.resetForHandoff();
    touch.destroy();
    mount.remove();
  });

  it('digit_pick_through_real_sim_starts_the_class_channel', () => {
    // Plan §2.2: the pick input shape is open:true + classPick — the sim only
    // starts a channel when input.open && canStartOpen (sim step.ts:98,135).
    const s = createMatch(1);
    for (const u of s.units) u.isBot = false; // scripted real inputs, no bot overrides
    layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const ctx = wallContext(s);
    const kb = new KeyboardInput();
    kb.handleKey('Digit2', true, ctx); // Digit2 = healer (CLASS_IDS order)
    const next = step(s, new Map([[0, kb.read(s, 0)]]));
    expect(next.pads.fruit.opening?.classId).toBe('healer');
    expect(next.pads.fruit.opening?.doneTick).toBe(s.tick + 1 + OPEN_TICKS);
    expect(next.pads.fruit.opening?.snapshot).toBe(ctx.snapshot);
  });

  it('tray_pick_through_real_sim_starts_the_class_channel', () => {
    // R2Controls.read must carry open:true with a validated pick so the scene
    // merge {...keyboard, ...tray} opens without a second sim API.
    const s = createMatch(1);
    for (const u of s.units) u.isBot = false;
    layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const ctx = wallContext(s);
    const controls = new R2Controls();
    controls.queuePick(ctx, 'ninja');
    const merged = { ...new KeyboardInput().read(s, 0), ...controls.read(s) };
    const next = step(s, new Map([[0, merged]]));
    expect(next.pads.fruit.opening?.classId).toBe('ninja');
    expect(next.pads.fruit.opening?.doneTick).toBe(s.tick + 1 + OPEN_TICKS);
    expect(next.pads.fruit.opening?.snapshot).toBe(ctx.snapshot);
  });

  it('stale_pick_through_real_sim_leaves_opening_null', () => {
    // Keyboard: the wall changed after Digit2 was cached — the pick is consumed
    // and the step must not open anything.
    const s = createMatch(1);
    for (const u of s.units) u.isBot = false;
    layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const ctx = wallContext(s);
    const kb = new KeyboardInput();
    kb.handleKey('Digit2', true, ctx);
    s.pads.fruit.cells[1]![1] = null; // displayed snapshot no longer matches
    const nextKb = step(s, new Map([[0, kb.read(s, 0)]]));
    expect(nextKb.pads.fruit.opening).toBeNull();

    // Tray: same staleness contract through the merged read.
    const s2 = createMatch(1);
    for (const u of s2.units) u.isBot = false;
    layoutClassWall(s2, [0, 1]);
    standOnWall(s2);
    const ctx2 = wallContext(s2);
    const controls = new R2Controls();
    controls.queuePick(ctx2, 'ninja');
    s2.pads.fruit.cells[0]![0] = null; // displayed snapshot no longer matches
    const merged = { ...new KeyboardInput().read(s2, 0), ...controls.read(s2) };
    const nextTray = step(s2, new Map([[0, merged]]));
    expect(nextTray.pads.fruit.opening).toBeNull();
  });

  it('failed_icon_keeps_Thai_button_name', () => {
    const s = createMatch(1);
    layoutClassWall(s, [0, 1]);
    standOnWall(s);
    const mount = document.createElement('div');
    let picked: string | null = null;
    const hud = new ClassPickHud(mount, (_context, classId) => {
      picked = classId;
    });
    hud.sync(s);

    const imgs = [...mount.querySelectorAll<HTMLImageElement>('#tw-class-pick img')];
    expect(imgs.length).toBe(4);
    imgs[2]!.dispatchEvent(new Event('error'));
    const buttons = [...mount.querySelectorAll<HTMLButtonElement>('#tw-class-pick button')];
    expect(imgs[2]!.hidden).toBe(true);
    expect(buttons[2]!.querySelector('.tw-class-label')!.textContent).toBe('นินจา');
    expect(buttons[2]!.disabled).toBe(false);
    // Re-syncing must not recreate the failed image (no repeated fetches).
    hud.sync(s);
    expect(imgs[2]!.hidden).toBe(true);
    // The button remains fully usable.
    buttons[2]!.click();
    expect(picked).toBe('ninja');

    hud.destroy();
  });
});
