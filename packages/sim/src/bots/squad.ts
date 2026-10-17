import {
  BOT_HEAVY_MIN_SUPPLY,
  TEAM_CAP,
  BOT_CLASS_MIN_SUPPLY,
  BOT_CLASS_TARGET_COUNT,
  BOT_CLASS_WOUNDED_FRACTION,
  BOT_CLASS_ENEMY_PAD_CRATES,
  BOT_CLASS_DUPLICATE_PENALTY,
  BOT_CLASS_HEALER_NEED_BONUS,
  BOT_CLASS_NINJA_NEED_BONUS,
  BOT_CLASS_GIANT_NEED_BONUS,
  BOT_CLASS_BOXER_NEED_BONUS,
} from '../constants';
import { CLASS_IDS } from '../classes';
import { unitMaxHp } from '../items';
import { unitDead } from '../open';
import { matchRecipe } from '../pad';
import type { Recipe } from '../pad';
import type { MatchState, SquadCommand, Team, Unit, UnitClass, UnitId } from '../types';

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
    // Even an equipped capped squad needs a builder to recover a now-illegal wall.
    const recovery = s.pads[unit.team].cells.some((c) => c[1] !== null);
    if (needed !== null || recovery) {
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

/** Pure need-based ranking; dead class teammates still own persistent traits. */
export function chooseClass(s: MatchState, team: Team): UnitClass | null {
  const bans = s.itemBans?.[team];
  if (bans?.includes('class')) return null;
  const squad = s.units.filter((u) => u.team === team);
  const living = squad.filter((u) => !unitDead(u));
  const enemy = team === 'fruit' ? 'dessert' : 'fruit';
  const wounded =
    living.filter((u) => u.hp < BOT_CLASS_WOUNDED_FRACTION * unitMaxHp(u)).length >= 2;
  const raid =
    s.pads[enemy].cells.flat().filter((c) => c !== null).length >= BOT_CLASS_ENEMY_PAD_CRATES;
  const threat = s.units.some(
    (u) => u.team !== team && !unitDead(u) && (u.bombs > 0 || u.gun?.kind === 'heavy'),
  );
  const unarmed = living.every((u) => u.gun === null && u.bombs === 0);
  const bonus: Record<UnitClass, number> = {
    healer: wounded ? BOT_CLASS_HEALER_NEED_BONUS : 0,
    ninja: raid ? BOT_CLASS_NINJA_NEED_BONUS : 0,
    giant: threat ? BOT_CLASS_GIANT_NEED_BONUS : 0,
    boxer: unarmed ? BOT_CLASS_BOXER_NEED_BONUS : 0,
  };
  let best: UnitClass | null = null,
    score = -Infinity;
  const offset = (s.seed >>> 0) % CLASS_IDS.length;
  for (let i = 0; i < CLASS_IDS.length; i++) {
    const classId = CLASS_IDS[(i + offset) % CLASS_IDS.length]!;
    if (bans?.includes(classId)) continue;
    const value =
      bonus[classId] -
      BOT_CLASS_DUPLICATE_PENALTY * squad.filter((u) => u.classId === classId).length;
    if (value > score) {
      best = classId;
      score = value;
    }
  }
  return best;
}

/** Living equipment covers needs; dead teammates still occupy recruitment/trait caps. */
export function teamNeeds(s: MatchState, team: Team): Recipe | null {
  const squad = s.units.filter((u) => u.team === team);
  const living = squad.filter((u) => !unitDead(u));
  const pad = s.pads[team];
  const canRecruitClass = squad.length < TEAM_CAP && chooseClass(s, team) !== null;
  const occupied = pad.cells
    .map((c, i) => (c.some((id) => id !== null) ? i : -1))
    .filter((i) => i >= 0);
  const wallExtensible =
    [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ].some((pair) => occupied.every((i) => pair.includes(i))) &&
    pad.cells.every((c) => c[1] === null || c[0] !== null);
  // Lead §3.1 clarification: a plain two-stack is not a class commitment.
  // Commitment spans both columns of a legal pair with >=3 crates and an upper.
  const committedWall =
    occupied.length === 2 &&
    pad.cells.flat().filter((id) => id !== null).length >= 3 &&
    pad.cells.some((c) => c[1] !== null);
  if (canRecruitClass && wallExtensible && (matchRecipe(pad) === 'class' || committedWall))
    return 'class';
  const compatible = pad.cells.every((c) => c[1] === null);
  const floorCount = compatible ? pad.cells.filter((c) => c[0] !== null).length : 0;
  const heavyAllowed = !s.itemBans?.[team]?.includes('heavy');
  if (heavyAllowed && compatible && floorCount >= 3) return 'heavy';
  if (!living.some((u) => u.gun !== null)) return 'gun';
  const carried = new Set(living.flatMap((u) => (u.carrying === null ? [] : [u.carrying])));
  const supply =
    pad.cells.flat().filter((c) => c !== null).length +
    carried.size +
    s.crates.filter((c) => c.state === 'ground').length;
  if (
    canRecruitClass &&
    wallExtensible &&
    squad.filter((u) => u.classId !== undefined).length < BOT_CLASS_TARGET_COUNT &&
    supply >= BOT_CLASS_MIN_SUPPLY
  )
    return 'class';
  const hasBombs = living.some((u) => u.bombs > 0);
  if (hasBombs && squad.length < TEAM_CAP) return 'buddy';
  const wantsHeavy =
    heavyAllowed &&
    compatible &&
    !living.some((u) => u.gun?.kind === 'heavy') &&
    floorCount + carried.size + s.crates.filter((c) => c.state === 'ground').length >=
      BOT_HEAVY_MIN_SUPPLY;
  if (wantsHeavy && squad.length >= 4) return 'heavy';
  if (!hasBombs) return 'bombs';
  if (squad.length < TEAM_CAP) return 'buddy';
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
    .map((u) => u.id);
  const index = livingBotIds.indexOf(unit.id);
  if (index <= 0) return 'fetch';
  return index === 1 ? 'guard' : 'attack';
}
