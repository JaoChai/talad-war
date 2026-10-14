import { describe, expect, it } from 'vitest';
import { RESPAWN_TICKS, UNIT_MAX_HP, createMatch, step } from '../src/index';
import type { MatchEvent, MatchState, UnitId, UnitInput, Vec2 } from '../src/index';

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function unitAt(s: MatchState, id: number, pos: Vec2): void {
  must(s.units.find((u) => u.id === id)).pos = { ...pos };
}

function arm(s: MatchState, id: number): void {
  must(s.units.find((u) => u.id === id)).gun = { ammoCooldownTicks: 0 };
}

function inputsFor(
  s: MatchState,
  patches: [UnitId, Partial<UnitInput>][] = [],
): Map<UnitId, UnitInput> {
  const map = new Map<UnitId, UnitInput>();
  for (const unit of s.units) {
    map.set(unit.id, {
      move: { x: 0, y: 0 },
      aim: null,
      fire: false,
      throwBomb: false,
      pickDrop: false,
      open: false,
    });
  }
  for (const [id, extra] of patches) {
    map.set(id, { ...(must(map.get(id)) as UnitInput), ...extra });
  }
  return map;
}

/** unit 0 stands at (12,12) one slap from death; unit 3 stands adjacent, firing once. */
function mortallyWounded(): MatchState {
  const s = createMatch(1);
  unitAt(s, 0, { x: 12, y: 12 });
  unitAt(s, 3, { x: 13, y: 12 });
  arm(s, 0);
  must(s.units.find((u) => u.id === 0)).bombs = 2;
  must(s.units.find((u) => u.id === 0)).hp = 8; // one slap kills
  unitAt(s, 1, { x: 2.5, y: 22.8 }); // far teammates stay out of every range
  unitAt(s, 2, { x: 7.5, y: 22.8 });
  return s;
}

describe('death', () => {
  it('clears the loadout, drops the carried crate and emits hit/death events', () => {
    let s = mortallyWounded();
    unitAt(s, 0, { x: 12, y: 12 });
    must(s.units.find((u) => u.id === 0)).carrying = 900;
    s.crates.push({ id: 900, pos: { x: 12, y: 12 }, state: 'carried', landTick: 0 });
    s = step(s, inputsFor(s, [[3, { fire: true }]]));
    const u0 = must(s.units.find((u) => u.id === 0));
    expect(s.tick).toBe(1);
    expect(u0.hp).toBe(0);
    expect(u0.deadUntilTick).toBe(1 + RESPAWN_TICKS);
    expect(u0.gun).toBeNull();
    expect(u0.bombs).toBe(0);
    expect(u0.carrying).toBeNull();
    const crate = must(s.crates.find((c) => c.id === 900));
    expect(crate.state).toBe('ground');
    expect(crate.pos).toEqual({ x: 12, y: 12 });
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'hit', target: 0, dmg: 8 }));
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'death', unitId: 0 }));
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'crateDrop', crateId: 900 }));
  });

  it('a dead unit is not hit, not moved and does not act', () => {
    let s = mortallyWounded();
    s = step(s, inputsFor(s, [[3, { fire: true }]])); // unit 0 dies on tick 1
    const events: MatchEvent[] = [];
    for (let i = 0; i < 15; i++) {
      s = step(
        s,
        inputsFor(s, [
          [3, { fire: true }],
          [0, { move: { x: 1, y: 0 }, fire: true, pickDrop: true }],
        ]),
      );
      events.push(...s.events);
    }
    const u0 = must(s.units.find((u) => u.id === 0));
    expect(u0.hp).toBe(0);
    expect(u0.pos).toEqual({ x: 12, y: 12 }); // corpses do not move
    expect(events.some((e) => e.kind === 'hit' && e.target === 0)).toBe(false);
    expect(events.some((e) => e.kind === 'cratePick')).toBe(false);
  });
});

describe('respawn', () => {
  it('respawns at the own stall after exactly RESPAWN_TICKS, unarmed and healed', () => {
    let s = mortallyWounded();
    s = step(s, inputsFor(s, [[3, { fire: true }]])); // death on tick 1, deadUntilTick 101
    const events: MatchEvent[] = [];
    for (let i = 0; i < RESPAWN_TICKS; i++) {
      s = step(s, inputsFor(s, [[3, { fire: true }]]));
      events.push(...s.events);
    }
    expect(s.tick).toBe(1 + RESPAWN_TICKS);
    const u0 = must(s.units.find((u) => u.id === 0));
    expect(u0.deadUntilTick).toBeNull();
    expect(u0.hp).toBe(UNIT_MAX_HP);
    expect(u0.gun).toBeNull(); // still unarmed
    expect(u0.bombs).toBe(0);
    expect(u0.carrying).toBeNull();
    expect(u0.pos.x).toBeCloseTo(5, 9); // fruit stall spawn slot 0
    expect(u0.pos.y).toBeCloseTo(17.2, 9);
    expect(events.filter((e) => e.kind === 'respawn')).toHaveLength(1);
    expect(events.some((e) => e.kind === 'respawn' && e.unitId === 0)).toBe(true);
  });

  it('stays dead until the tick arrives (not one step earlier)', () => {
    let s = mortallyWounded();
    s = step(s, inputsFor(s, [[3, { fire: true }]]));
    for (let i = 0; i < RESPAWN_TICKS - 1; i++) s = step(s, new Map());
    expect(s.tick).toBe(RESPAWN_TICKS);
    expect(must(s.units.find((u) => u.id === 0)).deadUntilTick).toBe(RESPAWN_TICKS + 1);
    expect(s.events.some((e) => e.kind === 'respawn')).toBe(false);
  });
});
