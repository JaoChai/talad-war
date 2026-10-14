import { describe, expect, it } from 'vitest';
import { createMatch, stateHash, step } from '../src/index';
import type {
  MatchEvent,
  MatchState,
  SquadCommand,
  Team,
  UnitId,
  UnitInput,
  Vec2,
} from '../src/index';

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

/**
 * These tests script every unit's input directly, so all starting units are
 * pinned non-bot: step() must not let a bot override a scripted input
 * (T5 rework decision A: keep the override semantics).
 */
function pinNoBots(s: MatchState): MatchState {
  for (const unit of s.units) unit.isBot = false;
  return s;
}

function runScripted(): MatchState {
  let s = pinNoBots(createMatch(7));
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

/** What one scripted pad run did — the assertions below need this to prove traffic. */
interface PadRun {
  final: MatchState;
  events: MatchEvent[];
  openedRecipes: string[];
  ticksWithOnPadCrate: number;
}

/** Fruit pad col centers — pad (8,18)-(11,21), col = cellX + 2*cellY. */
const PAD_COL: Vec2[] = [
  { x: 8.75, y: 18.75 }, // col 0
  { x: 10.25, y: 18.75 }, // col 1
  { x: 8.75, y: 20.25 }, // col 2
  { x: 10.25, y: 20.25 }, // col 3
];

const CRATE_A = 900;
const CRATE_B = 901;

/** Pad.test.ts convention: ids 900+ never collide with sky-spawned crates. */
function giveCarriedCrate(s: MatchState, unitId: UnitId, crateId: number): void {
  const unit = must(s.units.find((u) => u.id === unitId));
  unit.carrying = crateId;
  s.crates.push({ id: crateId, pos: { ...unit.pos }, state: 'carried', landTick: 0 });
}

/**
 * Deterministic pulse schedule over otherwise idle ticks, one action per pulse:
 * t5 unit 0 places A on col 1, t6 opens (gun), t7 unit 1 places B so the pad
 * snapshot differs and the opening cancels; t8 unit 1 lifts B back off, t10
 * unit 0 lifts A, t12 places it again, t14 opens again — one crate left, so
 * that opening completes with the gun.
 */
function padPulse(tick: number, id: UnitId): UnitInput {
  const input: UnitInput = {
    move: { x: 0, y: 0 },
    aim: null,
    fire: false,
    throwBomb: false,
    pickDrop: false,
    open: false,
  };
  if (id === 0) {
    if (tick === 6 || tick === 14) input.open = true;
    if (tick === 5 || tick === 10 || tick === 12) input.pickDrop = true;
  }
  if (id === 1 && (tick === 7 || tick === 8)) input.pickDrop = true;
  return input;
}

function runPadScript(): PadRun {
  let s = pinNoBots(createMatch(11));
  // Direct state surgery (pad.test.ts convention): two fruit carriers stand on
  // their own pad — wandering units never reach a pad within 2000 ticks.
  must(s.units.find((u) => u.id === 0)).pos = { ...must(PAD_COL[1]) };
  must(s.units.find((u) => u.id === 1)).pos = { ...must(PAD_COL[3]) };
  giveCarriedCrate(s, 0, CRATE_A);
  giveCarriedCrate(s, 1, CRATE_B);
  const events: MatchEvent[] = [];
  let ticksWithOnPadCrate = 0;
  for (let t = 0; t < 2000; t++) {
    const inputs = new Map<UnitId, UnitInput>();
    for (const id of UNIT_IDS) inputs.set(id, padPulse(t, id));
    s = step(s, inputs);
    events.push(...s.events);
    if (s.crates.some((c) => c.state === 'onPad')) ticksWithOnPadCrate++;
  }
  return {
    final: s,
    events,
    openedRecipes: events.filter((e) => e.kind === 'opened').map((e) => String(e.recipe)),
    ticksWithOnPadCrate,
  };
}

describe('determinism with pad traffic', () => {
  it('2000 scripted place/lift/open ticks from seed 11, run twice, produce an identical stateHash', () => {
    const first = runPadScript();
    const second = runPadScript();

    // The script must really drive the pad: at least one place, one lift, one
    // completed open and one cancelled open inside the 2000 ticks.
    expect(first.ticksWithOnPadCrate).toBeGreaterThan(0); // a placement sat on the pad
    expect(first.events.filter((e) => e.kind === 'openStarted').length).toBe(2);
    expect(first.events.some((e) => e.kind === 'openCancelled')).toBe(true);
    expect(first.openedRecipes).toEqual(['gun']); // exactly one completed open
    expect(must(first.final.units.find((u) => u.id === 0)).gun).toEqual({
      ammoCooldownTicks: 0,
    });
    expect(first.final.pads.fruit.opening).toBeNull();

    expect(first.final.tick).toBe(2000);
    expect(first.final.winner).toBeNull();
    expect(stateHash(first.final)).toBe(stateHash(second.final));
    expect(first.final).toEqual(second.final);
  });
});
