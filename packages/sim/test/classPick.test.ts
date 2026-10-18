import { describe, expect, it } from 'vitest';
import * as sim from '../src/index';
import type {
  ClassPick,
  ItemBan,
  MatchState,
  Team,
  Unit,
  UnitClass,
  UnitInput,
} from '../src/index';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function input(over: Partial<UnitInput> = {}): UnitInput {
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

const WALLS = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
] as const;

function wallMatch(
  team: Team = 'fruit',
  cols: readonly number[] = WALLS[0],
  supers: readonly number[] = [],
): MatchState {
  const s = sim.createMatch(17);
  for (const u of s.units) u.isBot = false; // scripted real inputs, no bot overrides
  const pad = s.pads[team];
  let index = 0;
  for (const col of cols) {
    for (let layer = 0; layer < 2; layer++) {
      const id = 100 + index;
      must(pad.cells[col])[layer] = id;
      s.crates.push({
        id,
        pos: sim.padCellCenter(pad, col),
        state: 'onPad',
        kind: supers.includes(index) ? 'super' : 'normal',
        landTick: 0,
      });
      index++;
    }
  }
  opener(s, team).pos = sim.padCellCenter(pad, must(cols[0]));
  return s;
}

function opener(s: MatchState, team: Team = 'fruit'): Unit {
  return must(s.units.find((u) => u.team === team));
}

function pick(s: MatchState, classId: UnitClass = 'healer', team: Team = 'fruit'): ClassPick {
  return { classId, snapshot: JSON.stringify(s.pads[team].cells) };
}

function start(s: MatchState, classId: UnitClass = 'healer', team: Team = 'fruit'): MatchState {
  const next = sim.step(
    s,
    new Map([[opener(s, team).id, input({ open: true, classPick: pick(s, classId, team) })]]),
  );
  expect(next.pads[team].opening).toEqual({
    byUnit: opener(s, team).id,
    doneTick: next.tick + 20,
    snapshot: JSON.stringify(s.pads[team].cells),
    classId,
  });
  return next;
}

function ticks(s: MatchState, n: number): MatchState {
  for (let i = 0; i < n; i++) s = sim.step(s, new Map());
  return s;
}

function expectCancelled(s: MatchState): void {
  expect(s.pads.fruit.opening).toBeNull();
  expect(s.events.filter((e) => e.kind === 'openCancelled')).toEqual([
    { tick: s.tick, kind: 'openCancelled', team: 'fruit' },
  ]);
  expect(s.events.some((e) => e.kind === 'opened')).toBe(false);
  expect(s.units.some((u) => u.classId !== undefined)).toBe(false);
  expect(s.crates.filter((c) => c.id >= 100 && c.id <= 103)).toHaveLength(4);
}

function fillTeam(s: MatchState): void {
  while (s.units.filter((u) => u.team === 'fruit').length < sim.TEAM_CAP) {
    s.units.push({
      ...structuredClone(opener(s)),
      id: 90 + s.units.length,
      deadUntilTick: 999,
      hp: 0,
    });
  }
}

// Mutation targets: remove exact-wall matching, OR quality, validator, persistent pick,
// personal-HP spawn, completion guards or phase order: the assertions below must fail.
describe('class recruitment', () => {
  it('four_walls_and_each_super_position', () => {
    for (const team of ['fruit', 'dessert'] as const) {
      for (const cols of WALLS) {
        for (const supers of [[], [0], [1], [2], [3], [0, 1, 2, 3]]) {
          const s = wallMatch(team, cols, supers);
          expect(sim.matchRecipe(s.pads[team])).toBe('class');
          expect(sim.padPreview(s, team)).toEqual({
            recipe: 'class',
            super: supers.length > 0,
            openable: true,
          });
          s.crates.push({
            id: 999,
            kind: 'super',
            state: 'ground',
            pos: { x: 20, y: 12 },
            landTick: 0,
          });
          expect(sim.recipeResult(s, team)).toEqual({ recipe: 'class', super: supers.length > 0 });
          s.itemBans = { [team]: ['super'] };
          expect(sim.recipeResult(s, team)).toEqual({ recipe: 'class', super: false });
          expect(s.crates.filter((c) => c.kind === 'super')).toHaveLength(supers.length + 1);
        }
      }
    }
  });

  it('choice_required_and_each_class_recruits_new_bot', () => {
    for (const team of ['fruit', 'dessert'] as const) {
      for (const classId of sim.CLASS_IDS) {
        for (const quality of [false, true]) {
          const original = wallMatch(team, WALLS[0], quality ? [2] : []);
          const source = opener(original, team);
          source.classId = 'boxer'; // recruitment never transforms or inherits the source
          source.superBuddy = true;
          source.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
          source.bombs = 2;
          source.bombsSuper = true;
          original.nextId = 2; // below initial unit ids; allocator must still be unique
          expect(sim.canOpen(original, source.id)).toBe(true);
          expect(sim.canStartOpen(original, source.id)).toBe(false);
          expect(sim.canStartOpen(original, source.id, pick(original, classId, team))).toBe(true);
          const noChoice = sim.step(original, new Map([[source.id, input({ open: true })]]));
          expect(noChoice.pads[team].opening).toBeNull();
          expect(noChoice.pads[team].cells).toEqual(original.pads[team].cells);
          const s1 = start(original, classId, team);
          const T = s1.tick;
          let s = s1;
          for (let elapsed = 1; elapsed <= 19; elapsed++) {
            // Reselection during a channel cannot change the captured class.
            s = sim.step(
              s,
              new Map([[source.id, input({ open: true, classPick: pick(s, 'giant', team) })]]),
            );
            expect(s.units).toHaveLength(6);
            expect(s.pads[team].opening?.classId).toBe(classId);
          }
          expect(s.tick).toBe(T + 19);
          s = sim.step(s, new Map());
          expect(s.tick).toBe(T + 20);
          const recruit = must(s.units.find((u) => !original.units.some((old) => old.id === u.id)));
          expect(s.units).toHaveLength(7);
          expect(new Set(s.units.map((u) => u.id)).size).toBe(7);
          expect(recruit).toMatchObject({
            team,
            isBot: true,
            classId,
            hp: sim.unitMaxHp(recruit),
            carrying: null,
            gun: null,
            bombs: 0,
            attackCooldownTicks: 0,
            deadUntilTick: null,
          });
          expect(recruit.superBuddy ?? false).toBe(quality);
          expect(recruit.ninjaKnockReadyTick ?? 0).toBe(0);
          const center = sim.stallCenter(team);
          const offset = must(sim.SPAWN_OFFSETS[0]);
          const sign = team === 'fruit' ? 1 : -1;
          expect(recruit.pos).toEqual({
            x: center.x + sign * offset.x,
            y: center.y + sign * offset.y,
          });
          expect(opener(s, team)).toEqual(source);
          expect(s.pads[team].opening).toBeNull();
          expect(s.pads[team].cells.flat()).toEqual(Array(8).fill(null));
          expect(s.crates.some((c) => c.id >= 100 && c.id <= 103)).toBe(false);
          expect(s.events.filter((e) => e.kind === 'opened')).toEqual([
            {
              tick: T + 20,
              kind: 'opened',
              recipe: 'class',
              super: quality,
              team,
              unitId: source.id,
              classId,
              spawnedUnitId: recruit.id,
            },
          ]);
          const after = sim.step(s, new Map());
          expect(after.units).toHaveLength(7);
          expect(after.events.some((e) => e.kind === 'opened')).toBe(false);
        }
      }
    }
  });

  it('team_cap_counts_dead_and_completion_rechecks', () => {
    const full = wallMatch('fruit', WALLS[0], [0]);
    fillTeam(full);
    expect(sim.padPreview(full, 'fruit')).toEqual({
      recipe: 'class',
      super: true,
      openable: false,
      reason: 'teamFull',
    });
    expect(sim.canStartOpen(full, 0, pick(full))).toBe(false);
    expect(
      sim.step(full, new Map([[0, input({ open: true, classPick: pick(full) })]])).pads.fruit
        .opening,
    ).toBeNull();
    for (const before of [0, 19]) {
      let s = ticks(start(wallMatch()), before);
      fillTeam(s);
      s = sim.step(s, new Map());
      expectCancelled(s);
      expect(s.units.filter((u) => u.team === 'fruit')).toHaveLength(sim.TEAM_CAP);
      expect(s.pads.fruit.cells.flat().filter((id) => id !== null)).toEqual([100, 101, 102, 103]);
    }
  });

  it('stale_choice_and_cancel_boundaries', () => {
    for (const request of [
      undefined,
      { classId: 'healer', snapshot: '[]' },
      { classId: 'wizard', snapshot: 'CURRENT' },
      null,
    ] as const) {
      const s = wallMatch();
      const classPick =
        request === null
          ? null
          : request?.snapshot === 'CURRENT'
            ? { ...request, snapshot: JSON.stringify(s.pads.fruit.cells) }
            : request;
      const bad = classPick as ClassPick | undefined; // simulate malformed external runtime input
      sim.startOpen(s, 0, bad);
      expect(s.pads.fruit.opening).toBeNull();
      const next = sim.step(s, new Map([[0, input({ open: true, classPick: bad })]]));
      expect(next.pads.fruit.opening).toBeNull();
      expect(next.pads.fruit.cells).toEqual(s.pads.fruit.cells);
    }
    const queued = wallMatch();
    const oldPick = pick(queued);
    const replacement = wallMatch();
    must(replacement.pads.fruit.cells[0])[0] = 999;
    expect(sim.canStartOpen(replacement, 0, oldPick)).toBe(false);
    // Invalid class picks do not suppress a separate explicit pickDrop input.
    const lifted = sim.step(
      queued,
      new Map([
        [0, input({ open: true, pickDrop: true, classPick: { ...oldPick, snapshot: 'stale' } })],
      ]),
    );
    expect(opener(lifted).carrying).toBe(101);
    expect(lifted.pads.fruit.opening).toBeNull();
    const valid = sim.step(
      queued,
      new Map([[0, input({ open: true, pickDrop: true, classPick: oldPick })]]),
    );
    expect(valid.pads.fruit.opening?.classId).toBe('healer');
    expect(opener(valid).carrying).toBeNull();
    expect(
      sim.step(queued, new Map([[0, input({ classPick: oldPick })]])).pads.fruit.opening,
    ).toBeNull();

    const changes: ((s: MatchState) => void)[] = [
      (s) => {
        opener(s).deadUntilTick = 999;
      },
      (s) => {
        s.units = s.units.filter((u) => u.id !== 0);
      },
      (s) => {
        opener(s).pos = { x: 5, y: 12 };
      },
      (s) => {
        opener(s).carrying = 999;
      },
      (s) => {
        must(s.pads.fruit.cells[0])[1] = null;
      },
    ];
    for (const before of [0, 19]) {
      for (const change of changes) {
        let s = ticks(start(wallMatch()), before);
        change(s);
        s = sim.step(s, new Map());
        expectCancelled(s);
        expect(ticks(s, 21).units.some((u) => u.classId !== undefined)).toBe(false);
      }
    }
    // A same-tick placement/lift precedes completion and invalidates the snapshot.
    let onDone = ticks(start(wallMatch()), 19);
    must(onDone.units[1]).pos = sim.padCellCenter(onDone.pads.fruit, 0);
    onDone = sim.step(onDone, new Map([[1, input({ pickDrop: true })]]));
    expectCancelled(onDone);
    expect(must(onDone.units[1]).carrying).toBe(101);

    // Legacy ordinary recipes ignore class-only input fields.
    const ordinary = wallMatch();
    ordinary.pads.fruit.cells = [
      [100, null],
      [null, null],
      [null, null],
      [null, null],
    ];
    expect(sim.canStartOpen(ordinary, 0, { classId: 'healer', snapshot: 'stale' })).toBe(true);
    sim.startOpen(ordinary, 0, { classId: 'healer', snapshot: 'stale' });
    expect(ordinary.pads.fruit.opening).not.toHaveProperty('classId');
  });

  it('class_and_individual_bans_fail_closed', () => {
    const bans: readonly ItemBan[][] = [['class'], [...sim.CLASS_IDS], ['healer']];
    for (const banned of bans) {
      const s = wallMatch();
      s.itemBans = { fruit: banned };
      expect(sim.canStartOpen(s, 0, pick(s))).toBe(false);
      sim.startOpen(s, 0, pick(s));
      expect(s.pads.fruit.opening).toBeNull();
      if (banned.includes('class') || banned.length === 4)
        expect(sim.padPreview(s, 'fruit')).toEqual({
          recipe: null,
          super: false,
          openable: false,
          reason: 'notRecipe',
        });
      else {
        expect(sim.padPreview(s, 'fruit').openable).toBe(true);
        expect(sim.canStartOpen(s, 0, pick(s, 'boxer'))).toBe(true);
      }
      for (const before of [0, 19]) {
        let changed = ticks(start(wallMatch()), before);
        changed.itemBans = { fruit: banned };
        changed = sim.step(changed, new Map());
        expectCancelled(changed);
      }
    }
    for (const classId of sim.CLASS_IDS) {
      const s = wallMatch();
      s.itemBans = { fruit: [classId] };
      expect(sim.canStartOpen(s, 0, pick(s, classId))).toBe(false);
      s.itemBans = { dessert: ['class', ...sim.CLASS_IDS] };
      expect(sim.canStartOpen(s, 0, pick(s, classId))).toBe(true);
    }
    let normal = wallMatch('fruit', WALLS[0], [0, 1]);
    normal.itemBans = { fruit: ['super'] };
    normal = ticks(start(normal, 'giant'), 20);
    const recruit = must(normal.units.find((u) => u.id >= 6));
    expect(recruit.classId).toBe('giant');
    expect(recruit.superBuddy ?? false).toBe(false);
    expect(recruit.hp).toBe(sim.unitMaxHp(recruit));
    // An injected class wall channel without a selected class must never turn into a basic buddy.
    const injected = wallMatch();
    injected.pads.fruit.opening = {
      byUnit: 0,
      doneTick: 1,
      snapshot: JSON.stringify(injected.pads.fruit.cells),
    };
    expectCancelled(sim.step(injected, new Map()));
  });

  it('same_snapshot_tie_recruits_once_and_plain_buddy_is_classless', () => {
    let s = wallMatch();
    must(s.units[1]).pos = { ...opener(s).pos };
    s = sim.step(
      s,
      new Map([
        [1, input({ open: true, classPick: pick(s, 'giant') })],
        [0, input({ open: true, classPick: pick(s, 'ninja') })],
      ]),
    );
    expect(s.pads.fruit.opening?.byUnit).toBe(0);
    expect(s.pads.fruit.opening?.classId).toBe('ninja');
    expect(s.events.filter((e) => e.kind === 'openStarted')).toHaveLength(1);
    s = ticks(s, 20);
    expect(s.units).toHaveLength(7);
    expect(s.units.filter((u) => u.classId === 'ninja')).toHaveLength(1);
    expect(s.events.filter((e) => e.kind === 'opened')).toHaveLength(1);
    const plain = wallMatch();
    opener(plain).classId = 'giant';
    opener(plain).superBuddy = true;
    plain.pads.fruit.cells = [
      [100, 101],
      [null, null],
      [null, null],
      [null, null],
    ];
    const done = ticks(
      sim.step(plain, new Map([[0, input({ open: true, classPick: pick(plain) })]])),
      20,
    );
    const buddy = must(done.units.find((u) => u.id >= 6));
    expect(buddy.classId).toBeUndefined();
    expect(buddy.superBuddy).toBeUndefined();
    expect(buddy.hp).toBe(100);
    expect(done.events.filter((e) => e.kind === 'opened')).toEqual([
      { tick: done.tick, kind: 'opened', recipe: 'buddy', super: false, team: 'fruit', unitId: 0 },
    ]);
  });

  it('completion_precedes_same_tick_combat', () => {
    for (const before of [18, 19]) {
      let s = ticks(start(wallMatch()), before);
      opener(s).hp = 1;
      s.projectiles.push({
        id: 999,
        team: 'dessert',
        kind: 'bomb',
        pos: { ...opener(s).pos },
        vel: { x: 0, y: 0 },
        ttlTicks: 1,
      });
      s = sim.step(s, new Map());
      expect(opener(s).deadUntilTick).not.toBeNull();
      if (before === 19) {
        expect(s.units).toHaveLength(7);
        expect(s.events.findIndex((e) => e.kind === 'opened')).toBeLessThan(
          s.events.findIndex((e) => e.kind === 'death'),
        );
        expect(s.events.some((e) => e.kind === 'opened')).toBe(true);
        expect(s.pads.fruit.cells.flat()).toEqual(Array(8).fill(null));
      } else {
        s = sim.step(s, new Map());
        expectCancelled(s);
        expect(s.units).toHaveLength(6);
      }
    }
  });

  it('direct_class_start_rechecks_eligibility_without_reserving_or_reselecting', () => {
    const changes: ((s: MatchState) => void)[] = [
      (s) => {
        opener(s).deadUntilTick = 999;
      },
      (s) => {
        opener(s).carrying = 999;
      },
      (s) => {
        opener(s).pos = { x: 5, y: 12 };
      },
      (s) => {
        opener(s).pos = sim.padCellCenter(s.pads.dessert, 0);
      },
      (s) => {
        s.pads.fruit.opening = {
          byUnit: 1,
          doneTick: 30,
          snapshot: JSON.stringify(s.pads.fruit.cells),
          classId: 'giant',
        };
      },
    ];
    for (const change of changes) {
      const s = wallMatch();
      change(s);
      const before = structuredClone(s);
      expect(sim.canStartOpen(s, 0, pick(s))).toBe(false);
      sim.startOpen(s, 0, pick(s));
      expect(s).toEqual(before);
    }
    const s = wallMatch();
    const before = structuredClone(s);
    expect(sim.canStartOpen(s, 0, pick(s))).toBe(true);
    expect(s).toEqual(before); // eligibility is not a reservation
    sim.startOpen(s, 999, pick(s));
    expect(s).toEqual(before);
    sim.startOpen(s, 0, pick(s));
    expect(s.pads.fruit.opening?.classId).toBe('healer');
    const busy = structuredClone(s);
    sim.startOpen(s, 0, pick(s, 'giant'));
    expect(s).toEqual(busy);
  });

  it('post_movement_validation_and_class_only_leave_cancellation', () => {
    const ready = wallMatch();
    opener(ready).pos.x = 8.05;
    expect(sim.canStartOpen(ready, 0, pick(ready))).toBe(true);
    const departed = sim.step(
      ready,
      new Map([[0, input({ open: true, move: { x: -1, y: 0 }, classPick: pick(ready) })]]),
    );
    expect(departed.pads.fruit.opening).toBeNull();
    expect(departed.pads.fruit.cells).toEqual(ready.pads.fruit.cells);
    for (const before of [0, 19]) {
      let s = ticks(start(wallMatch()), before);
      opener(s).pos.x = 8.05;
      s = sim.step(s, new Map([[0, input({ move: { x: -1, y: 0 } })]]));
      expectCancelled(s);
    }
    // R1 channels deliberately retain their existing move/carry semantics.
    for (const recipe of ['gun', 'buddy'] as const) {
      const ordinary = wallMatch();
      ordinary.pads.fruit.cells = [
        [100, recipe === 'buddy' ? 101 : null],
        [null, null],
        [null, null],
        [null, null],
      ];
      let s = sim.step(ordinary, new Map([[0, input({ open: true })]]));
      opener(s).carrying = 999;
      opener(s).pos = { x: 5, y: 12 };
      s = ticks(s, 20);
      expect(s.events.some((e) => e.kind === 'opened' && e.recipe === recipe)).toBe(true);
    }
  });

  it('class_pick_replay_is_pure', () => {
    const original = wallMatch('fruit', WALLS[2], [3]);
    const untouched = structuredClone(original);
    const tape = Array.from(
      { length: 25 },
      (_, i) =>
        new Map([[0, input(i === 0 ? { open: true, classPick: pick(original, 'ninja') } : {})]]),
    );
    const tapeBefore = structuredClone(tape);
    let a = original;
    let b = wallMatch('fruit', WALLS[2], [3]);
    for (const frame of tape) {
      const previous = structuredClone(a);
      const previousRef = a;
      a = sim.step(a, frame);
      b = sim.step(b, frame);
      expect(previousRef).toEqual(previous);
      expect(a).toEqual(b);
      expect(sim.stateHash(a)).toBe(sim.stateHash(b));
    }
    expect(a.units).toHaveLength(7);
    expect(a.units.some((u) => u.classId === 'ninja' && u.superBuddy)).toBe(true);
    expect(original).toEqual(untouched);
    expect(tape).toEqual(tapeBefore);
  });
});
