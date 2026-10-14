import { describe, expect, it } from 'vitest';
import {
  BOMB_DMG,
  BOMB_FUSE_TICKS,
  BOMB_STALL_MULT,
  createMatch,
  GUN_COOLDOWN_TICKS,
  GUN_DMG,
  SLAP_COOLDOWN_TICKS,
  SLAP_DMG,
  STALL_MAX_HP,
  stateHash,
  step,
} from '../src/index';
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

/** Park every dessert unit far from the fight so range checks are unambiguous. */
function banishDessert(s: MatchState): void {
  for (const unit of s.units) if (unit.team === 'dessert') unit.pos = { x: 25, y: 1 };
}

/** Pad.test.ts convention: surgery-carried crates use ids 900+ that sky drops never hit. */
function giveCarriedCrate(s: MatchState, unitId: number, crateId: number): void {
  const unit = must(s.units.find((u) => u.id === unitId));
  unit.carrying = crateId;
  s.crates.push({ id: crateId, pos: { ...unit.pos }, state: 'carried', landTick: 0 });
}

function putOnPad(s: MatchState, team: 'fruit' | 'dessert', col: number, crateId: number): void {
  must(s.pads[team].cells[col])[0] = crateId;
  s.crates.push({ id: crateId, pos: { x: 0, y: 0 }, state: 'onPad', landTick: 0 });
}

type Patches = [UnitId, Partial<UnitInput>][];

function inputsFor(s: MatchState, patches: Patches = []): Map<UnitId, UnitInput> {
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

interface RunResult {
  final: MatchState;
  events: MatchEvent[];
}

/** Step `steps` times; `patches` apply only on the first step (one attack pulse). */
function runPulse(s: MatchState, steps: number, patches: Patches = []): RunResult {
  const events: MatchEvent[] = [];
  for (let i = 0; i < steps; i++) {
    s = step(s, inputsFor(s, i === 0 ? patches : []));
    events.push(...s.events);
  }
  return { final: s, events };
}

/** Step `steps` times with the same patches held down every tick (cooldown tests). */
function runHeld(s: MatchState, steps: number, patches: Patches = []): RunResult {
  const events: MatchEvent[] = [];
  for (let i = 0; i < steps; i++) {
    s = step(s, inputsFor(s, patches));
    events.push(...s.events);
  }
  return { final: s, events };
}

describe('carrying blocks attacks', () => {
  it('fire and throwBomb do nothing while a unit is carrying', () => {
    let s = createMatch(1);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 3, { x: 13, y: 12 }); // in slap range — still nothing may happen
    arm(s, 0);
    must(s.units.find((u) => u.id === 0)).bombs = 2;
    giveCarriedCrate(s, 0, 900);
    s = step(s, inputsFor(s, [[0, { fire: true, throwBomb: true }]]));
    expect(s.projectiles).toHaveLength(0);
    expect(must(s.units.find((u) => u.id === 3)).hp).toBe(100);
    expect(must(s.units.find((u) => u.id === 0)).bombs).toBe(2);
    expect(s.events).toHaveLength(0);
  });
});

describe('slap', () => {
  it('unarmed fire hits the nearest enemy unit within SLAP_RANGE', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 3, { x: 12.8, y: 12 }); // 0.8 away — nearest
    unitAt(s, 4, { x: 11.1, y: 12 }); // 0.9 away
    s = step(s, inputsFor(s, [[0, { fire: true }]]));
    expect(must(s.units.find((u) => u.id === 3)).hp).toBe(100 - SLAP_DMG);
    expect(must(s.units.find((u) => u.id === 4)).hp).toBe(100);
    expect(s.events).toContainEqual(
      expect.objectContaining({ kind: 'hit', target: 3, dmg: SLAP_DMG }),
    );
  });

  it('unarmed fire hits the enemy stall when it is the closest target in range', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 35, y: 7 }); // 1.0 from the dessert stall rect
    s = step(s, inputsFor(s, [[0, { fire: true }]]));
    expect(s.stalls.dessert.hp).toBe(STALL_MAX_HP - SLAP_DMG);
    expect(s.events).toContainEqual(
      expect.objectContaining({ kind: 'hit', target: 'dessert', dmg: SLAP_DMG }),
    );
  });

  it('respects SLAP_COOLDOWN_TICKS', () => {
    let s = createMatch(1);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 3, { x: 13, y: 12 });
    const run = runHeld(s, 12, [[0, { fire: true }]]);
    const enemy = must(run.final.units.find((u) => u.id === 3));
    expect(enemy.hp).toBe(100 - 2 * SLAP_DMG); // hits on tick 1 and tick 11 only
    expect(must(run.final.units.find((u) => u.id === 0)).attackCooldownTicks).toBeLessThan(
      SLAP_COOLDOWN_TICKS,
    );
  });
});

describe('gun', () => {
  it('armed fire sends a bullet along the explicit aim even when it hits nobody', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    arm(s, 0);
    s = step(s, inputsFor(s, [[0, { fire: true, aim: { x: 12, y: 16 } }]])); // aim past everyone
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0]).toMatchObject({
      kind: 'bullet',
      team: 'fruit',
      pos: { x: 12, y: 12 },
    });
    const run = runPulse(s, 12);
    expect(run.final.projectiles).toHaveLength(0); // expired within GUN_RANGE
    expect(must(run.final.units.find((u) => u.id === 4)).hp).toBe(100);
  });

  it('armed fire with explicit aim at an enemy hits the first enemy unit', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    arm(s, 0);
    unitAt(s, 3, { x: 16, y: 12 });
    const run = runPulse(s, 8, [[0, { fire: true, aim: { x: 20, y: 12 } }]]);
    expect(must(run.final.units.find((u) => u.id === 3)).hp).toBe(100 - GUN_DMG);
    expect(run.events).toContainEqual(
      expect.objectContaining({ kind: 'hit', target: 3, dmg: GUN_DMG }),
    );
  });

  it('armed fire with a null aim uses autoAimTarget', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    arm(s, 0);
    unitAt(s, 3, { x: 16, y: 12 });
    const run = runPulse(s, 8, [[0, { fire: true }]]);
    expect(must(run.final.units.find((u) => u.id === 3)).hp).toBe(100 - GUN_DMG);
  });

  it('a bullet blocked by an obstacle does no damage', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 4.5 }); // shoots east through the (14,4)-(17,6) stall row
    arm(s, 0);
    unitAt(s, 3, { x: 19, y: 4.5 }); // behind the obstacle
    const run = runPulse(s, 12, [[0, { fire: true, aim: { x: 24, y: 4.5 } }]]);
    expect(run.final.projectiles).toHaveLength(0);
    expect(must(run.final.units.find((u) => u.id === 3)).hp).toBe(100);
    expect(run.events.some((e) => e.kind === 'hit')).toBe(false);
  });

  it('bullets pass through friendly units without hitting or blocking', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 1, { x: 13.5, y: 12 }); // friendly, right in the line of fire
    arm(s, 0);
    unitAt(s, 3, { x: 17, y: 12 });
    const run = runPulse(s, 8, [[0, { fire: true, aim: { x: 20, y: 12 } }]]);
    expect(must(run.final.units.find((u) => u.id === 1)).hp).toBe(100);
    expect(must(run.final.units.find((u) => u.id === 3)).hp).toBe(100 - GUN_DMG);
  });

  it('a bullet into the own stall stops and does no damage', () => {
    let s = createMatch(1);
    unitAt(s, 0, { x: 8, y: 17 }); // next to the fruit stall, shooting into it
    arm(s, 0);
    const run = runPulse(s, 6, [[0, { fire: true, aim: { x: 5, y: 20 } }]]);
    expect(run.final.projectiles).toHaveLength(0);
    expect(run.final.stalls.fruit.hp).toBe(STALL_MAX_HP);
    expect(run.events.some((e) => e.kind === 'hit')).toBe(false);
  });

  it('a bullet into the enemy stall damages it and stops', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 35, y: 7 });
    arm(s, 0); // auto-aim falls back to the dessert stall centre
    const run = runPulse(s, 6, [[0, { fire: true }]]);
    expect(run.final.stalls.dessert.hp).toBe(STALL_MAX_HP - GUN_DMG);
    expect(run.events).toContainEqual(
      expect.objectContaining({ kind: 'hit', target: 'dessert', dmg: GUN_DMG }),
    );
  });

  it('respects GUN_COOLDOWN_TICKS', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    arm(s, 0);
    unitAt(s, 3, { x: 16, y: 12 });
    const run = runHeld(s, 15, [[0, { fire: true, aim: { x: 16, y: 12 } }]]);
    // Shots on ticks 1, 7, 13; bullets land on ticks 5, 11, 17 — exactly two hits in 15 ticks.
    expect(must(run.final.units.find((u) => u.id === 3)).hp).toBe(100 - 2 * GUN_DMG);
    expect(GUN_COOLDOWN_TICKS).toBe(6);
  });
});

describe('bombs', () => {
  it('throwBomb decrements bombs and explodes after the fuse, hitting the radius edge', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    must(s.units.find((u) => u.id === 0)).bombs = 3;
    unitAt(s, 3, { x: 18.2, y: 12 }); // exactly BOMB_RADIUS from the landing point
    s = step(s, inputsFor(s, [[0, { throwBomb: true, aim: { x: 16, y: 12 } }]]));
    expect(must(s.units.find((u) => u.id === 0)).bombs).toBe(2);
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0]).toMatchObject({
      kind: 'bomb',
      pos: { x: 16, y: 12 },
      ttlTicks: BOMB_FUSE_TICKS,
    });
    const run = runPulse(s, 30);
    expect(run.events).toContainEqual(
      expect.objectContaining({ kind: 'explosion', pos: { x: 16, y: 12 } }),
    );
    expect(run.events).toContainEqual(
      expect.objectContaining({ kind: 'hit', target: 3, dmg: BOMB_DMG }),
    );
    expect(must(run.final.units.find((u) => u.id === 3)).hp).toBe(100 - BOMB_DMG);
  });

  it('a unit just outside BOMB_RADIUS takes no damage', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 12, y: 12 });
    must(s.units.find((u) => u.id === 0)).bombs = 1;
    unitAt(s, 3, { x: 18.3, y: 12 }); // 2.3 from the landing point
    const run = runPulse(s, 30, [[0, { throwBomb: true, aim: { x: 16, y: 12 } }]]);
    expect(run.events.some((e) => e.kind === 'explosion')).toBe(true);
    expect(must(run.final.units.find((u) => u.id === 3)).hp).toBe(100);
  });

  it('throwBomb with no bombs does nothing', () => {
    let s = createMatch(1);
    unitAt(s, 0, { x: 12, y: 12 });
    s = step(s, inputsFor(s, [[0, { throwBomb: true, aim: { x: 16, y: 12 } }]]));
    expect(s.projectiles).toHaveLength(0);
    expect(s.events).toHaveLength(0);
  });

  it('an explosion next to the enemy stall damages it with BOMB_STALL_MULT', () => {
    let s = createMatch(1);
    banishDessert(s);
    unitAt(s, 0, { x: 29, y: 7 }); // 5 from the aim point, inside BOMB_THROW_RANGE
    must(s.units.find((u) => u.id === 0)).bombs = 1;
    const run = runPulse(s, 30, [[0, { throwBomb: true, aim: { x: 33, y: 4 } }]]);
    expect(run.final.stalls.dessert.hp).toBeCloseTo(STALL_MAX_HP - BOMB_DMG * BOMB_STALL_MULT, 6);
    expect(run.events.some((e) => e.kind === 'explosion')).toBe(true);
  });
});

describe('combat vs the Open! channel', () => {
  it('killing the opener with real combat damage cancels the open', () => {
    let s = createMatch(5);
    putOnPad(s, 'fruit', 0, 100); // gun recipe on col 0
    unitAt(s, 0, { x: 8.75, y: 18.75 }); // fruit pad col 0 centre
    unitAt(s, 3, { x: 9.8, y: 18.75 }); // enemy standing on the pad, in slap range
    must(s.units.find((u) => u.id === 0)).hp = 16; // two slaps kill inside the 20-tick window
    const events: MatchEvent[] = [];
    for (let t = 0; t < 30; t++) {
      s = step(s, inputsFor(s, t === 0 ? [[0, { open: true }]] : [[3, { fire: true }]]));
      events.push(...s.events);
    }
    expect(events.some((e) => e.kind === 'openStarted')).toBe(true);
    expect(events.some((e) => e.kind === 'openCancelled')).toBe(true);
    expect(events.some((e) => e.kind === 'opened')).toBe(false);
    expect(events.some((e) => e.kind === 'death' && e.unitId === 0)).toBe(true);
    expect(s.pads.fruit.opening).toBeNull();
    expect(must(s.units.find((u) => u.id === 0)).deadUntilTick).not.toBeNull();
  });

  it("a hit while carrying drops the crate at the unit's feet", () => {
    let s = createMatch(1);
    unitAt(s, 0, { x: 12, y: 12 });
    unitAt(s, 3, { x: 13, y: 12 });
    giveCarriedCrate(s, 0, 900);
    s = step(s, inputsFor(s, [[3, { fire: true }]]));
    expect(must(s.units.find((u) => u.id === 0)).carrying).toBeNull();
    expect(must(s.units.find((u) => u.id === 0)).hp).toBe(100 - SLAP_DMG);
    const crate = must(s.crates.find((c) => c.id === 900));
    expect(crate.state).toBe('ground');
    expect(crate.pos).toEqual({ x: 12, y: 12 });
    expect(s.events).toContainEqual(expect.objectContaining({ kind: 'crateDrop', crateId: 900 }));
  });
});

describe('combat determinism', () => {
  it('3000 scripted combat ticks from seed 21 run twice produce an identical stateHash with real traffic', () => {
    const first = runCombatScript();
    const second = runCombatScript();
    expect(first.final.tick).toBe(3000);
    expect(first.final.winner).toBeNull(); // the fight stays at the centre, stalls untouched
    expect(first.counts.hit).toBeGreaterThanOrEqual(1);
    expect(first.counts.explosion).toBeGreaterThanOrEqual(1);
    expect(first.counts.death).toBeGreaterThanOrEqual(1);
    expect(first.counts.respawn).toBeGreaterThanOrEqual(1);
    expect(stateHash(first.final)).toBe(stateHash(second.final));
    expect(first.final).toEqual(second.final);
  });
});

const CENTER: Vec2 = { x: 20, y: 12 };

function toward(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  return len < 0.001 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

/**
 * Every unit homes to the arena centre with fire held down; each also throws its
 * three bombs on a staggered schedule. The clump guarantees slaps, bomb hits,
 * deaths and respawns inside 3000 ticks — the traffic the hash must cover.
 */
function runCombatScript(): { final: MatchState; counts: Record<string, number> } {
  let s = createMatch(21);
  for (const unit of s.units) unit.bombs = 3;
  const counts = { hit: 0, explosion: 0, death: 0, respawn: 0 };
  for (let t = 0; t < 3000; t++) {
    const inputs = new Map<UnitId, UnitInput>();
    for (const unit of s.units) {
      inputs.set(unit.id, {
        move: toward(unit.pos, CENTER),
        aim: null,
        fire: true,
        throwBomb: t > 100 && (t + unit.id * 17) % 50 === 0,
        pickDrop: false,
        open: false,
      });
    }
    s = step(s, inputs);
    for (const event of s.events) {
      if (event.kind === 'hit') counts.hit++;
      else if (event.kind === 'explosion') counts.explosion++;
      else if (event.kind === 'death') counts.death++;
      else if (event.kind === 'respawn') counts.respawn++;
    }
  }
  return { final: s, counts };
}
