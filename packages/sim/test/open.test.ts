import { describe, expect, it } from 'vitest';
import {
  BOMBS_PER_RECIPE,
  OPEN_TICKS,
  UNIT_MAX_HP,
  createMatch,
  step,
  stallCenter,
} from '../src/index';
import type { CrateId, MatchState, Team, Unit, UnitInput, Vec2 } from '../src/index';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function inp(over: Partial<UnitInput> = {}): UnitInput {
  return {
    move: { x: 0, y: 0 },
    aim: null,
    fire: false,
    throwBomb: false,
    pickDrop: false,
    open: false,
    ...over,
  };
}

/** Fruit pad (8,18)-(11,21): col = cellX + 2*cellY. */
const COL_CENTERS: Vec2[] = [
  { x: 8.75, y: 18.75 }, // col 0
  { x: 10.25, y: 18.75 }, // col 1
];

function cell(s: MatchState, team: Team, col: number, layer: number): CrateId | null {
  return must(s.pads[team].cells[col])[layer] ?? null;
}

function unitAt(s: MatchState, unitId: number, pos: Vec2): Unit {
  const unit = must(s.units.find((u) => u.id === unitId));
  unit.pos = { ...pos };
  return unit;
}

function giveCarriedCrate(s: MatchState, unitId: number, crateId: CrateId): void {
  const unit = must(s.units.find((u) => u.id === unitId));
  unit.carrying = crateId;
  s.crates.push({ id: crateId, pos: { ...unit.pos }, state: 'carried', landTick: 0 });
}

function putOnPad(s: MatchState, team: Team, col: number, layer: number, crateId: CrateId): void {
  must(s.pads[team].cells[col])[layer] = crateId;
  s.crates.push({ id: crateId, pos: { x: 0, y: 0 }, state: 'onPad', landTick: 0 });
}

function extraUnit(s: MatchState, id: number, team: Team): Unit {
  const unit: Unit = {
    id,
    team,
    isBot: true,
    pos: { x: 20, y: 12 },
    facing: { x: 1, y: 0 },
    hp: 100,
    carrying: null,
    gun: null,
    bombs: 0,
    attackCooldownTicks: 0,
    deadUntilTick: null,
  };
  s.units.push(unit);
  return unit;
}

function runTicks(s: MatchState, ticks: number): MatchState {
  for (let i = 0; i < ticks; i++) s = step(s, new Map());
  return s;
}

/** Fruit pad with a gun recipe on col 0, unit 0 standing there, empty-handed. */
function gunMatch(): MatchState {
  const s = createMatch(5);
  putOnPad(s, 'fruit', 0, 0, 100);
  unitAt(s, 0, must(COL_CENTERS[0]));
  return s;
}

function bombsMatch(): MatchState {
  const s = createMatch(5);
  putOnPad(s, 'fruit', 0, 0, 100);
  putOnPad(s, 'fruit', 1, 0, 101);
  unitAt(s, 0, must(COL_CENTERS[0]));
  return s;
}

function buddyMatch(): MatchState {
  const s = createMatch(5);
  putOnPad(s, 'fruit', 1, 0, 100);
  putOnPad(s, 'fruit', 1, 1, 101);
  unitAt(s, 0, must(COL_CENTERS[1]));
  return s;
}

describe('the Open! channel', () => {
  it('an open input with canOpen starts an opening with doneTick = tick + OPEN_TICKS', () => {
    let s = gunMatch();
    s = step(s, new Map([[0, inp({ open: true })]]));
    expect(s.tick).toBe(1);
    const opening = must(s.pads.fruit.opening);
    expect(opening.byUnit).toBe(0);
    expect(opening.doneTick).toBe(1 + OPEN_TICKS);
    expect(opening.snapshot).toBe(JSON.stringify(s.pads.fruit.cells));
    expect(s.events.some((e) => e.kind === 'openStarted')).toBe(true);
  });

  it('a gun recipe grants the opener a fresh gun after OPEN_TICKS and empties the pad', () => {
    let s = gunMatch();
    s = step(s, new Map([[0, inp({ open: true })]])); // tick 1, doneTick 1 + OPEN_TICKS
    s = runTicks(s, OPEN_TICKS - 1); // one tick before doneTick
    expect(must(s.units[0]).gun).toBeNull();
    expect(s.pads.fruit.opening).not.toBeNull();

    s = step(s, new Map()); // doneTick reached
    expect(must(s.units[0]).gun).toEqual({ ammoCooldownTicks: 0 });
    expect(s.pads.fruit.opening).toBeNull();
    expect(cell(s, 'fruit', 0, 0)).toBeNull();
    expect(s.crates.some((c) => c.id === 100)).toBe(false);
    expect(must(s.events.find((e) => e.kind === 'opened')).recipe).toBe('gun');
  });

  it('a gun replaces an older gun', () => {
    let s = gunMatch();
    must(s.units[0]).gun = { ammoCooldownTicks: 7 };
    s = step(s, new Map([[0, inp({ open: true })]]));
    s = runTicks(s, OPEN_TICKS);
    expect(must(s.units[0]).gun).toEqual({ ammoCooldownTicks: 0 });
  });

  it('a bombs recipe refills to BOMBS_PER_RECIPE (not adds) and keeps the gun', () => {
    let s = bombsMatch();
    must(s.units[0]).bombs = 1;
    // Task 4 decays gun cooldowns passively: 25 - 21 ticks of this script = 4,
    // so the pinned value below still proves the gun is KEPT, not replaced.
    must(s.units[0]).gun = { ammoCooldownTicks: 25 };
    s = step(s, new Map([[0, inp({ open: true })]]));
    s = runTicks(s, OPEN_TICKS);
    const unit = must(s.units[0]);
    expect(unit.bombs).toBe(BOMBS_PER_RECIPE);
    expect(unit.gun).toEqual({ ammoCooldownTicks: 4 });
    expect(cell(s, 'fruit', 0, 0)).toBeNull();
    expect(cell(s, 'fruit', 1, 0)).toBeNull();
    expect(s.crates.some((c) => c.id === 100 || c.id === 101)).toBe(false);
    expect(must(s.events.find((e) => e.kind === 'opened')).recipe).toBe('bombs');
  });

  it('a buddy recipe spawns one new bot unit at the stall, empties the pad, removes its crates', () => {
    let s = buddyMatch();
    const idsBefore = s.units.map((u) => u.id);
    s = step(s, new Map([[0, inp({ open: true })]]));
    s = runTicks(s, OPEN_TICKS);

    expect(s.units.length).toBe(idsBefore.length + 1);
    const buddy = must(s.units[s.units.length - 1]);
    expect(idsBefore).not.toContain(buddy.id); // fresh unique id
    expect(s.units.filter((u) => u.id === buddy.id).length).toBe(1);
    expect(buddy.isBot).toBe(true);
    expect(buddy.team).toBe('fruit');
    expect(buddy.pos.x).toBeCloseTo(must(stallCenter('fruit')).x, 9);
    expect(buddy.pos.y).toBeCloseTo(must(stallCenter('fruit')).y - 2.8, 9); // first spawn slot
    expect(buddy.hp).toBe(UNIT_MAX_HP);
    expect(buddy.carrying).toBeNull();
    expect(buddy.gun).toBeNull();
    expect(buddy.bombs).toBe(0);
    expect(buddy.deadUntilTick).toBeNull();
    expect(cell(s, 'fruit', 1, 0)).toBeNull();
    expect(cell(s, 'fruit', 1, 1)).toBeNull();
    expect(s.crates.some((c) => c.id === 100 || c.id === 101)).toBe(false);
    expect(must(s.events.find((e) => e.kind === 'opened')).recipe).toBe('buddy');
  });

  it('placing during an opening cancels it with no item, even on the done tick', () => {
    let s = gunMatch();
    s = step(s, new Map([[0, inp({ open: true })]])); // doneTick = 1 + OPEN_TICKS
    s = runTicks(s, OPEN_TICKS - 1); // one tick before done
    unitAt(s, 1, must(COL_CENTERS[1]));
    giveCarriedCrate(s, 1, 102);

    s = step(s, new Map([[1, inp({ pickDrop: true })]])); // place on the done tick
    expect(s.pads.fruit.opening).toBeNull();
    expect(s.events.some((e) => e.kind === 'openCancelled')).toBe(true);
    expect(must(s.units[0]).gun).toBeNull(); // no item
    expect(cell(s, 'fruit', 1, 0)).toBe(102); // the placement itself still happened

    s = step(s, new Map()); // and it stays cancelled afterwards
    expect(must(s.units[0]).gun).toBeNull();
    expect(s.pads.fruit.opening).toBeNull();
  });

  it('lifting during an opening cancels it with no item', () => {
    let s = gunMatch();
    s = step(s, new Map([[0, inp({ open: true })]]));
    s = runTicks(s, 5);
    unitAt(s, 1, must(COL_CENTERS[0])); // teammate on the recipe crate's cell

    s = step(s, new Map([[1, inp({ pickDrop: true })]])); // lifts crate 100
    expect(s.pads.fruit.opening).toBeNull();
    expect(s.events.some((e) => e.kind === 'openCancelled')).toBe(true);
    expect(must(s.units[0]).gun).toBeNull();
    expect(must(s.units[1]).carrying).toBe(100);
  });

  it('the opener dying mid-open cancels it with no item', () => {
    let s = gunMatch();
    s = step(s, new Map([[0, inp({ open: true })]]));
    must(s.units[0]).deadUntilTick = s.tick + 100; // Task 4 sets this; direct state surgery

    s = step(s, new Map());
    expect(s.pads.fruit.opening).toBeNull();
    expect(s.events.some((e) => e.kind === 'openCancelled')).toBe(true);

    s = runTicks(s, OPEN_TICKS + 2); // would be long past doneTick
    expect(must(s.units[0]).gun).toBeNull();
  });

  it('buddy at the team cap: open does nothing at all', () => {
    let s = buddyMatch();
    extraUnit(s, 10, 'fruit'); // 4 fruit units
    extraUnit(s, 11, 'fruit'); // 5 = cap -> preview teamFull

    s = step(s, new Map([[0, inp({ open: true })]]));
    expect(s.pads.fruit.opening).toBeNull();
    expect(s.events.some((e) => e.kind === 'openStarted')).toBe(false);

    s = runTicks(s, OPEN_TICKS + 1);
    expect(s.units.length).toBe(8); // 6 base + 2 pushed; no buddy spawned
    expect(cell(s, 'fruit', 1, 0)).toBe(100);
    expect(cell(s, 'fruit', 1, 1)).toBe(101);
  });

  it('open wins over pickDrop in the same input when canOpen is true', () => {
    let s = gunMatch();
    s.crates.push({ id: 101, pos: { x: 7.95, y: 18.75 }, state: 'ground', landTick: 0 });

    s = step(s, new Map([[0, inp({ open: true, pickDrop: true })]]));
    expect(s.pads.fruit.opening).not.toBeNull(); // the open started
    expect(must(s.units[0]).carrying).toBeNull(); // no ground pick happened
    expect(must(s.crates.find((c) => c.id === 101)).state).toBe('ground');
    expect(cell(s, 'fruit', 0, 0)).toBe(100); // pad untouched
  });

  it('pickDrop applies when canOpen is false (carrying an empty pad)', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(COL_CENTERS[0]));
    giveCarriedCrate(s0, 0, 102);

    const s = step(s0, new Map([[0, inp({ open: true, pickDrop: true })]]));
    expect(s.pads.fruit.opening).toBeNull();
    expect(s.events.some((e) => e.kind === 'openStarted')).toBe(false);
    expect(cell(s, 'fruit', 0, 0)).toBe(102); // placed instead
    expect(must(s.units[0]).carrying).toBeNull();
  });

  it('only one opening per pad: a second simultaneous open input is ignored', () => {
    let s = gunMatch();
    unitAt(s, 1, must(COL_CENTERS[1]));
    const inputs = new Map([
      [0, inp({ open: true })],
      [1, inp({ open: true })],
    ]);

    s = step(s, inputs);
    expect(must(s.pads.fruit.opening).byUnit).toBe(0); // lower id
    expect(s.events.filter((e) => e.kind === 'openStarted').length).toBe(1);
  });
});
