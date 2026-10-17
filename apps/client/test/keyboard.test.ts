import { describe, expect, it } from 'vitest';
import { CLASS_IDS, canOpen, createMatch, padCellCenter } from '@talad/sim';
import { KeyboardInput } from '../src/input/keyboard';
import type { ClassPickContext } from '../src/input/r2Controls';

/** Fruit pad with one crate in column 0; unit 0 standing on that column. */
function stateWithOpenablePad() {
  const s = createMatch(1);
  s.pads.fruit.cells[0]![0] = 1;
  const on = padCellCenter(s.pads.fruit, 0);
  s.units[0]!.pos = { x: on.x, y: on.y };
  return s;
}

/** Fruit pad with a class wall (two full side-adjacent columns); unit 0 on it. */
function stateWithClassWall() {
  const s = createMatch(1);
  s.crates = s.crates.filter((c) => c.state !== 'onPad');
  s.pads.fruit.cells = Array.from({ length: 4 }, () => [null, null] as (number | null)[]);
  for (const col of [0, 1] as const) {
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
  const on = padCellCenter(s.pads.fruit, 0);
  s.units[0]!.pos = { x: on.x, y: on.y };
  return s;
}

/** Fruit pad with an ordinary buddy wall (two stacked crates in column 0). */
function stateWithBuddyWall() {
  const s = createMatch(1);
  s.crates = s.crates.filter((c) => c.state !== 'onPad');
  s.pads.fruit.cells = Array.from({ length: 4 }, () => [null, null] as (number | null)[]);
  for (const layer of [0, 1] as const) {
    const id = s.nextId++;
    s.pads.fruit.cells[0]![layer] = id;
    s.crates.push({
      id,
      pos: { x: 8.75, y: 18.75 },
      state: 'onPad',
      landTick: 0,
      kind: 'normal',
    });
  }
  const on = padCellCenter(s.pads.fruit, 0);
  s.units[0]!.pos = { x: on.x, y: on.y };
  return s;
}

function wallContext(s: ReturnType<typeof stateWithClassWall>): ClassPickContext {
  return { unitId: 0, snapshot: JSON.stringify(s.pads.fruit.cells) };
}

describe('KeyboardInput', () => {
  it('W+D gives a normalized diagonal up-right move', () => {
    const kb = new KeyboardInput();
    const s = createMatch(1);
    kb.handleKey('KeyW', true);
    kb.handleKey('KeyD', true);
    const input = kb.read(s, 0);
    expect(input.move.x).toBeCloseTo(0.7071, 3);
    expect(input.move.y).toBeCloseTo(-0.7071, 3);
  });

  it('E with canOpen asks for open only (open wins when visible)', () => {
    const kb = new KeyboardInput();
    const s = stateWithOpenablePad();
    expect(canOpen(s, 0)).toBe(true);
    kb.handleKey('KeyE', true);
    const input = kb.read(s, 0);
    expect(input.open).toBe(true);
    expect(input.pickDrop).toBe(false);
  });

  it('E without canOpen asks for pick/drop', () => {
    const kb = new KeyboardInput();
    const s = createMatch(1); // unit 0 at its stall, not on the pad
    expect(canOpen(s, 0)).toBe(false);
    kb.handleKey('KeyE', true);
    const input = kb.read(s, 0);
    expect(input.open).toBe(false);
    expect(input.pickDrop).toBe(true);
  });

  it('E pulses once per press', () => {
    const kb = new KeyboardInput();
    const s = createMatch(1);
    kb.handleKey('KeyE', true);
    expect(kb.read(s, 0).pickDrop).toBe(true);
    expect(kb.read(s, 0).pickDrop).toBe(false);
    kb.handleKey('KeyE', false);
    expect(kb.read(s, 0).pickDrop).toBe(false);
  });

  it('Q pulses throwBomb once per press', () => {
    const kb = new KeyboardInput();
    const s = createMatch(1);
    kb.handleKey('KeyQ', true);
    expect(kb.read(s, 0).throwBomb).toBe(true);
    expect(kb.read(s, 0).throwBomb).toBe(false);
  });

  it('releasing keys clears the move vector', () => {
    const kb = new KeyboardInput();
    const s = createMatch(1);
    kb.handleKey('KeyW', true);
    kb.handleKey('KeyD', true);
    kb.handleKey('KeyW', false);
    kb.handleKey('KeyD', false);
    const input = kb.read(s, 0);
    expect(input.move.x).toBe(0);
    expect(input.move.y).toBe(0);
  });

  it('digits 1-4 queue class picks only inside a class context, in CLASS_IDS order', () => {
    const kb = new KeyboardInput();
    const s = stateWithClassWall();
    const ctx = wallContext(s);
    expect(kb.handleKey('Digit2', true, ctx)).toBe(true);
    const input = kb.read(s, 0);
    expect(input.classPick).toEqual({ classId: 'healer', snapshot: ctx.snapshot });
    expect(kb.read(s, 0).classPick).toBeUndefined(); // one-shot per press
    for (const [i, classId] of CLASS_IDS.entries()) {
      kb.handleKey(`Digit${i + 1}`, false);
      kb.handleKey(`Digit${i + 1}`, true, ctx);
      expect(kb.read(s, 0).classPick?.classId).toBe(classId);
    }
  });

  it('a cached digit pick binds to its cached source unit', () => {
    const kb = new KeyboardInput();
    const s = stateWithClassWall();
    kb.handleKey('Digit1', true, { unitId: 5, snapshot: 'elsewhere' });
    expect(kb.read(s, 0).classPick).toBeUndefined();
    expect(kb.read(s, 0).classPick).toBeUndefined(); // consumed even when stale
    kb.handleKey('Digit1', false); // fresh physical press
    kb.handleKey('Digit1', true, wallContext(s));
    expect(kb.read(s, 0).classPick?.classId).toBe('boxer');
  });

  it('digits without a class context are not consumed (squad keys keep working)', () => {
    const kb = new KeyboardInput();
    const s = createMatch(1);
    expect(kb.handleKey('Digit1', true)).toBe(false);
    expect(kb.handleKey('Digit4', true)).toBe(false);
    expect(kb.read(s, 0).classPick).toBeUndefined();
    kb.handleKey('Digit1', false);
    expect(kb.handleKey('Digit1', true, null)).toBe(false);
    expect(kb.read(s, 0).classPick).toBeUndefined();
  });

  it('KeyR queues switchNext exactly once per press and never auto-repeats', () => {
    const kb = new KeyboardInput();
    const s = createMatch(1);
    kb.handleKey('KeyR', true);
    expect(kb.read(s, 0).switchNext).toBe(true);
    expect(kb.read(s, 0).switchNext).toBeUndefined();
    kb.handleKey('KeyR', true); // OS auto-repeat while held (no keyup)
    expect(kb.read(s, 0).switchNext).toBeUndefined();
    kb.handleKey('KeyR', false);
    kb.handleKey('KeyR', true); // fresh physical press
    expect(kb.read(s, 0).switchNext).toBe(true);
  });

  it('E on a class wall never lifts or opens without a choice', () => {
    const kb = new KeyboardInput();
    const s = stateWithClassWall();
    expect(canOpen(s, 0)).toBe(true);
    kb.handleKey('KeyE', true);
    const input = kb.read(s, 0);
    expect(input.open).toBe(false);
    expect(input.pickDrop).toBe(false);
    // A digit queued alongside still rides the same read.
    kb.handleKey('Digit1', true, wallContext(s));
    expect(kb.read(s, 0).classPick?.classId).toBe('boxer');
  });

  it('Q throw and E ordinary open on a non-class wall are unchanged', () => {
    const kb = new KeyboardInput();
    const s = stateWithBuddyWall();
    expect(canOpen(s, 0)).toBe(true);
    kb.handleKey('KeyE', true);
    const input = kb.read(s, 0);
    expect(input.open).toBe(true);
    expect(input.pickDrop).toBe(false);

    const kb2 = new KeyboardInput();
    const s2 = stateWithClassWall();
    kb2.handleKey('KeyQ', true);
    expect(kb2.read(s2, 0).throwBomb).toBe(true);
  });
});
