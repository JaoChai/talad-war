import {
  PAD_FLOOR,
  PAD_LAYERS,
  PAD_ORIGINS,
  SPAWN_OFFSETS,
  STALL_MAX_HP,
  UNIT_MAX_HP,
} from './constants';
import { stallCenter } from './map';
import type { MatchState, Pad, Team, Unit, UnitId } from './types';

const TEAMS: readonly Team[] = ['fruit', 'dessert'];

function makePad(team: Team): Pad {
  return {
    team,
    origin: PAD_ORIGINS[team],
    cells: Array.from({ length: PAD_FLOOR * PAD_FLOOR }, () =>
      Array.from({ length: PAD_LAYERS }, () => null),
    ),
    opening: null,
  };
}

/**
 * Initial state: tick 0, stalls at full HP, 3 units per team near their own stall —
 * fruit ids 0-2 then dessert ids 3-5 (ascending, fruit first). `humanUnit` marks the
 * manually controlled unit (default: fruit's first); every other unit is a bot.
 */
export function createMatch(seed: number, opts?: { humanUnit?: UnitId | null }): MatchState {
  const humanUnit = opts?.humanUnit === undefined ? 0 : opts.humanUnit;
  const units: Unit[] = [];
  let id: UnitId = 0;
  for (const team of TEAMS) {
    const center = stallCenter(team);
    const sign = team === 'fruit' ? 1 : -1; // dessert spawn points are the exact rotation
    const facing = team === 'fruit' ? { x: 1, y: 0 } : { x: -1, y: 0 };
    for (const offset of SPAWN_OFFSETS) {
      units.push({
        id,
        team,
        isBot: id !== humanUnit,
        pos: { x: center.x + sign * offset.x, y: center.y + sign * offset.y },
        facing,
        hp: UNIT_MAX_HP,
        carrying: null,
        gun: null,
        bombs: 0,
        deadUntilTick: null,
      });
      id++;
    }
  }
  return {
    seed,
    rng: seed | 0,
    tick: 0,
    units,
    crates: [],
    pads: { fruit: makePad('fruit'), dessert: makePad('dessert') },
    stalls: {
      fruit: { team: 'fruit', pos: stallCenter('fruit'), hp: STALL_MAX_HP },
      dessert: { team: 'dessert', pos: stallCenter('dessert'), hp: STALL_MAX_HP },
    },
    projectiles: [],
    commands: { fruit: null, dessert: null },
    winner: null,
    events: [],
    nextId: 1,
  };
}
