import { describe, expect, it } from 'vitest';
import { canOpen, createMatch, padCellCenter } from '@talad/sim';
import { KeyboardInput } from '../src/input/keyboard';

/** Fruit pad with one crate in column 0; unit 0 standing on that column. */
function stateWithOpenablePad() {
  const s = createMatch(1);
  s.pads.fruit.cells[0]![0] = 1;
  const on = padCellCenter(s.pads.fruit, 0);
  s.units[0]!.pos = { x: on.x, y: on.y };
  return s;
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
});
