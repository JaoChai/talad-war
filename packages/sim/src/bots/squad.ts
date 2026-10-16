import { BOT_HEAVY_MIN_SUPPLY, TEAM_CAP } from '../constants';
import { unitDead } from '../open';
import type { Recipe } from '../pad';
import type { MatchState, SquadCommand, Team, Unit, UnitId } from '../types';

/** What a bot should be doing this tick — derived purely from the squad state. */
export type BotGoal = 'attack' | 'guard' | 'fetch';

/** Explicit commands win; autonomous squads retain one useful builder while needed. */
export function botGoal(s: MatchState, unitId: UnitId): BotGoal {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined) return 'guard';
  const command: SquadCommand = s.commands[unit.team];
  if (command !== null) return command;
  if (allBotTeam(s, unit.team)) {
    const needed = teamNeeds(s, unit.team);
    if (needed !== null) {
      const eligible = s.units.filter(
        (u) =>
          u.team === unit.team &&
          u.isBot &&
          !unitDead(u) &&
          (u.carrying !== null || (u.bombs === 0 && u.gun?.kind !== 'heavy')),
      );
      const builder = eligible.sort(
        (a, b) => Number(b.carrying !== null) - Number(a.carrying !== null) || a.id - b.id,
      )[0];
      if (builder?.id === unit.id) return 'fetch';
      // Expanded squads can retain defence even when equipment moves both
      // default support units into attacking/building roles. Small squads keep
      // the original pressure roles rather than reserving their only attacker.
      const livingCount = s.units.filter((u) => u.team === unit.team && !unitDead(u)).length;
      if (builder !== undefined && livingCount >= 4) {
        const guard = eligible.find((u) => u.id !== builder.id && u.carrying === null);
        if (guard?.id === unit.id) return 'guard';
      }
    } else if (livingGunCount(s, unit.team) >= 2) return 'attack';
    if (unit.bombs > 0 || unit.gun?.kind === 'heavy') return 'attack';
    const goal = defaultGoal(s, unit);
    return goal === 'fetch' ? 'attack' : goal;
  }
  return defaultGoal(s, unit);
}

/** Living equipment covers needs; dead teammates still occupy the buddy cap. */
export function teamNeeds(s: MatchState, team: Team): Recipe | null {
  const living = s.units.filter((u) => u.team === team && !unitDead(u));
  if (!living.some((u) => u.gun !== null)) return 'gun';
  const pad = s.pads[team];
  const compatible = pad.cells.every((c) => c[1] === null);
  const floorCount = compatible ? pad.cells.filter((c) => c[0] !== null).length : 0;
  const heavyAllowed = !s.itemBans?.[team]?.includes('heavy');
  // Once the third floor cell is down, finish even if the supply is interrupted.
  if (heavyAllowed && compatible && floorCount >= 3) return 'heavy';
  const hasBombs = living.some((u) => u.bombs > 0);
  const teamSize = s.units.filter((u) => u.team === team).length;
  if (hasBombs && teamSize < TEAM_CAP) return 'buddy';
  const carried = new Set(living.flatMap((u) => (u.carrying === null ? [] : [u.carrying])));
  const supply = floorCount + carried.size + s.crates.filter((c) => c.state === 'ground').length;
  const wantsHeavy =
    heavyAllowed &&
    compatible &&
    !living.some((u) => u.gun?.kind === 'heavy') &&
    supply >= BOT_HEAVY_MIN_SUPPLY;
  if (wantsHeavy && teamSize >= 4) return 'heavy';
  if (!hasBombs) return 'bombs';
  if (teamSize < TEAM_CAP) return 'buddy';
  return wantsHeavy ? 'heavy' : null;
}

function allBotTeam(s: MatchState, team: Team): boolean {
  return s.units.every((u) => u.team !== team || u.isBot);
}

function livingGunCount(s: MatchState, team: Team): number {
  return s.units.filter((u) => u.team === team && !unitDead(u) && u.gun !== null).length;
}

function defaultGoal(s: MatchState, unit: Unit): BotGoal {
  const livingBotIds = s.units
    .filter((u) => u.team === unit.team && u.isBot && !unitDead(u))
    .map((u) => u.id); // units ascend by id (setup.ts convention)
  const index = livingBotIds.indexOf(unit.id);
  if (index <= 0) return 'fetch';
  return index === 1 ? 'guard' : 'attack';
}
