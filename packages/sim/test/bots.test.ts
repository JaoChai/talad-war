import { describe, expect, it } from 'vitest';
import {
  HEALER_RADIUS,
  PAD_ORIGINS,
  unitMaxHp,
  updateClassHealing,
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
  CrateId,
  MatchEvent,
  MatchState,
  Pad,
  SquadCommand,
  Team,
  Unit,
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

type StuckRefs = Map<UnitId, { pos: Vec2; since: number }>;

// Infer real phase-7 healing independently from HP and damage events. Net HP
// alone misses healing on a combat tick; death/respawn must never count as a heal.
function supportedAllyWasHealed(before: MatchState, s: MatchState, unit: Unit): boolean {
  const source = before.units.find((u) => u.id === unit.id);
  if (
    source === undefined ||
    !source.isBot ||
    !unit.isBot ||
    source.classId !== 'healer' ||
    source.deadUntilTick !== null ||
    unit.deadUntilTick !== null ||
    before.commands[source.team] !== null ||
    botGoal(before, source.id) !== 'attack'
  )
    return false;
  const distance2 = (a: Unit, b: Unit) => (a.pos.x - b.pos.x) ** 2 + (a.pos.y - b.pos.y) ** 2;
  const selected = before.units
    .filter(
      (u) =>
        u.team === source.team &&
        u.id !== source.id &&
        u.deadUntilTick === null &&
        u.hp < unitMaxHp(u),
    )
    .sort(
      (a, b) =>
        a.hp / unitMaxHp(a) - b.hp / unitMaxHp(b) ||
        distance2(source, a) - distance2(source, b) ||
        a.id - b.id,
    )[0];
  if (selected === undefined) return false;
  const target = s.units.find((u) => u.id === selected.id);
  if (
    target === undefined ||
    target.deadUntilTick !== null ||
    distance2(unit, target) > HEALER_RADIUS ** 2 ||
    s.events.some((e) => e.kind === 'death' && (e.unitId === unit.id || e.unitId === target.id))
  )
    return false;
  const damage = s.events.reduce(
    (sum, e) => (e.kind === 'hit' && e.target === target.id ? sum + (e.dmg as number) : sum),
    0,
  );
  const preHealHp = selected.hp - damage;
  return preHealHp > 0 && preHealHp < unitMaxHp(target) && target.hp > preHealHp;
}

// Test-only observer: the original position thresholds and exemptions stay intact.
function checkStuck(before: MatchState, s: MatchState, refs: StuckRefs, t: number, seed: number) {
  for (const unit of s.units) {
    const goal = botGoal(s, unit.id);
    const opening = s.pads[unit.team].opening?.byUnit === unit.id;
    if (
      unit.deadUntilTick !== null ||
      goal === 'guard' ||
      opening ||
      supportedAllyWasHealed(before, s, unit)
    ) {
      refs.delete(unit.id);
      continue;
    }
    const ref = refs.get(unit.id);
    if (ref === undefined || Math.hypot(unit.pos.x - ref.pos.x, unit.pos.y - ref.pos.y) > 0.1) {
      refs.set(unit.id, { pos: { ...unit.pos }, since: t });
    } else if (t - ref.since > 100) {
      throw new Error(
        `seed ${seed}: bot ${unit.id} (${goal}) stuck at ` +
          `(${unit.pos.x.toFixed(2)},${unit.pos.y.toFixed(2)}) ticks ${ref.since}-${t}`,
      );
    }
  }
}

describe('never-stuck Healer exemption boundaries', () => {
  function observe(mode: string) {
    let s = createMatch(1);
    const healer = must(s.units.find((u) => u.id === 2));
    healer.classId = 'healer';
    healer.pos = { x: 20, y: 12 };
    const ally = must(s.units[0]);
    const extra = must(s.units[1]);
    // Keep id1 as guard by adding a lower-ID bot; helper only checks healer2.
    const lower = { ...structuredClone(extra), id: -1 };
    s.units.unshift(lower);
    for (const u of s.units) if (u.id !== healer.id) u.pos = { x: 4, y: 4 };
    ally.pos = { x: 20 + HEALER_RADIUS, y: 12 };
    ally.hp = mode === 'healthy' ? unitMaxHp(ally) : 10;
    if (mode === 'out-of-range') ally.pos.x += 0.01;
    if (mode === 'dead') ally.deadUntilTick = 9999;
    if (mode === 'non-selected') {
      extra.hp = 1;
      extra.pos = { x: 4, y: 4 };
    }
    if (mode === 'commanded') s.commands.fruit = 'attack';
    if (mode === 'non-healer') healer.classId = 'boxer';
    const refs: StuckRefs = new Map();
    for (let t = 0; t <= 102; t++) {
      const before = structuredClone(s);
      s = structuredClone(s);
      s.tick++;
      s.events = [];
      // Real healing phase, no fabricated healing events or HP increments.
      if (mode !== 'no-heal') updateClassHealing(s);
      // Preserve squad context while retaining position history only for healer2.
      const onlyHealer = new Map(refs);
      checkStuck(before, s, onlyHealer, t, 1);
      refs.clear();
      const ref = onlyHealer.get(healer.id);
      if (ref !== undefined) refs.set(healer.id, ref);
    }
  }

  it('permits stationary autonomous support only while actual healing is applied', () => {
    expect(() => observe('healing')).not.toThrow();
  });

  it.each([
    'out-of-range',
    'healthy',
    'dead',
    'non-selected',
    'commanded',
    'non-healer',
    'no-heal',
  ])('%s remains stuck after more than 100 stationary ticks', (mode) => {
    expect(() => observe(mode)).toThrow(/bot 2 .*stuck.*ticks 0-101/);
  });
});

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

  it('recovery: a carrying bot unloads onto the ground OFF the enlarged pad', () => {
    // R2b: the unload stand-off must stay derived from the pad rect. With the old
    // literal ±2.2 the point landed ON the 2.2-cell pad edge, where pickDrop
    // places instead of dropping and the recovery loop corrupts the wall.
    const s0 = createMatch(5, { humanUnit: null });
    s0.units = s0.units.filter((u) => u.id === 0); // the lone fruit bot
    must(s0.pads.fruit.cells[0])[1] = 900; // upper without lower: illegal wall -> recovery
    s0.crates.push({ id: 900, pos: { x: 0, y: 0 }, state: 'onPad', landTick: 0 });
    const bot = must(s0.units[0]);
    bot.pos = { x: 10.2, y: 19 }; // on col 1, NORTH of the unload point: pulse fires inside the rect
    bot.carrying = 101;
    s0.crates.push({ id: 101, pos: { ...bot.pos }, state: 'carried', landTick: 0 });
    const commands: Partial<Record<Team, SquadCommand>> = { fruit: 'fetch', dessert: null };
    let s = s0;
    let sawGround = false;
    for (let t = 0; t < 900 && !sawGround; t++) {
      s = step(s, new Map(), commands);
      const crate = s.crates.find((c) => c.id === 101);
      if (crate !== undefined && crate.state === 'ground') sawGround = true;
    }
    const crate101 = s.crates.find((c) => c.id === 101);
    expect(
      sawGround,
      `crate 101 never hit the ground (last state: ${crate101?.state ?? 'gone, pad: ' + JSON.stringify(s.pads.fruit.cells)})`,
    ).toBe(true);
    expect(must(s.units[0]).carrying).toBeNull();
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
      const refs: StuckRefs = new Map();
      for (let t = 0; t < 2400 && s.winner === null; t++) {
        const before = s;
        s = step(s, new Map());
        checkStuck(before, s, refs, t, seed);
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

  it('an all-bot team switches with >= 2 weapons only when no build is needed', () => {
    const s = createMatch(1, { humanUnit: null });
    must(s.units.find((u) => u.id === 0)).gun = { ammoCooldownTicks: 0 };
    expect(botGoal(s, 0)).toBe('fetch'); // one gun: defaults still apply (0 = 1st bot)
    expect(botGoal(s, 1)).toBe('guard');
    must(s.units.find((u) => u.id === 1)).gun = { ammoCooldownTicks: 0 };
    expect(botGoal(s, 0)).toBe('fetch'); // still needs bombs/buddies
    must(s.units.find((u) => u.id === 1)).bombs = 1;
    const base = must(s.units.find((u) => u.id === 2));
    s.units.push({ ...structuredClone(base), id: 6 }, { ...structuredClone(base), id: 7 });
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

/**
 * Mirror symmetry (card t_38d70034): rotating the whole arena 180 degrees about
 * (20,12) and swapping the teams must swap the bots' inputs with it. The two
 * teams' bots are paired by team index; the mirrored state puts the rotated
 * fruit record in the paired dessert slot (keeping the dessert id) and vice
 * versa, so an input that keys on unit id instead of team index breaks here.
 */
describe('bots: mirror symmetry (card t_38d70034)', () => {
  const rot = (v: Vec2): Vec2 => ({ x: 40 - v.x, y: 24 - v.y });
  const neg = (v: Vec2): Vec2 => ({ x: -v.x, y: -v.y });

  function mirrored(s: MatchState): { m: MatchState; pairs: Array<[UnitId, UnitId]> } {
    const fruit = s.units.filter((u) => u.team === 'fruit');
    const dessert = s.units.filter((u) => u.team === 'dessert');
    const pairs: Array<[UnitId, UnitId]> = [];
    const units: Unit[] = [];
    const paired = Math.min(fruit.length, dessert.length);
    for (let i = 0; i < paired; i++) {
      const f = fruit[i] as Unit;
      const d = dessert[i] as Unit;
      pairs.push([f.id, d.id]);
      // The paired slots exchange records under the rotation: the dessert slot
      // keeps its id but receives the rotated fruit record, and vice versa.
      units.push({ ...d, id: f.id, team: 'fruit', pos: rot(d.pos), facing: neg(d.facing) });
      units.push({ ...f, id: d.id, team: 'dessert', pos: rot(f.pos), facing: neg(f.facing) });
    }
    // Unpaired extras (a fresh buddy whose mirror does not exist yet) keep their
    // rotated record with their own id.
    for (let i = paired; i < fruit.length; i++) {
      const f = fruit[i] as Unit;
      units.push({ ...f, pos: rot(f.pos), facing: neg(f.facing) });
    }
    for (let i = paired; i < dessert.length; i++) {
      const d = dessert[i] as Unit;
      units.push({ ...d, pos: rot(d.pos), facing: neg(d.facing) });
    }
    units.sort((a, b) => a.id - b.id);
    const m = structuredClone(s);
    m.units = units;
    m.crates = s.crates.map((c) => ({ ...c, pos: rot(c.pos) }));
    const swapId = (id: UnitId): UnitId =>
      id < paired ? id + paired : id < 2 * paired ? id - paired : id;
    const mirrorPad = (from: Pad, team: Team): Pad => ({
      team,
      origin: { ...PAD_ORIGINS[team] },
      // Column c of one pad is the rotation of column (n-1-c) of the other.
      cells: from.cells.map((_, i) => [
        ...((from.cells[from.cells.length - 1 - i] ?? []) as Array<CrateId | null>),
      ]),
      opening:
        from.opening === null ? null : { ...from.opening, byUnit: swapId(from.opening.byUnit) },
    });
    m.pads = {
      fruit: mirrorPad(s.pads.dessert, 'fruit'),
      dessert: mirrorPad(s.pads.fruit, 'dessert'),
    };
    m.stalls = {
      fruit: { team: 'fruit', pos: stallCenter('fruit'), hp: s.stalls.dessert.hp },
      dessert: { team: 'dessert', pos: stallCenter('dessert'), hp: s.stalls.fruit.hp },
    };
    m.commands = { fruit: s.commands.dessert, dessert: s.commands.fruit };
    return { m, pairs };
  }

  function expectMirroredInput(s: MatchState, m: MatchState, fruitId: UnitId, dessertId: UnitId) {
    const a = botInput(s, fruitId);
    const b = botInput(m, dessertId);
    const where = `unit ${fruitId} vs mirrored ${dessertId} at tick ${s.tick}`;
    // Failure output names this test; `where` disambiguates via the throw below.
    if (
      Math.abs(b.move.x - -a.move.x) >= 1e-9 ||
      Math.abs(b.move.y - -a.move.y) >= 1e-9 ||
      (a.aim === null) !== (b.aim === null) ||
      (a.aim !== null &&
        (Math.abs(b.aim!.x - rot(a.aim).x) >= 1e-9 || Math.abs(b.aim!.y - rot(a.aim).y) >= 1e-9)) ||
      b.fire !== a.fire ||
      b.throwBomb !== a.throwBomb ||
      b.pickDrop !== a.pickDrop ||
      b.open !== a.open
    ) {
      throw new Error(`${where}: fruit=${JSON.stringify(a)} mirrored=${JSON.stringify(b)}`);
    }
  }

  it('dessert inputs are the exact rotation of fruit inputs in the mirrored state', () => {
    let s = createMatch(41, { humanUnit: null });
    const sampleTicks = new Set([200, 300, 400, 500, 599]);
    let compared = 0;
    for (let t = 0; t < 600 && s.winner === null; t++) {
      s = step(s, new Map());
      if (!sampleTicks.has(s.tick) || s.winner !== null) continue;
      const { m, pairs } = mirrored(s);
      for (const [fruitId, dessertId] of pairs) {
        const f = s.units.find((u) => u.id === fruitId);
        const d = s.units.find((u) => u.id === dessertId);
        if (f === undefined || d === undefined) continue;
        // The real match diverges chaotically (guard duels amplify float ulps
        // into divergent deaths), so liveness pairing is not guaranteed; the
        // card requires the input comparison for living bots only.
        if (f.deadUntilTick !== null || d.deadUntilTick !== null) continue;
        compared++;
        expectMirroredInput(s, m, fruitId, dessertId);
      }
    }
    // The check must stay meaningful: several live pairs compared overall.
    expect(compared).toBeGreaterThanOrEqual(3);
  }, 120_000);
});

/**
 * Full-match acceptance (card t_38d70034): 200 all-bot seeds (the card's report
 * scale) at current constants must finish (no timeouts), use the whole loadout
 * (bombs opened and thrown), put >= 25% of stall damage on bullets+bombs+heavy, and
 * take at least 60 s at the median (sanity floor only). There is deliberately
 * no pacing ceiling: plan Task 6 tunes constants toward a 300-480 s median, so
 * an upper bound here would block that card. Explicit hit.source classifies
 * normal/super damage without guessing from numeric damage values.
 */
describe('bots: full-match acceptance (card t_38d70034)', () => {
  it('200 seeds: bombs opened >= 20, explosions >= 20, bullets+bombs+heavy >= 25% of stall damage, median >= 60 s, 0 timeouts', () => {
    const SEEDS = 200;

    const CAP_TICKS = 900 * 20; // 15 min
    let bombsOpened = 0;
    let explosions = 0;
    const stallDmg = { slap: 0, gun: 0, bombs: 0, heavy: 0 };
    const durations: number[] = [];
    let fruitWins = 0;
    let timeouts = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      let s = createMatch(seed, { humanUnit: null });
      while (s.winner === null && s.tick < CAP_TICKS) {
        s = step(s, new Map());
        for (const e of s.events) {
          if (e.kind === 'opened' && e.recipe === 'bombs') bombsOpened++;
          else if (e.kind === 'explosion') explosions++;
          else if (e.kind === 'hit' && typeof e.target === 'string') {
            if (
              e.source !== 'slap' &&
              e.source !== 'gun' &&
              e.source !== 'bombs' &&
              e.source !== 'heavy'
            )
              throw new Error(`Unclassified stall hit: ${String(e.source)}`);
            expect(typeof e.dmg).toBe('number');
            stallDmg[e.source] += e.dmg as number;
          }
        }
      }
      if (s.winner === 'fruit') fruitWins++;
      if (s.winner === null) timeouts++;
      durations.push(s.tick / 20);
    }
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)] ?? 0;
    const total = stallDmg.slap + stallDmg.gun + stallDmg.bombs + stallDmg.heavy;
    const rangedShare = total === 0 ? 0 : (stallDmg.gun + stallDmg.bombs + stallDmg.heavy) / total;
    const winRate = fruitWins / SEEDS;
    console.log(
      `[full-match] wins fruit ${fruitWins}/${SEEDS} (${(winRate * 100).toFixed(1)}%), ` +
        `median ${median.toFixed(1)} s, p90 ${p90.toFixed(1)} s, timeouts ${timeouts}, ` +
        `bombsOpened ${bombsOpened}, explosions ${explosions}, ` +
        `stall dmg slap ${stallDmg.slap} / gun ${stallDmg.gun} / bombs ${stallDmg.bombs} / heavy ${stallDmg.heavy} ` +
        `(${(rangedShare * 100).toFixed(1)}% ranged)`,
    );
    expect(bombsOpened).toBeGreaterThanOrEqual(20);
    expect(explosions).toBeGreaterThanOrEqual(20);
    expect(rangedShare).toBeGreaterThanOrEqual(0.25);
    expect(median).toBeGreaterThanOrEqual(60);
    expect(timeouts).toBe(0);
    // Win rate is REPORTED, not gated: across near-fair builds it measured
    // 40.5-42.5% on this fixed 200-seed population (sd ~3.5 points), moving
    // with unrelated symmetric knobs, so a hard CI assertion cannot hold.
    // Measured 41.0% fruit / 59.0% dessert here; see the PR body for the
    // analysis (mutual-destruction ties resolve dessert-ward per the
    // documented updateWinner tie-break; fruit-first unit processing is worth
    // only ~+2 points to fruit, bisected). Balance constants are Task 6's.
  }, 600_000);
});
