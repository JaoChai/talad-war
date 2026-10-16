import { describe, expect, it, vi } from 'vitest';
import {
  CENTER_DROP_ZONE,
  DROP_FALL_TICKS,
  MAX_GROUND_CRATES,
  SIDE_DROP_ZONES,
  SUPER_CRATE_CHANCE,
  createMatch,
  nextRandom,
  padCellCenter,
  spawnCrates,
  stateHash,
  step,
} from '../src/index';
import type { MatchState, UnitInput } from '../src/index';

function noBots(seed: number): MatchState {
  const state = createMatch(seed);
  for (const unit of state.units) unit.isBot = false;
  return state;
}

function input(patch: Partial<UnitInput> = {}): UnitInput {
  return {
    move: { x: 0, y: 0 },
    aim: null,
    fire: false,
    throwBomb: false,
    pickDrop: false,
    open: false,
    ...patch,
  };
}

function thirdDraw(seed: number): number {
  const oracle = createMatch(seed);
  nextRandom(oracle);
  nextRandom(oracle);
  return nextRandom(oracle);
}

function bracketSeeds(): { below: number; above: number } {
  const seeds = Array.from({ length: 32 }, (_, seed) => seed);
  const below = seeds.find((seed) => thirdDraw(seed) < SUPER_CRATE_CHANCE);
  const above = seeds.find((seed) => thirdDraw(seed) > SUPER_CRATE_CHANCE);
  expect(below, 'bounded seeds must exercise the configured super probability').toBeDefined();
  expect(above, 'bounded seeds must also exercise normal centre crates').toBeDefined();
  return { below: below!, above: above! };
}

describe('R1 crate identity and seeded quality', () => {
  it('center_uses_third_seeded_draw_and_strict_configured_threshold', async () => {
    const { below, above } = bracketSeeds();
    for (const seed of [1, below, above]) {
      const state = createMatch(seed);
      state.tick = 60;
      const oracle = structuredClone(state);
      const angle = nextRandom(oracle) * Math.PI * 2;
      const radius = Math.sqrt(nextRandom(oracle)) * CENTER_DROP_ZONE.r;
      const quality = nextRandom(oracle);
      spawnCrates(state);
      expect(state.crates).toHaveLength(1);
      expect(state.crates[0]).toEqual({
        id: 1,
        pos: {
          x: CENTER_DROP_ZONE.x + Math.cos(angle) * radius,
          y: CENTER_DROP_ZONE.y + Math.sin(angle) * radius,
        },
        state: 'falling',
        landTick: 60 + DROP_FALL_TICKS,
        kind: quality < SUPER_CRATE_CHANCE ? 'super' : 'normal',
      });
      expect(state.rng).toBe(oracle.rng);
      expect(state.nextId).toBe(2);
    }

    // Exact equality is impractical to find at the real probability in 32 seeds.
    // Override only configuration to put the real generator draw on the boundary.
    vi.resetModules();
    vi.doMock('../src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/constants')>()),
      SUPER_CRATE_CHANCE: thirdDraw(below),
    }));
    try {
      const boundarySim = await import('../src/index');
      const boundary = boundarySim.createMatch(below);
      boundary.tick = 60;
      boundarySim.spawnCrates(boundary);
      expect(boundary.crates[0]?.kind, 'equality must remain normal, not super').toBe('normal');
    } finally {
      vi.doUnmock('../src/constants');
      vi.resetModules();
    }
  });

  it('sides_are_normal_and_use_two_draws', () => {
    for (const tick of [140, 280]) {
      const state = createMatch(1);
      state.tick = tick;
      const oracle = structuredClone(state);
      const zone = SIDE_DROP_ZONES[(tick / 140) % SIDE_DROP_ZONES.length]!;
      const angle = nextRandom(oracle) * Math.PI * 2;
      const radius = Math.sqrt(nextRandom(oracle)) * zone.r;
      spawnCrates(state);
      expect(state.crates).toEqual([
        {
          id: 1,
          pos: { x: zone.x + Math.cos(angle) * radius, y: zone.y + Math.sin(angle) * radius },
          state: 'falling',
          landTick: tick + DROP_FALL_TICKS,
          kind: 'normal',
        },
      ]);
      expect(state.rng).toBe(oracle.rng);
      expect(state.events).toContainEqual({
        tick,
        kind: 'crateSpawn',
        crateId: 1,
        zone: zone.team,
      });
    }
  });

  it('capped_spawn_preserves_rng_and_nextId', () => {
    const state = createMatch(1);
    state.tick = 420; // Both centre and side attempts must return before consuming anything.
    state.crates = Array.from({ length: MAX_GROUND_CRATES }, (_, i) => ({
      id: 100 + i,
      pos: { x: 12, y: 12 },
      state: 'ground',
      landTick: 0,
    }));
    const before = structuredClone(state);
    spawnCrates(state);
    expect(state).toEqual(before);

    // Carried, on-pad and falling crates must not count against the ground cap.
    state.crates[0]!.state = 'carried';
    state.crates.push(
      { id: 200, pos: { x: 12, y: 12 }, state: 'onPad', landTick: 0 },
      { id: 201, pos: { x: 12, y: 12 }, state: 'falling', landTick: 999 },
    );
    const oracle = structuredClone(state);
    for (let draw = 0; draw < 5; draw++) nextRandom(oracle);
    spawnCrates(state);
    expect(state.crates.slice(-2).map((crate) => crate.kind)).toEqual([
      thirdDraw(1) < SUPER_CRATE_CHANCE ? 'super' : 'normal',
      'normal',
    ]);
    expect(state.nextId).toBe(before.nextId + 2);
    expect(state.rng).toBe(oracle.rng);
  });

  it('kind_survives_fall_pick_drop_place_lift_and_damage_drop', () => {
    const { below, above } = bracketSeeds();
    for (const [seed, kind] of [
      [below, 'super'],
      [above, 'normal'],
    ] as const) {
      let state = noBots(seed);
      state.tick = 60;
      spawnCrates(state);
      const id = state.crates[0]!.id;
      const expectCrate = (phase: string) => {
        expect(state.crates.find((crate) => crate.id === id)).toMatchObject({
          id,
          kind,
          state: phase,
        });
      };
      expectCrate('falling');
      for (let tick = 0; tick < DROP_FALL_TICKS; tick++) state = step(state, new Map());
      expectCrate('ground');
      state.units[0]!.pos = { ...state.crates[0]!.pos };
      state = step(state, new Map([[0, input({ pickDrop: true })]]));
      expectCrate('carried');
      expect(state.units[0]!.carrying).toBe(id);
      state.units[0]!.pos = { x: 12, y: 12 };
      state = step(state, new Map([[0, input({ pickDrop: true })]]));
      expectCrate('ground');
      expect(state.units[0]!.carrying).toBeNull();
      state = step(state, new Map([[0, input({ pickDrop: true })]]));
      expectCrate('carried');
      state.units[0]!.pos = padCellCenter(state.pads.fruit, 0);
      state = step(state, new Map([[0, input({ pickDrop: true })]]));
      expectCrate('onPad');
      expect(state.pads.fruit.cells[0]![0]).toBe(id);
      expect(state.units[0]!.carrying).toBeNull();
      state = step(state, new Map([[0, input({ pickDrop: true })]]));
      expectCrate('carried');
      expect(state.pads.fruit.cells[0]![0]).toBeNull();
      expect(state.units[0]!.carrying).toBe(id);
      state.units[0]!.pos = { x: 12, y: 12 };
      state.units[3]!.pos = { x: 13, y: 12 };
      const hp = state.units[0]!.hp;
      state = step(state, new Map([[3, input({ fire: true })]]));
      expect(state.units[0]!.hp).toBeLessThan(hp);
      expect(state.units[0]!.carrying).toBeNull();
      expectCrate('ground');
      expect(state.events).toContainEqual({
        tick: state.tick,
        kind: 'crateDrop',
        crateId: id,
        unitId: 0,
      });
    }
  });

  it('hash_changes_when_only_crate_kind_changes', () => {
    const normal = createMatch(1);
    normal.crates.push({
      id: 99,
      pos: { x: 12, y: 12 },
      state: 'ground',
      landTick: 0,
      kind: 'normal',
    });
    const upgraded = structuredClone(normal);
    upgraded.crates[0]!.kind = 'super';
    expect(stateHash(normal)).not.toBe(stateHash(upgraded));
    upgraded.crates[0]!.kind = 'normal';
    expect(upgraded).toEqual(normal);
    expect(stateHash(upgraded)).toBe(stateHash(normal));
  });

  it('same_seed_and_actions_replay_super_traffic', () => {
    function replay(seed: number) {
      let state = noBots(seed);
      const hashes: string[] = [];
      const exercised = new Set<number>();
      for (let tick = 0; tick < 2000; tick++) {
        // Script identical pick/drop pulses, staging the actor at the chosen crate.
        const target = state.crates.find(
          (crate) => crate.kind === 'super' && crate.state === 'ground',
        );
        if (target) state.units[0]!.pos = { ...target.pos };
        const carrying = state.units[0]!.carrying;
        state = step(
          state,
          new Map([[0, input({ pickDrop: target !== undefined || carrying !== null })]]),
        );
        const held = state.crates.find((crate) => crate.id === state.units[0]!.carrying);
        if (held?.kind === 'super') exercised.add(held.id);
        hashes.push(stateHash(state));
      }
      return { hashes, exercised: [...exercised], tick: state.tick };
    }

    for (let seed = 0; seed < 32; seed++) {
      const first = replay(seed);
      if (first.exercised.length === 0) continue;
      const second = replay(seed);
      expect(first.tick).toBe(2000);
      expect(first.exercised.length).toBeGreaterThanOrEqual(1);
      expect(second).toEqual(first);
      console.info(
        `R1 replay seed=${seed}; ticks=${first.tick}; exercised super IDs=${first.exercised.join(',')}`,
      );
      return;
    }
    expect.fail('no actual super cargo exercised in fixed seeds 0–31');
  });
});
