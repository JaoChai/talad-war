import { describe, expect, it } from 'vitest';
import {
  PICK_RADIUS,
  TEAM_CAP,
  canOpen,
  createMatch,
  liftTop,
  matchRecipe,
  padCellAt,
  padPreview,
  recipeResult,
  step,
} from '../src/index';
import type { CrateId, MatchState, Pad, Team, Unit, UnitId, UnitInput, Vec2 } from '../src/index';

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

/** Fruit pad (8,18)-(11,21), 2x2 floor cells of 1.5: col centers, col = cellX + 2*cellY. */
const COL_CENTERS: Vec2[] = [
  { x: 8.75, y: 18.75 }, // col 0
  { x: 10.25, y: 18.75 }, // col 1
  { x: 8.75, y: 20.25 }, // col 2
  { x: 10.25, y: 20.25 }, // col 3
];
const DESSERT_COL0: Vec2 = { x: 29.75, y: 3.75 };
/** Ground point just west of the fruit pad, within PICK_RADIUS of col 0's center. */
const CRATE_NEAR_COL0: Vec2 = { x: 8 - 0.05, y: 18.75 };

function cell(s: MatchState, team: Team, col: number, layer: number): CrateId | null {
  return must(s.pads[team].cells[col])[layer] ?? null;
}

function unitAt(s: MatchState, unitId: UnitId, pos: Vec2): Unit {
  const unit = must(s.units.find((u) => u.id === unitId));
  unit.pos = { ...pos };
  return unit;
}

function giveCarriedCrate(s: MatchState, unitId: UnitId, crateId: CrateId): void {
  const unit = must(s.units.find((u) => u.id === unitId));
  unit.carrying = crateId;
  s.crates.push({ id: crateId, pos: { ...unit.pos }, state: 'carried', landTick: 0 });
}

function putOnPad(s: MatchState, team: Team, col: number, layer: number, crateId: CrateId): void {
  must(s.pads[team].cells[col])[layer] = crateId;
  s.crates.push({ id: crateId, pos: { x: 0, y: 0 }, state: 'onPad', landTick: 0 });
}

/** A bare pad with the given [col, layer] cells filled (ids are irrelevant). */
function padWith(entries: [col: number, layer: number][]): Pad {
  const pad = createMatch(1).pads.fruit;
  for (const [col, layer] of entries) must(pad.cells[col])[layer] = 100 + col * 2 + layer;
  return pad;
}

function extraUnit(s: MatchState, id: UnitId, team: Team): Unit {
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

describe('pad columns', () => {
  it('padCellAt maps the 2x2 floor onto cols 0..3 and null outside', () => {
    const pad = createMatch(1).pads.fruit;
    expect(padCellAt(pad, must(COL_CENTERS[0]))).toBe(0);
    expect(padCellAt(pad, must(COL_CENTERS[1]))).toBe(1);
    expect(padCellAt(pad, must(COL_CENTERS[2]))).toBe(2);
    expect(padCellAt(pad, must(COL_CENTERS[3]))).toBe(3);
    expect(padCellAt(pad, { x: 8, y: 18 })).toBe(0); // inclusive origin corner
    expect(padCellAt(pad, { x: 11, y: 21 })).toBe(3); // inclusive far corner
    expect(padCellAt(pad, { x: 7.9, y: 18.75 })).toBeNull(); // west of the pad
    expect(padCellAt(pad, DESSERT_COL0)).toBeNull(); // the other team's pad
  });

  it('placing: empty col -> ground layer, again -> upper layer', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(COL_CENTERS[0]));
    giveCarriedCrate(s0, 0, 100);
    const s1 = step(s0, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s1.units[0]).carrying).toBeNull();
    expect(cell(s1, 'fruit', 0, 0)).toBe(100);
    expect(cell(s1, 'fruit', 0, 1)).toBeNull();
    expect(must(s1.crates.find((c) => c.id === 100)).state).toBe('onPad');
    expect(must(s1.crates.find((c) => c.id === 100)).pos).toEqual(COL_CENTERS[0]);

    giveCarriedCrate(s1, 0, 101);
    const s2 = step(s1, new Map([[0, inp({ pickDrop: true })]]));
    expect(cell(s2, 'fruit', 0, 1)).toBe(101);
    expect(cell(s2, 'fruit', 0, 0)).toBe(100);
  });

  it('placing into a full column: no-op, padFull event, crate stays carried', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(COL_CENTERS[0]));
    putOnPad(s0, 'fruit', 0, 0, 100);
    putOnPad(s0, 'fruit', 0, 1, 101);
    giveCarriedCrate(s0, 0, 102);

    const s = step(s0, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBe(102); // still carried
    expect(cell(s, 'fruit', 0, 0)).toBe(100);
    expect(cell(s, 'fruit', 0, 1)).toBe(101);
    expect(s.events.some((e) => e.kind === 'padFull')).toBe(true);
  });

  it('empty-handed pickDrop on an occupied own cell lifts the top crate', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(COL_CENTERS[0]));
    putOnPad(s0, 'fruit', 0, 0, 100);
    putOnPad(s0, 'fruit', 0, 1, 101);

    const s = step(s0, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBe(101); // upper crate first
    expect(cell(s, 'fruit', 0, 1)).toBeNull();
    expect(cell(s, 'fruit', 0, 0)).toBe(100);
    expect(must(s.crates.find((c) => c.id === 101)).state).toBe('carried');
  });

  it('liftTop empties a column top-down and returns null when empty', () => {
    const pad = padWith([
      [0, 0],
      [0, 1],
    ]);
    expect(liftTop(pad, 0)).toBe(101); // upper crate id: 100 + 0*2 + 1
    expect(liftTop(pad, 0)).toBe(100); // then the ground crate: 100 + 0*2 + 0
    expect(liftTop(pad, 0)).toBeNull();
    expect(must(pad.cells[0])).toEqual([null, null]);
  });

  it('an empty own pad column still allows the ground pick preserved from T2', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(COL_CENTERS[0]));
    s0.crates.push({
      id: 101,
      pos: { ...CRATE_NEAR_COL0 },
      state: 'ground',
      landTick: 0,
    });
    expect(Math.hypot(must(COL_CENTERS[0]).x - CRATE_NEAR_COL0.x, 0)).toBeLessThan(PICK_RADIUS);

    const s = step(s0, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBe(101);
    expect(cell(s, 'fruit', 0, 0)).toBeNull();
  });

  it('lift takes priority over picking a ground crate on an occupied own cell', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(COL_CENTERS[0]));
    putOnPad(s0, 'fruit', 0, 0, 100);
    s0.crates.push({ id: 101, pos: { ...CRATE_NEAR_COL0 }, state: 'ground', landTick: 0 });

    const s = step(s0, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBe(100); // the pad crate, not the ground one
    expect(must(s.crates.find((c) => c.id === 101)).state).toBe('ground');
  });

  it('carrying on an enemy pad cell: nothing happens (no stealing in v1)', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(DESSERT_COL0)); // fruit unit on the dessert pad
    giveCarriedCrate(s0, 0, 100);

    const s = step(s0, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBe(100);
    expect(must(s.crates.find((c) => c.id === 100)).state).toBe('carried');
    expect(cell(s, 'dessert', 0, 0)).toBeNull();
    expect(cell(s, 'dessert', 0, 1)).toBeNull();
    expect(s.events.some((e) => e.kind === 'padFull')).toBe(false);
  });

  it('empty-handed on an enemy pad cell: no lift and no ground pick either', () => {
    const s0 = createMatch(5);
    unitAt(s0, 0, must(DESSERT_COL0));
    putOnPad(s0, 'dessert', 0, 0, 100);
    s0.crates.push({ id: 101, pos: { x: 29 - 0.1, y: 3.75 }, state: 'ground', landTick: 0 });

    const s = step(s0, new Map([[0, inp({ pickDrop: true })]]));
    expect(must(s.units[0]).carrying).toBeNull();
    expect(cell(s, 'dessert', 0, 0)).toBe(100);
    expect(must(s.crates.find((c) => c.id === 101)).state).toBe('ground');
    expect(s.events.some((e) => e.kind === 'cratePick')).toBe(false);
  });
});

describe('matchRecipe', () => {
  it('one crate anywhere matches gun', () => {
    expect(matchRecipe(padWith([[2, 0]]))).toBe('gun');
    expect(matchRecipe(padWith([[3, 0]]))).toBe('gun');
  });

  it('two ground crates in adjacent cols match bombs (0-1, 2-3, 0-2, 1-3)', () => {
    expect(
      matchRecipe(
        padWith([
          [0, 0],
          [1, 0],
        ]),
      ),
    ).toBe('bombs');
    expect(
      matchRecipe(
        padWith([
          [2, 0],
          [3, 0],
        ]),
      ),
    ).toBe('bombs');
    expect(
      matchRecipe(
        padWith([
          [0, 0],
          [2, 0],
        ]),
      ),
    ).toBe('bombs');
    expect(
      matchRecipe(
        padWith([
          [1, 0],
          [3, 0],
        ]),
      ),
    ).toBe('bombs');
  });

  it('one column with two layers matches buddy', () => {
    expect(
      matchRecipe(
        padWith([
          [1, 0],
          [1, 1],
        ]),
      ),
    ).toBe('buddy');
  });

  it('diagonal pairs (0-3, 1-2), three crates and empty match null; four flat matches heavy', () => {
    expect(
      matchRecipe(
        padWith([
          [0, 0],
          [3, 0],
        ]),
      ),
    ).toBeNull();
    expect(
      matchRecipe(
        padWith([
          [1, 0],
          [2, 0],
        ]),
      ),
    ).toBeNull();
    expect(
      matchRecipe(
        padWith([
          [0, 0],
          [0, 1],
          [1, 0],
        ]),
      ),
    ).toBeNull();
    expect(
      matchRecipe(
        padWith([
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ]),
      ),
    ).toBe('heavy');
    expect(matchRecipe(padWith([]))).toBeNull();
  });
});

describe('padPreview', () => {
  it('an empty pad previews {openable:false, reason:"empty", recipe:null}', () => {
    const s = createMatch(5);
    expect(padPreview(s, 'fruit')).toEqual({
      openable: false,
      reason: 'empty',
      recipe: null,
      super: false,
    });
  });

  it('a non-recipe arrangement previews notRecipe', () => {
    const s = createMatch(5);
    putOnPad(s, 'fruit', 0, 0, 100);
    putOnPad(s, 'fruit', 3, 0, 101); // diagonal
    expect(padPreview(s, 'fruit')).toEqual({
      openable: false,
      reason: 'notRecipe',
      recipe: null,
      super: false,
    });
  });

  it('gun and bombs recipes are openable', () => {
    const s = createMatch(5);
    putOnPad(s, 'fruit', 0, 0, 100);
    expect(padPreview(s, 'fruit')).toEqual({ recipe: 'gun', openable: true, super: false });

    putOnPad(s, 'fruit', 1, 0, 101);
    expect(padPreview(s, 'fruit')).toEqual({ recipe: 'bombs', openable: true, super: false });
  });

  it('buddy at the team cap previews {openable:false, reason:"teamFull"} counting alive and dead', () => {
    const s = createMatch(5);
    putOnPad(s, 'fruit', 1, 0, 100);
    putOnPad(s, 'fruit', 1, 1, 101);
    expect(padPreview(s, 'fruit')).toEqual({ recipe: 'buddy', openable: true, super: false });

    extraUnit(s, 10, 'fruit'); // 4 fruit units
    extraUnit(s, 11, 'fruit'); // 5 = TEAM_CAP
    must(s.units[0]).deadUntilTick = 999; // dead still counts
    expect(s.units.filter((u) => u.team === 'fruit').length).toBe(TEAM_CAP);
    expect(padPreview(s, 'fruit')).toEqual({
      recipe: 'buddy',
      openable: false,
      reason: 'teamFull',
      super: false,
    });
  });
});

describe('R1 recipe shapes and quality', () => {
  it('all 256 masks preserve the v1 oracle except the four-ground heavy', () => {
    // Frozen pre-R1 matcher, including legacy floating one/two-cell fixtures.
    function v1(pad: Pad): 'gun' | 'bombs' | 'buddy' | null {
      const ground: number[] = [];
      let count = 0;
      let upper = false;
      for (const [col, cells] of pad.cells.entries()) {
        if (cells[0] !== null) {
          count++;
          ground.push(col);
        }
        if (cells[1] !== null) {
          count++;
          upper = true;
        }
      }
      if (count === 1) return 'gun';
      if (count !== 2) return null;
      if (upper) return 'buddy';
      const a = must(ground[0]);
      const b = must(ground[1]);
      return Math.abs((a % 2) - (b % 2)) + Math.abs(Math.floor(a / 2) - Math.floor(b / 2)) === 1
        ? 'bombs'
        : null;
    }
    for (let mask = 0; mask < 256; mask++) {
      const entries: [number, number][] = [];
      for (let bit = 0; bit < 8; bit++) {
        if (mask & (1 << bit)) entries.push([Math.floor(bit / 2), bit % 2]);
      }
      const pad = padWith(entries);
      expect(matchRecipe(pad), `mask ${mask}`).toBe(mask === 85 ? 'heavy' : v1(pad));
    }
  });

  it('both wall orientations and four with upper cells are not heavy recipes', () => {
    for (const cols of [
      [0, 1],
      [0, 2],
      [2, 3],
      [1, 3],
    ]) {
      const entries: [number, number][] = cols.flatMap((col): [number, number][] => [
        [col, 0],
        [col, 1],
      ]);
      expect(matchRecipe(padWith(entries))).toBeNull();
    }
    expect(
      matchRecipe(
        padWith([
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 1],
        ]),
      ),
    ).toBeNull();
  });

  it('preview_super_is_or_not_count_and_teamFull_keeps_quality', () => {
    const s = createMatch(1);
    s.pads.fruit.cells = [
      [100, null],
      [101, null],
      [102, null],
      [103, null],
    ];
    // Missing records are normal; unrelated super crates must not contaminate the result.
    s.crates = [{ id: 999, kind: 'super', state: 'onPad', pos: { x: 0, y: 0 }, landTick: 0 }];
    expect(recipeResult(s, 'fruit')).toEqual({ recipe: 'heavy', super: false });
    for (const id of [100, 101]) {
      s.crates.push({ id, kind: 'super', state: 'onPad', pos: { x: 0, y: 0 }, landTick: 0 });
      expect(recipeResult(s, 'fruit')).toEqual({ recipe: 'heavy', super: true });
      expect(padPreview(s, 'fruit')).toEqual({ recipe: 'heavy', super: true, openable: true });
    }
    s.itemBans = { dessert: ['heavy', 'super'] };
    expect(recipeResult(s, 'fruit')).toEqual({ recipe: 'heavy', super: true });
    s.itemBans = { fruit: ['super'] };
    expect(padPreview(s, 'fruit')).toEqual({ recipe: 'heavy', super: false, openable: true });
    expect(s.crates.filter((c) => c.kind === 'super')).toHaveLength(3);
    s.itemBans = { fruit: ['heavy'] };
    expect(recipeResult(s, 'fruit')).toBeNull();
    expect(padPreview(s, 'fruit')).toEqual({
      recipe: null,
      super: false,
      openable: false,
      reason: 'notRecipe',
    });
    unitAt(s, 0, must(COL_CENTERS[0]));
    expect(canOpen(s, 0)).toBe(false);
    s.pads.fruit.cells = [
      [100, 101],
      [null, null],
      [null, null],
      [null, null],
    ];
    extraUnit(s, 10, 'fruit');
    extraUnit(s, 11, 'fruit').deadUntilTick = 999;
    expect(padPreview(s, 'fruit')).toEqual({
      recipe: 'buddy',
      super: true,
      openable: false,
      reason: 'teamFull',
    });
    s.itemBans = { fruit: ['super'] };
    expect(padPreview(s, 'fruit')).toEqual({
      recipe: 'buddy',
      super: false,
      openable: false,
      reason: 'teamFull',
    });
    expect(canOpen(s, 0)).toBe(false);
  });
});

describe('canOpen', () => {
  function openableMatch(): MatchState {
    const s = createMatch(5);
    putOnPad(s, 'fruit', 0, 0, 100);
    unitAt(s, 0, must(COL_CENTERS[0]));
    return s;
  }

  it('is true standing on the own pad with a recipe, empty hands and no opening', () => {
    expect(canOpen(openableMatch(), 0)).toBe(true);
  });

  it('is false while carrying, off the pad, or on the enemy pad', () => {
    const carrying = openableMatch();
    giveCarriedCrate(carrying, 0, 102);
    expect(canOpen(carrying, 0)).toBe(false);

    const offPad = openableMatch();
    unitAt(offPad, 0, { x: 5, y: 20 });
    expect(canOpen(offPad, 0)).toBe(false);

    const onEnemyPad = openableMatch();
    unitAt(onEnemyPad, 0, must(DESSERT_COL0));
    expect(canOpen(onEnemyPad, 0)).toBe(false);
  });

  it('is false when dead or when an opening is already running', () => {
    const dead = openableMatch();
    must(dead.units[0]).deadUntilTick = 999;
    expect(canOpen(dead, 0)).toBe(false);

    const busy = openableMatch();
    busy.pads.fruit.opening = { byUnit: 1, doneTick: 10, snapshot: '[]' };
    expect(canOpen(busy, 0)).toBe(false);
  });
});
