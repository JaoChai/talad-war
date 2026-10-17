import { describe, expect, it } from 'vitest';
import * as sim from '../src/index';
import type { MatchState, Unit, UnitId, UnitInput } from '../src/index';

const idle: UnitInput = {
  move: { x: 0, y: 0 },
  aim: null,
  fire: false,
  throwBomb: false,
  pickDrop: false,
  open: false,
};

function bodies(): MatchState {
  const s = sim.createMatch(17);
  s.units = s.units.slice(0, 2);
  s.units[0]!.pos = { x: 8, y: 10 };
  s.units[1]!.pos = { x: 8, y: 14 };
  return s;
}

function byId(s: MatchState, id: UnitId): Unit {
  return s.units.find((u) => u.id === id)!;
}

function padCrates(s: MatchState, columns: number[], stacked = false): void {
  for (const col of columns) {
    for (const layer of stacked ? [0, 1] : [0]) {
      const id = 100 + col * 2 + layer;
      s.pads.fruit.cells[col]![layer] = id;
      s.crates.push({
        id,
        kind: layer === 1 ? 'super' : 'normal',
        state: 'onPad',
        pos: sim.padCellCenter(s.pads.fruit, col),
        landTick: 0,
      });
    }
  }
  s.nextId = 200;
}

it('cycles_sorted_ids_and_skips_dead_enemies', () => {
  const s = bodies();
  const model = s.units[0]!;
  s.units = [
    { ...structuredClone(model), id: 40, isBot: true },
    { ...structuredClone(model), id: 3, team: 'dessert', isBot: true },
    { ...structuredClone(model), id: 9, isBot: true },
    { ...structuredClone(model), id: 2 },
  ];
  const before = structuredClone(s);
  expect(sim.controlledUnit(s)?.id).toBe(2);
  expect(sim.nextLivingTeammate(s, 2)?.id).toBe(9);
  expect(s).toEqual(before); // Query helpers must not sort/mutate the source array.
  for (const [from, to] of [
    [2, 9],
    [9, 40],
    [40, 2],
  ] as const) {
    expect(sim.switchControl(s, from)).toBe(to);
    expect(sim.controlledUnit(s)?.id).toBe(to);
    expect(s.units.filter((u) => !u.isBot).map((u) => u.id)).toEqual([to]);
  }
  byId(s, 9).deadUntilTick = 99;
  byId(s, 9).hp = 0;
  expect(sim.switchControl(s, 2)).toBe(40);
  expect(sim.switchControl(s, 40)).toBe(2);
  expect(s.events.filter((e) => e.kind === 'controlSwitched')[0]).toEqual({
    kind: 'controlSwitched',
    fromUnitId: 2,
    toUnitId: 9,
    team: 'fruit',
    tick: 0,
  });
  expect(s.rng).toBe(before.rng);
});

it('dead_source_can_switch_but_no_target_is_noop', () => {
  const s = bodies();
  Object.assign(s.units[0]!, { hp: 0, deadUntilTick: 99, classId: 'ninja', superBuddy: true });
  const source = structuredClone(s.units[0]!);
  const switched = sim.step(s, new Map([[0, { ...idle, switchNext: true }]]));
  expect(sim.controlledUnit(switched)?.id).toBe(1);
  expect(byId(switched, 0)).toEqual({ ...source, isBot: true });
  expect(s.units[0]).toEqual(source);
  for (const deadSource of [false, true]) {
    const noTarget = bodies();
    noTarget.units[1]!.deadUntilTick = 99;
    if (deadSource) noTarget.units[0]!.deadUntilTick = 99;
    const before = structuredClone(noTarget);
    expect(sim.nextLivingTeammate(noTarget, 0)).toBeNull();
    expect(sim.switchControl(noTarget, 0)).toBeNull();
    expect(noTarget).toEqual(before);
  }
  const cap = bodies();
  for (const id of [2, 9, 40]) cap.units.push({ ...structuredClone(cap.units[1]!), id });
  expect(cap.units).toHaveLength(sim.TEAM_CAP);
  expect(sim.switchControl(cap, 0)).toBe(1);
});

it('only_lowest_manual_owner_can_switch_and_items_stay_on_bodies', () => {
  const s = bodies();
  Object.assign(s.units[0]!, {
    carrying: 80,
    gun: { kind: 'heavy', super: true, ammoCooldownTicks: 4 },
    bombs: 5,
    bombsSuper: true,
    classId: 'ninja',
    superBuddy: true,
    ninjaKnockReadyTick: 99,
  });
  Object.assign(s.units[1]!, { classId: 'giant', gun: { ammoCooldownTicks: 2 }, bombs: 2 });
  const before = structuredClone(s);
  for (const id of [1, 999]) expect(sim.switchControl(s, id)).toBeNull();
  expect(s).toEqual(before);
  expect(sim.switchControl(s, 0)).toBe(1);
  expect(s.units).toEqual(before.units.map((u) => ({ ...u, isBot: u.id === 0 })));
  expect(s.rng).toBe(before.rng);
  // Legacy multi-manual fixtures are tolerated, not normalized or multiplayer.
  const legacy = bodies();
  legacy.units[1]!.isBot = false;
  legacy.units.reverse();
  legacy.units.find((u) => u.id === 0)!.deadUntilTick = 99;
  expect(sim.controlledUnit(legacy)?.id).toBe(0);
  const copy = structuredClone(legacy);
  expect(sim.switchControl(legacy, 1)).toBeNull();
  expect(legacy).toEqual(copy);
});

function actionFixture(action: string): { s: MatchState; input: UnitInput } {
  const s = bodies();
  const u = s.units[0]!;
  const input = { ...idle, aim: { x: 9, y: 10 } };
  if (action === 'move') input.move = { x: 1, y: 0 };
  if (action === 'fire') {
    u.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    input.fire = true;
  }
  if (action === 'throw') {
    u.bombs = 5;
    u.bombsSuper = true;
    input.throwBomb = true;
  }
  if (action === 'pick') {
    s.crates.push({ id: 80, state: 'ground', kind: 'super', pos: { ...u.pos }, landTick: 0 });
    input.pickDrop = true;
  }
  if (action === 'drop') {
    u.carrying = 80;
    s.crates.push({ id: 80, state: 'carried', kind: 'super', pos: { ...u.pos }, landTick: 0 });
    input.pickDrop = true;
  }
  if (action === 'open') {
    padCrates(s, [0]);
    u.pos = sim.padCellCenter(s.pads.fruit, 0);
    input.open = true;
  }
  return { s, input };
}

describe('switch_discards_source_actions_and_is_order_stable', () => {
  it.each(['move', 'fire', 'throw', 'pick', 'drop', 'open'])(
    '%s is idle only on success',
    (action) => {
      const { s, input } = actionFixture(action);
      const before = structuredClone(s);
      const buffered = {
        ...idle,
        move: { x: -1, y: 1 },
        fire: true,
        throwBomb: true,
        pickDrop: true,
        open: true,
        switchNext: true,
      };
      Object.assign(s.units[1]!, { gun: { ammoCooldownTicks: 0 }, bombs: 2 });
      const entries: [UnitId, UnitInput][] = [
        [0, { ...input, switchNext: true }],
        [1, buffered],
      ];
      const map = new Map(entries);
      const mapCopy = structuredClone(map);
      const result = sim.step(s, map);
      expect(result).toEqual(sim.step(s, new Map([...entries].reverse())));
      expect(sim.controlledUnit(result)?.id).toBe(1);
      expect(byId(result, 0)).toEqual({ ...s.units[0]!, isBot: true });
      expect(byId(result, 1)).toEqual({ ...s.units[1]!, isBot: false });
      expect(result.crates).toEqual(s.crates);
      expect(result.projectiles).toEqual([]);
      expect(result.pads).toEqual(s.pads);
      expect(result.events).toEqual([
        { kind: 'controlSwitched', fromUnitId: 0, toUnitId: 1, team: 'fruit', tick: 1 },
      ]);
      expect(map).toEqual(mapCopy);
      expect(s.units[0]).toEqual(before.units[0]);
      // The same ordinary input has an observable effect when switching fails.
      const lone = structuredClone(s);
      lone.units = [lone.units[0]!];
      const ordinary = sim.step(lone, new Map([[0, input]]));
      const failed = sim.step(lone, new Map([[0, { ...input, switchNext: true }]]));
      expect(failed).toEqual(ordinary);
      expect(ordinary).not.toEqual(sim.step(lone, new Map()));
    },
  );
});

it('bot_supplied_switch_cannot_hijack_and_other_bots_still_run', () => {
  const s = sim.createMatch(1);
  const expected = sim.step(s, new Map([[0, { ...idle, switchNext: true }]]));
  const result = sim.step(s, new Map(s.units.map((u) => [u.id, { ...idle, switchNext: true }])));
  expect(result).toEqual(expected);
  expect(sim.controlledUnit(result)?.id).toBe(1);
  const otherBot = byId(s, 2);
  expect(byId(result, 2).pos).not.toEqual(otherBot.pos);
});

it('released_body_uses_current_bot_goal_next_tick', () => {
  for (const command of [null, 'guard', 'attack', 'fetch'] as const) {
    const { s } = actionFixture('drop');
    const handoff = sim.step(s, new Map([[0, { ...idle, switchNext: true }]]), { fruit: command });
    expect(byId(handoff, 0).pos).toEqual(s.units[0]!.pos);
    expect(sim.botGoal(handoff, 0)).toBe(command ?? 'fetch');
    const authored = sim.botInput(handoff, 0);
    expect(authored.move).not.toEqual(idle.move);
    const manualOracle = structuredClone(handoff);
    byId(manualOracle, 0).isBot = false;
    const expected = sim.step(manualOracle, new Map([[0, authored]]));
    byId(expected, 0).isBot = true;
    const actual = sim.step(handoff, new Map());
    expect(actual).toEqual(expected);
    expect(byId(actual, 0).pos).not.toEqual(byId(handoff, 0).pos);
  }
  const dead = bodies();
  Object.assign(dead.units[0]!, { hp: 0, deadUntilTick: 99 });
  const handoff = sim.step(dead, new Map([[0, { ...idle, switchNext: true }]]));
  expect(sim.botInput(handoff, 0)).toEqual(idle);
  const waiting = sim.step(handoff, new Map());
  expect(byId(waiting, 0)).toEqual(byId(handoff, 0));
  expect(waiting.events).not.toContainEqual(expect.objectContaining({ kind: 'respawn' }));
});

it('switch_cancels_source_class_channel_without_losing_wall', () => {
  const s = bodies();
  padCrates(s, [0, 1], true);
  s.units[0]!.pos = sim.padCellCenter(s.pads.fruit, 0);
  sim.startOpen(s, 0, { classId: 'giant', snapshot: JSON.stringify(s.pads.fruit.cells) });
  expect(s.pads.fruit.opening?.classId).toBe('giant');
  s.pads.fruit.opening!.doneTick = 1; // Handoff must precede even completion on this tick.
  const before = structuredClone(s);
  const result = sim.step(
    s,
    new Map([
      [
        0,
        {
          ...idle,
          open: true,
          switchNext: true,
          classPick: { classId: 'ninja', snapshot: JSON.stringify(s.pads.fruit.cells) },
        },
      ],
    ]),
  );
  expect(result.pads.fruit.opening).toBeNull();
  expect(result.pads.fruit.cells).toEqual(before.pads.fruit.cells);
  expect(result.crates).toEqual(before.crates);
  expect(result.units).toHaveLength(2);
  expect(result.events).toContainEqual({ tick: 1, kind: 'openCancelled', team: 'fruit' });
  expect(result.events).toContainEqual({
    tick: 1,
    kind: 'controlSwitched',
    fromUnitId: 0,
    toUnitId: 1,
    team: 'fruit',
  });
  expect(s).toEqual(before);
  // Neither an ordinary channel nor another body's class channel is cancelled.
  for (const ordinary of [false, true]) {
    const other = structuredClone(before);
    if (ordinary) delete other.pads.fruit.opening!.classId;
    else other.pads.fruit.opening!.byUnit = 1;
    const padBefore = structuredClone(other.pads);
    expect(sim.switchControl(other, 0)).toBe(1);
    expect(other.pads).toEqual(padBefore);
  }
});

it('all_bot_and_match_over_are_unchanged', () => {
  const allBot = sim.createMatch(1, { humanUnit: null });
  const before = structuredClone(allBot);
  expect(sim.controlledUnit(allBot)).toBeNull();
  expect(sim.nextLivingTeammate(allBot, 0)).toBeNull();
  expect(sim.switchControl(allBot, 0)).toBeNull();
  expect(allBot).toEqual(before);
  expect(
    sim.step(allBot, new Map(allBot.units.map((u) => [u.id, { ...idle, switchNext: true }]))),
  ).toEqual(sim.step(allBot, new Map()));
  const over = bodies();
  over.winner = 'fruit';
  const copy = structuredClone(over);
  expect(sim.switchControl(over, 0)).toBeNull();
  expect(over).toEqual(copy);
  expect(sim.step(over, new Map([[0, { ...idle, switchNext: true }]]))).toEqual({
    ...copy,
    tick: 1,
    events: [],
  });
});

it('death_does_not_auto_switch_control', () => {
  const s = bodies();
  s.units[0]!.hp = 1;
  s.projectiles.push({
    id: 90,
    team: 'dessert',
    kind: 'bomb',
    pos: { ...s.units[0]!.pos },
    vel: { x: 0, y: 0 },
    ttlTicks: 1,
  });
  const result = sim.step(s, new Map());
  expect(byId(result, 0).hp).toBe(0);
  expect(byId(result, 0).deadUntilTick).not.toBeNull();
  expect(sim.controlledUnit(result)?.id).toBe(0);
  expect(result.events.some((e) => e.kind === 'controlSwitched')).toBe(false);
});

it('switch_death_and_recruitment_tape_replays_full_states_and_hashes', () => {
  const initial = bodies();
  initial.units.push({
    ...structuredClone(initial.units[1]!),
    id: 3,
    team: 'dessert',
    pos: { x: 32, y: 14 },
  });
  initial.units[0]!.hp = 1;
  initial.units[1]!.pos = sim.padCellCenter(initial.pads.fruit, 0);
  padCrates(initial, [0, 1], true);
  initial.projectiles.push({
    id: 90,
    team: 'dessert',
    kind: 'bomb',
    pos: { ...initial.units[0]!.pos },
    vel: { x: 0, y: 0 },
    ttlTicks: 2,
  });
  const recording: (readonly [UnitId, UnitInput])[][] = [
    [[0, { ...idle, switchNext: true }]],
    [
      [
        1,
        {
          ...idle,
          open: true,
          classPick: { classId: 'ninja', snapshot: JSON.stringify(initial.pads.fruit.cells) },
        },
      ],
    ],
    ...Array.from({ length: sim.OPEN_TICKS }, () => []),
    [[1, { ...idle, switchNext: true }]],
    ...Array.from({ length: sim.RESPAWN_TICKS + 2 }, () => []),
  ];
  const captured = JSON.stringify(recording);
  const tape = JSON.parse(captured) as typeof recording;
  const replay = () => {
    let state = initial;
    const states: MatchState[] = [];
    const hashes: string[] = [];
    for (const frame of tape) {
      const inputs = new Map(frame);
      const inputCopy = structuredClone(inputs);
      const before = structuredClone(state);
      const source = state;
      state = sim.step(source, inputs);
      expect(source).toEqual(before);
      expect(inputs).toEqual(inputCopy);
      states.push(state);
      hashes.push(sim.stateHash(state));
    }
    return { states, hashes };
  };
  const first = replay();
  expect(replay()).toEqual(first);
  expect(JSON.stringify(tape)).toBe(captured);
  const events = first.states.flatMap((s) => s.events);
  const recruit = events.find((e) => e.kind === 'opened' && e.recipe === 'class');
  expect(recruit).toMatchObject({ classId: 'ninja', unitId: 1 });
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: 'controlSwitched',
      fromUnitId: 1,
      toUnitId: recruit!.spawnedUnitId,
    }),
  );
  expect(events).toContainEqual(expect.objectContaining({ kind: 'death', unitId: 0 }));
  expect(events).toContainEqual(expect.objectContaining({ kind: 'respawn', unitId: 0 }));
  expect(first.states[1]!.events).not.toContainEqual(
    expect.objectContaining({ kind: 'controlSwitched' }),
  );
  for (const state of first.states) expect(state.units.filter((u) => !u.isBot)).toHaveLength(1);
});
