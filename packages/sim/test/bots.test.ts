import { describe, expect, it } from 'vitest';
import {
  STALL_MAX_HP,
  UNIT_SPEED,
  botGoal,
  botInput,
  createMatch,
  stateHash,
  step,
  stallCenter,
} from '../src/index';
import type {
  MatchEvent,
  MatchState,
  SquadCommand,
  Team,
  UnitId,
  UnitInput,
  Vec2,
} from '../src/index';

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

function distFromStall(s: MatchState, unitId: UnitId): number {
  const unit = must(s.units.find((u) => u.id === unitId));
  const center = stallCenter(unit.team);
  return Math.hypot(unit.pos.x - center.x, unit.pos.y - center.y);
}

describe('bots: squad commands (plan Task 5)', () => {
  it('fetch: a lone bot turns one crate at (20,12) into a gun for its team within 30 s', () => {
    let s = createMatch(5, { humanUnit: null });
    s.units = s.units.filter((u) => u.id === 0); // the lone bot
    s.crates.push({ id: 100, pos: { x: 20, y: 12 }, state: 'ground', landTick: 0 });
    s.nextId = 101;
    const commands: Partial<Record<Team, SquadCommand>> = { fruit: 'fetch', dessert: null };
    let opened: MatchEvent | undefined;
    for (let t = 0; t < 600 && opened === undefined; t++) {
      s = step(s, new Map(), commands);
      opened = s.events.find(
        (e) => e.kind === 'opened' && e.recipe === 'gun' && e.team === 'fruit',
      );
    }
    expect(opened).toBeDefined();
    expect(must(s.units[0]).gun).toEqual({ ammoCooldownTicks: 0 });
  });

  it('fetch: with a gun already built, two ground crates become bombs within 45 s', () => {
    let s = createMatch(5, { humanUnit: null });
    s.units = s.units.filter((u) => u.id === 0); // the lone bot
    must(s.units[0]).gun = { ammoCooldownTicks: 0 }; // teamNeeds -> bombs
    s.crates.push({ id: 100, pos: { x: 20, y: 12 }, state: 'ground', landTick: 0 });
    s.crates.push({ id: 101, pos: { x: 21, y: 12 }, state: 'ground', landTick: 0 });
    s.nextId = 102;
    const commands: Partial<Record<Team, SquadCommand>> = { fruit: 'fetch', dessert: null };
    let opened: MatchEvent | undefined;
    for (let t = 0; t < 900 && opened === undefined; t++) {
      s = step(s, new Map(), commands);
      opened = s.events.find(
        (e) => e.kind === 'opened' && e.recipe === 'bombs' && e.team === 'fruit',
      );
    }
    expect(opened).toBeDefined();
  });

  it('guard: commanded bots stay within 6 units of their stall for 60 s', () => {
    let s = createMatch(7, { humanUnit: null });
    const commands: Partial<Record<Team, SquadCommand>> = { fruit: 'guard', dessert: 'guard' };
    let maxDist = 0;
    for (let t = 0; t < 1200; t++) {
      s = step(s, new Map(), commands);
      for (const unit of s.units) maxDist = Math.max(maxDist, distFromStall(s, unit.id));
    }
    expect(maxDist).toBeLessThanOrEqual(6);
  });

  it('attack: an armed bot damages the enemy stall within 60 s with no defenders', () => {
    let s = createMatch(9);
    s.units = s.units.filter((u) => u.team === 'fruit'); // no defenders
    const bot = must(s.units.find((u) => u.id === 1));
    bot.gun = { ammoCooldownTicks: 0 };
    const commands: Partial<Record<Team, SquadCommand>> = { fruit: 'attack', dessert: null };
    for (let t = 0; t < 1200 && s.stalls.dessert.hp >= STALL_MAX_HP; t++) {
      s = step(s, new Map(), commands);
    }
    expect(s.stalls.dessert.hp).toBeLessThan(STALL_MAX_HP);
  });

  it('never stuck: 20 seeds x 2 min, no alive non-guarding/non-opening bot keeps the same position (+-0.1) for more than 5 s', () => {
    for (let seed = 0; seed < 20; seed++) {
      let s = createMatch(seed, { humanUnit: null });
      const refs = new Map<UnitId, { pos: Vec2; since: number }>();
      for (let t = 0; t < 2400 && s.winner === null; t++) {
        s = step(s, new Map());
        for (const unit of s.units) {
          const goal = botGoal(s, unit.id);
          const opening = s.pads[unit.team].opening?.byUnit === unit.id;
          if (unit.deadUntilTick !== null || goal === 'guard' || opening) {
            refs.delete(unit.id);
            continue;
          }
          const ref = refs.get(unit.id);
          if (
            ref === undefined ||
            Math.hypot(unit.pos.x - ref.pos.x, unit.pos.y - ref.pos.y) > 0.1
          ) {
            refs.set(unit.id, { pos: { ...unit.pos }, since: t });
          } else if (t - ref.since > 100) {
            throw new Error(
              `seed ${seed}: bot ${unit.id} (${goal}) stuck at ` +
                `(${unit.pos.x.toFixed(2)},${unit.pos.y.toFixed(2)}) ticks ${ref.since}-${t}`,
            );
          }
        }
      }
    }
  }, 600_000);

  it('determinism with bots on: 3000 all-bot ticks from seed 31 run twice give an identical stateHash and real traffic', () => {
    const run = (): { final: MatchState; opened: number; hits: number; deaths: number } => {
      let s = createMatch(31, { humanUnit: null });
      let opened = 0;
      let hits = 0;
      let deaths = 0;
      for (let t = 0; t < 3000; t++) {
        s = step(s, new Map());
        for (const e of s.events) {
          if (e.kind === 'opened') opened++;
          else if (e.kind === 'hit') hits++;
          else if (e.kind === 'death') deaths++;
        }
      }
      return { final: s, opened, hits, deaths };
    };
    const a = run();
    const b = run();
    expect(stateHash(a.final)).toBe(stateHash(b.final));
    expect(a.final).toEqual(b.final);
    expect(a.opened).toBeGreaterThanOrEqual(1);
    expect(a.hits).toBeGreaterThanOrEqual(1);
    expect(a.deaths).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

describe('bots: input channel (plan Task 5 + card)', () => {
  it('a passed-in input for a bot unit is ignored', () => {
    let s = createMatch(3);
    const commands: Partial<Record<Team, SquadCommand>> = { fruit: 'guard', dessert: 'guard' };
    s = step(s, new Map(), commands); // settle: every bot guards its own stall

    // A scripted fire pulse must not reach combat: nothing is in the guard's range,
    // so an honored pulse would set attackCooldownTicks while the bot's own input
    // (no target) leaves it at 0.
    s = step(s, new Map([[1, inp({ fire: true })]]), commands);
    expect(must(s.units.find((u) => u.id === 1)).attackCooldownTicks).toBe(0);

    // A scripted march east for 3 s would add 12 units of x-drift; a guarding
    // bot that already sits on its stall only mills (a couple of units at most).
    const center = stallCenter('fruit');
    must(s.units.find((u) => u.id === 1)).pos = { ...center };
    for (let t = 0; t < 60; t++) {
      s = step(s, new Map([[1, inp({ move: { x: 1, y: 0 } })]]), commands);
    }
    const bot = must(s.units.find((u) => u.id === 1));
    expect(bot.pos.x - center.x).toBeLessThan(4);
    expect(distFromStall(s, 1)).toBeLessThanOrEqual(6);
  });

  it('the human unit input is never overridden', () => {
    let s = createMatch(3, { humanUnit: 0 });
    const start = must(s.units[0]).pos;
    for (let t = 0; t < 20; t++) s = step(s, new Map([[0, inp({ move: { x: 1, y: 0 } })]]));
    expect(must(s.units[0]).pos.x - start.x).toBeCloseTo(UNIT_SPEED, 6);
  });

  it('botInput is pure: s (including s.rng) is deep-equal before and after', () => {
    const s = createMatch(11, { humanUnit: null });
    const snapshot = structuredClone(s);
    for (const unit of s.units) botInput(s, unit.id);
    expect(s.rng).toBe(snapshot.rng);
    expect(s).toEqual(snapshot);
  });
});

describe('bots: botGoal contract', () => {
  it('the team command wins over the defaults', () => {
    for (const command of ['attack', 'guard', 'fetch'] as const) {
      const s = createMatch(1);
      s.commands.fruit = command;
      for (const id of [1, 2]) expect(botGoal(s, id)).toBe(command);
    }
  });

  it('with a null command, defaults are 1st bot fetch, 2nd guard, 3rd+ attack', () => {
    const s = createMatch(1); // fruit: human 0 + bots 1,2 — dessert: bots 3,4,5
    expect(botGoal(s, 1)).toBe('fetch');
    expect(botGoal(s, 2)).toBe('guard');
    expect(botGoal(s, 3)).toBe('fetch');
    expect(botGoal(s, 4)).toBe('guard');
    expect(botGoal(s, 5)).toBe('attack');
  });

  it('dead bots give up their default slot to the next living bot', () => {
    const s = createMatch(1);
    must(s.units.find((u) => u.id === 3)).deadUntilTick = 1000;
    expect(botGoal(s, 4)).toBe('fetch');
    expect(botGoal(s, 5)).toBe('guard');
  });

  it('an all-bot team switches to attack once its living units hold >= 2 guns', () => {
    const s = createMatch(1, { humanUnit: null });
    must(s.units.find((u) => u.id === 0)).gun = { ammoCooldownTicks: 0 };
    expect(botGoal(s, 0)).toBe('fetch'); // one gun: defaults still apply (0 = 1st bot)
    expect(botGoal(s, 1)).toBe('guard');
    must(s.units.find((u) => u.id === 1)).gun = { ammoCooldownTicks: 0 };
    for (const id of [0, 1, 2]) expect(botGoal(s, id)).toBe('attack');
    // The other team holds no guns: it keeps its default slots (3rd bot attacks
    // by position, not by the switch).
    expect(botGoal(s, 3)).toBe('fetch');
    expect(botGoal(s, 4)).toBe('guard');
    expect(botGoal(s, 5)).toBe('attack');
  });

  it('a team that has a human unit never performs the all-bot attack switch', () => {
    const s = createMatch(1); // fruit keeps its human unit 0
    must(s.units.find((u) => u.id === 1)).gun = { ammoCooldownTicks: 0 };
    must(s.units.find((u) => u.id === 2)).gun = { ammoCooldownTicks: 0 };
    expect(botGoal(s, 1)).toBe('fetch');
    expect(botGoal(s, 2)).toBe('guard');
  });
});

describe('bots: squad command storage (step phase 1)', () => {
  it('a given command is stored; a missing key keeps the previous; null clears', () => {
    let s = createMatch(1);
    s = step(s, new Map(), { fruit: 'attack' });
    expect(s.commands.fruit).toBe('attack');
    expect(s.commands.dessert).toBeNull();
    s = step(s, new Map());
    expect(s.commands.fruit).toBe('attack'); // kept without a key
    s = step(s, new Map(), { fruit: null });
    expect(s.commands.fruit).toBeNull(); // explicit null clears
  });
});
