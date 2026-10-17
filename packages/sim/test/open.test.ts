import { describe, expect, it } from 'vitest';
import {
  BOMBS_PER_RECIPE,
  OPEN_TICKS,
  SUPER_BUDDY_MAX_HP,
  TEAM_CAP,
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

/**
 * These tests script every unit's input directly, so all starting units are
 * pinned non-bot: step() must not let a bot override a scripted input
 * (T5 rework decision A: keep the override semantics).
 */
function pinNoBots(s: MatchState): MatchState {
  for (const unit of s.units) unit.isBot = false;
  return s;
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
  const s = pinNoBots(createMatch(5));
  putOnPad(s, 'fruit', 0, 0, 100);
  unitAt(s, 0, must(COL_CENTERS[0]));
  return s;
}

function bombsMatch(): MatchState {
  const s = pinNoBots(createMatch(5));
  putOnPad(s, 'fruit', 0, 0, 100);
  putOnPad(s, 'fruit', 1, 0, 101);
  unitAt(s, 0, must(COL_CENTERS[0]));
  return s;
}

function buddyMatch(): MatchState {
  const s = pinNoBots(createMatch(5));
  putOnPad(s, 'fruit', 1, 0, 100);
  putOnPad(s, 'fruit', 1, 1, 101);
  unitAt(s, 0, must(COL_CENTERS[1]));
  return s;
}

describe('R1 recipe grants', () => {
  const recipes = ['gun', 'heavy', 'bombs', 'buddy'] as const;
  type CraftRecipe = (typeof recipes)[number];

  function stage(s: MatchState, recipe: CraftRecipe, supers: number): number[] {
    const cells: [number, number][] =
      recipe === 'heavy'
        ? [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ]
        : recipe === 'buddy'
          ? [
              [0, 0],
              [0, 1],
            ]
          : recipe === 'bombs'
            ? [
                [0, 0],
                [1, 0],
              ]
            : [[0, 0]];
    const ids: number[] = [];
    for (const [i, [col, layer]] of cells.entries()) {
      const id = 10000 + s.tick * 10 + i;
      putOnPad(s, 'fruit', col, layer, id);
      must(s.crates.find((c) => c.id === id)).kind = i < supers ? 'super' : 'normal';
      ids.push(id);
    }
    unitAt(s, 0, must(COL_CENTERS[0]));
    return ids;
  }

  function complete(
    s: MatchState,
    recipe: CraftRecipe,
    quality: boolean,
    ids: number[],
  ): MatchState {
    s = step(s, new Map([[0, inp({ open: true })]]));
    expect(s.events.filter((e) => e.kind === 'openStarted')).toHaveLength(1);
    s = runTicks(s, OPEN_TICKS);
    expect(s.events.filter((e) => e.kind === 'opened')).toEqual([
      { tick: s.tick, kind: 'opened', recipe, super: quality, team: 'fruit', unitId: 0 },
    ]);
    expect(s.pads.fruit.cells).toEqual(Array.from({ length: 4 }, () => [null, null]));
    expect(s.pads.fruit.opening).toBeNull();
    expect(s.crates.filter((c) => ids.includes(c.id))).toEqual([]);
    const next = step(s, new Map());
    expect(next.events.filter((e) => e.kind === 'opened')).toHaveLength(0);
    return s;
  }

  it('every_recipe_normal_and_super_grants_correct_slot_or_buddy', () => {
    for (const recipe of recipes) {
      for (const quality of [false, true]) {
        let s = pinNoBots(createMatch(5));
        const ids = stage(s, recipe, quality ? 1 : 0);
        const beforeIds = s.units.map((u) => u.id);
        s = complete(s, recipe, quality, ids);
        const opener = must(s.units[0]);
        if (recipe === 'gun' || recipe === 'heavy') {
          expect(opener.gun).toEqual(
            recipe === 'heavy'
              ? { kind: 'heavy', super: quality, ammoCooldownTicks: 0 }
              : quality
                ? { kind: 'gun', super: true, ammoCooldownTicks: 0 }
                : { ammoCooldownTicks: 0 },
          );
          expect(opener.bombs).toBe(0);
          expect(opener.bombsSuper ?? false).toBe(false);
        } else if (recipe === 'bombs') {
          expect(opener.bombs).toBe(quality ? 5 : 3);
          expect(opener.bombsSuper).toBe(quality);
          expect(opener.gun).toBeNull();
        } else {
          const fresh = s.units.filter((u) => !beforeIds.includes(u.id));
          expect(fresh).toHaveLength(1);
          expect(must(fresh[0])).toMatchObject({
            team: 'fruit',
            isBot: true,
            hp: quality ? SUPER_BUDDY_MAX_HP : UNIT_MAX_HP,
            gun: null,
            bombs: 0,
          });
          expect(must(fresh[0]).superBuddy ?? false).toBe(quality);
          expect(opener.gun).toBeNull();
          expect(opener.bombs).toBe(0);
        }
        expect(s.units).toHaveLength(recipe === 'buddy' ? 7 : 6);
        expect(opener.superBuddy ?? false).toBe(false);
      }
    }
  });

  it('gun_heavy_replace_both_ways_and_normal_downgrades', () => {
    for (const from of ['gun', 'heavy'] as const) {
      for (const recipe of ['gun', 'heavy'] as const) {
        for (const quality of [false, true]) {
          let s = pinNoBots(createMatch(5));
          const opener = must(s.units[0]);
          opener.gun = { kind: from, super: true, ammoCooldownTicks: 100 };
          opener.bombs = 2;
          opener.bombsSuper = true;
          opener.superBuddy = true;
          const ids = stage(s, recipe, quality ? 1 : 0);
          s = complete(s, recipe, quality, ids);
          expect(must(s.units[0]).gun).toEqual(
            recipe === 'heavy'
              ? { kind: 'heavy', super: quality, ammoCooldownTicks: 0 }
              : quality
                ? { kind: 'gun', super: true, ammoCooldownTicks: 0 }
                : { ammoCooldownTicks: 0 },
          );
          expect(must(s.units[0])).toMatchObject({ bombs: 2, bombsSuper: true, superBuddy: true });
        }
      }
    }
  });

  it('bomb_stock_is_replaced_not_added_and_keeps_weapon', () => {
    for (const kind of ['gun', 'heavy'] as const) {
      for (const quality of [false, true]) {
        for (const stock of [0, 1, 5]) {
          let s = pinNoBots(createMatch(5));
          Object.assign(must(s.units[0]), {
            gun: { kind, super: true, ammoCooldownTicks: 100 },
            bombs: stock,
            bombsSuper: !quality,
            superBuddy: true,
          });
          const ids = stage(s, 'bombs', quality ? 2 : 0); // multiple supers still grants five
          s = complete(s, 'bombs', quality, ids);
          expect(must(s.units[0])).toMatchObject({
            bombs: quality ? 5 : 3,
            bombsSuper: quality,
            superBuddy: true,
          });
          expect(must(s.units[0]).gun).toEqual({
            kind,
            super: true,
            ammoCooldownTicks: 100 - OPEN_TICKS - 1,
          });
        }
      }
    }
  });

  it('super_buddy_only_marks_new_unit', () => {
    let s = pinNoBots(createMatch(5));
    Object.assign(must(s.units[0]), {
      gun: { kind: 'heavy', super: true, ammoCooldownTicks: 0 },
      bombs: 2,
      bombsSuper: true,
    });
    const ids = stage(s, 'buddy', 2);
    s = complete(s, 'buddy', true, ids);
    expect(s.units.slice(0, 6).map((u) => u.superBuddy ?? false)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(must(s.units[0])).toMatchObject({
      gun: { kind: 'heavy', super: true, ammoCooldownTicks: 0 },
      bombs: 2,
      bombsSuper: true,
    });
    expect(must(s.units[6])).toMatchObject({
      hp: SUPER_BUDDY_MAX_HP,
      superBuddy: true,
      gun: null,
      bombs: 0,
    });
  });

  it('lift_super_on_done_tick_cancels_without_consuming', () => {
    let s = pinNoBots(createMatch(5));
    const ids = stage(s, 'heavy', 1);
    s = step(s, new Map([[0, inp({ open: true })]]));
    expect(s.pads.fruit.opening).not.toBeNull();
    expect(must(s.pads.fruit.opening).snapshot).toBe(JSON.stringify(s.pads.fruit.cells));
    s = runTicks(s, OPEN_TICKS - 1);
    unitAt(s, 1, must(COL_CENTERS[0]));
    s = step(s, new Map([[1, inp({ pickDrop: true })]]));
    expect(s.events.filter((e) => e.kind === 'openCancelled')).toHaveLength(1);
    expect(s.events.filter((e) => e.kind === 'opened')).toHaveLength(0);
    expect(s.pads.fruit.opening).toBeNull();
    expect(must(s.units[0]).gun).toBeNull();
    expect(must(s.units[1]).carrying).toBe(ids[0]);
    expect(s.crates.filter((c) => ids.includes(c.id))).toHaveLength(4);
    expect(s.crates.find((c) => c.id === ids[0])).toMatchObject({
      state: 'carried',
      kind: 'super',
    });
    expect(s.pads.fruit.cells.flat().filter((id) => id !== null)).toEqual(ids.slice(1));
    s = runTicks(s, 2);
    expect(must(s.units[0]).gun).toBeNull();
  });

  it('heavy_ban_fails_closed_super_ban_grants_normal', () => {
    let s = pinNoBots(createMatch(5));
    const ids = stage(s, 'heavy', 1);
    s.itemBans = { fruit: ['heavy'] };
    s = step(s, new Map([[0, inp({ open: true })]]));
    expect(s.events.some((e) => e.kind === 'openStarted')).toBe(false);
    // A stale/injected opening must also fail closed at completion, before clearing.
    s.pads.fruit.opening = {
      byUnit: 0,
      doneTick: s.tick + 1,
      snapshot: JSON.stringify(s.pads.fruit.cells),
    };
    s = step(s, new Map());
    expect(s.events.filter((e) => e.kind === 'openCancelled')).toHaveLength(1);
    expect(s.events.some((e) => e.kind === 'opened')).toBe(false);
    expect(s.crates.filter((c) => ids.includes(c.id))).toHaveLength(4);
    expect(s.pads.fruit.cells.flat().filter((id) => id !== null)).toEqual(ids);
    expect(must(s.units[0]).gun).toBeNull();
    for (const recipe of recipes) {
      let normal = pinNoBots(createMatch(5));
      const normalIds = stage(normal, recipe, 1);
      normal.itemBans = { fruit: ['super'] };
      normal = complete(normal, recipe, false, normalIds);
      const opener = must(normal.units[0]);
      if (recipe === 'gun') expect(opener.gun).toEqual({ ammoCooldownTicks: 0 });
      if (recipe === 'heavy')
        expect(opener.gun).toEqual({ kind: 'heavy', super: false, ammoCooldownTicks: 0 });
      if (recipe === 'bombs') expect(opener).toMatchObject({ bombs: 3, bombsSuper: false });
      if (recipe === 'buddy') {
        expect(must(normal.units[6]).superBuddy ?? false).toBe(false);
        expect(must(normal.units[6]).hp).toBe(UNIT_MAX_HP);
      }
    }
  });

  it('buddy cap reached during opening cancels without consuming even dead teammates', () => {
    let s = pinNoBots(createMatch(5));
    const ids = stage(s, 'buddy', 1);
    s = step(s, new Map([[0, inp({ open: true })]]));
    extraUnit(s, 90, 'fruit').isBot = false;
    const dead = extraUnit(s, 91, 'fruit');
    dead.deadUntilTick = 999;
    dead.isBot = false;
    s = runTicks(s, OPEN_TICKS);
    expect(s.units.filter((u) => u.team === 'fruit')).toHaveLength(TEAM_CAP);
    expect(s.events.filter((e) => e.kind === 'openCancelled')).toHaveLength(1);
    expect(s.events.some((e) => e.kind === 'opened')).toBe(false);
    expect(s.pads.fruit.opening).toBeNull();
    expect(s.pads.fruit.cells.flat().filter((id) => id !== null)).toEqual(ids);
    expect(s.crates.filter((c) => ids.includes(c.id))).toHaveLength(2);
  });
});

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
    const s0 = pinNoBots(createMatch(5));
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
