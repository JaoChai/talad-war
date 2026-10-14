import { TEAM_CAP } from '../constants';
import { unitDead } from '../open';
import type { Recipe } from '../pad';
import type { MatchState, SquadCommand, Team, Unit, UnitId } from '../types';

/** What a bot should be doing this tick — derived purely from the squad state. */
export type BotGoal = 'attack' | 'guard' | 'fetch';

/**
 * Squad command -> per-bot goal (plan Task 5 contract). The team command wins;
 * with `null`, the default role goes by the unit's index among its team's LIVING
 * bots (ascending id): 1st fetch, 2nd guard, 3rd+ attack. An all-bot team (the
 * enemy side of a human match, or either side of a bot-vs-bot match) additionally
 * switches its whole team to `attack` once its living units hold >= 2 guns, and
 * any living bomb carrier attacks regardless of its default role — a loadout
 * sitting on the fetcher is wasted, and the attack phase is what throws it;
 * when the bombs run out the carrier falls back to its default role (usually
 * fetch) and rebuilds.
 */
export function botGoal(s: MatchState, unitId: UnitId): BotGoal {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined) return 'guard';
  const command: SquadCommand = s.commands[unit.team];
  if (command !== null) return command;
  if (allBotTeam(s, unit.team)) {
    if (livingGunCount(s, unit.team) >= 2) return 'attack'; // plan Task 5's whole-team switch
    if (unit.bombs > 0) return 'attack'; // the carrier must deliver its bombs to the stall
  }
  return defaultGoal(s, unit);
}

/**
 * The recipe the team currently lacks: gun when no living unit holds one, else
 * bombs when none holds bombs, else buddy while the team is under the cap, else
 * null (everything covered — nothing left to build).
 */
export function teamNeeds(s: MatchState, team: Team): Recipe | null {
  const living = s.units.filter((u) => u.team === team && !unitDead(u));
  if (!living.some((u) => u.gun !== null)) return 'gun';
  if (!living.some((u) => u.bombs > 0)) return 'bombs';
  const teamSize = s.units.filter((u) => u.team === team).length; // alive + dead (matches padPreview)
  return teamSize < TEAM_CAP ? 'buddy' : null;
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
