import { describe, expect, it } from 'vitest';
import { createMatch, stateHash, step } from '../src/index';
import type { MatchState, SquadCommand, Team, UnitId, UnitInput, Vec2 } from '../src/index';

const UNIT_IDS: UnitId[] = [0, 1, 2, 3, 4, 5];

const DIRS: Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
];

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function inputFor(tick: number): UnitInput {
  return {
    move: must(DIRS[tick % DIRS.length]),
    aim: null,
    fire: tick % 3 === 0,
    throwBomb: tick % 7 === 0,
    pickDrop: tick % 97 === 0,
    open: false,
  };
}

function inputsFor(tick: number): Map<UnitId, UnitInput> {
  const inputs = new Map<UnitId, UnitInput>();
  for (const id of UNIT_IDS) inputs.set(id, inputFor(tick));
  return inputs;
}

function commandsFor(tick: number): Partial<Record<Team, SquadCommand>> {
  const seq: Exclude<SquadCommand, null>[] = ['attack', 'guard', 'fetch'];
  return { fruit: seq[tick % 3], dessert: seq[(tick + 1) % 3] };
}

function runScripted(): MatchState {
  let s = createMatch(7);
  for (let t = 0; t < 2000; t++) s = step(s, inputsFor(t), commandsFor(t));
  return s;
}

describe('determinism', () => {
  it('2000 scripted ticks from seed 7, run twice, produce an identical stateHash', () => {
    const first = runScripted();
    const second = runScripted();
    expect(first.tick).toBe(2000);
    expect(first.winner).toBeNull();
    expect(stateHash(first)).toBe(stateHash(second));
    expect(first).toEqual(second);
  });
});
