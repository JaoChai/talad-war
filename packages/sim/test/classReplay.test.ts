import { expect, it } from 'vitest';
import * as sim from '../src/index';
import type { MatchState, UnitId, UnitInput } from '../src/index';

const idle: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};
type Frame = (readonly [UnitId, UnitInput])[];

function fixture(): MatchState {
  const s = sim.createMatch(71);
  for (const u of s.units) {
    u.isBot = false;
    u.pos = { x: 2, y: 2 + u.id };
  }
  // Two overlapping living healers, a wounded Ninja on the opposing wall,
  // a distant friendly opener, and an enemy with one lethal bomb.
  Object.assign(s.units[0]!, { classId: 'healer', hp: 12, pos: { x: 29.75, y: 3.75 } });
  Object.assign(s.units[1]!, { pos: sim.padCellCenter(s.pads.fruit, 0) });
  Object.assign(s.units[2]!, {
    classId: 'ninja',
    superBuddy: true,
    hp: 1,
    pos: { x: 29.75, y: 3.75 },
  });
  Object.assign(s.units[3]!, { bombs: 1, pos: { x: 28, y: 3.75 } });
  s.units.push({ ...structuredClone(s.units[0]!), id: 6, hp: 50 });
  for (const team of ['fruit', 'dessert'] as const) {
    for (const col of [0, 1])
      for (const layer of [0, 1]) {
        const id = (team === 'fruit' ? 100 : 200) + col * 2 + layer;
        s.pads[team].cells[col]![layer] = id;
        s.crates.push({
          id,
          state: 'onPad',
          kind: layer === 1 ? 'super' : 'normal',
          pos: sim.padCellCenter(s.pads[team], col),
          landTick: 0,
        });
      }
  }
  s.nextId = 1000;
  return s;
}

it('captured_class_tape_replays_with_equal_hashes_and_immutable_state_and_inputs', () => {
  const initial = fixture();
  // Capture a serializable, fixed input tape once; replay never consults output
  // state to choose actions or injects successful events/mid-replay mutations.
  const recording: Frame[] = [
    [
      [
        1,
        {
          ...idle,
          open: true,
          classPick: { classId: 'healer', snapshot: JSON.stringify(initial.pads.fruit.cells) },
        },
      ],
      [2, { ...idle, fire: true }],
    ],
    [[3, { ...idle, throwBomb: true, aim: { x: 29.75, y: 3.75 } }]],
    ...Array.from({ length: sim.RESPAWN_TICKS + sim.BOMB_FUSE_TICKS + 5 }, (): Frame => []),
  ];
  const captured = JSON.stringify(recording);
  const tape = JSON.parse(captured) as Frame[];
  const initialCopy = structuredClone(initial);
  function replay() {
    let state = initial;
    const hashes: string[] = [];
    const events: MatchState['events'] = [];
    let firstHp = 0;
    for (const frame of tape) {
      const input = new Map(frame);
      const inputCopy = structuredClone(input);
      const source = state;
      const before = structuredClone(source);
      state = sim.step(source, input);
      expect(source).toEqual(before);
      // Check the precise object supplied to step, not a reconstructed snapshot.
      if (state.tick === 1) firstHp = state.units[0]!.hp;
      expect(input).toEqual(inputCopy);
      hashes.push(sim.stateHash(state));
      events.push(...state.events);
    }
    return { state, hashes, events, firstHp };
  }
  const first = replay();
  const second = replay();
  expect(first).toEqual(second);
  expect(sim.stateHash(first.state)).toBe(sim.stateHash(second.state));
  expect(initial).toEqual(initialCopy);
  expect(JSON.stringify(tape)).toBe(captured);
  expect(first.firstHp).toBeCloseTo(12 + sim.HEALER_AURA_HP_PER_SEC * sim.DT);
  expect(first.events).toContainEqual(
    expect.objectContaining({ kind: 'opened', recipe: 'class', classId: 'healer', super: true }),
  );
  expect(first.events.filter((e) => e.kind === 'ninjaKnock')).toEqual([
    expect.objectContaining({ unitId: 2, padTeam: 'dessert', crateId: 201 }),
  ]);
  for (const id of [0, 2]) {
    expect(first.events).toContainEqual(expect.objectContaining({ kind: 'death', unitId: id }));
    expect(first.events).toContainEqual(expect.objectContaining({ kind: 'respawn', unitId: id }));
    const u = first.state.units.find((u) => u.id === id)!;
    expect(u.classId).toBe(initial.units[id]!.classId);
    expect(u.superBuddy).toBe(initial.units[id]!.superBuddy);
    expect(u.deadUntilTick).toBeNull();
  }
  expect(first.events).toContainEqual(
    expect.objectContaining({ kind: 'hit', source: 'bombs', dmg: 45 }),
  );
});
