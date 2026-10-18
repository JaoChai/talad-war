import { CLASS_IDS } from './classes';
import {
  BOMBS_PER_RECIPE,
  OPEN_TICKS,
  SPAWN_OFFSETS,
  SUPER_BOMBS_PER_RECIPE,
  TEAM_CAP,
  UNIT_MAX_HP,
} from './constants';
import { stallCenter } from './map';
import { unitMaxHp } from './items';
import { canStartOpen, matchRecipe, padCellAt, recipeResult } from './pad';
import type { ClassPick, MatchState, Pad, Team, Unit, UnitClass, UnitId } from './types';

/** True while the unit waits for respawn — the single check Task 4 reuses. */
export function unitDead(unit: Unit): boolean {
  return unit.deadUntilTick !== null;
}

/**
 * Start the Open! channel on the unit's own pad: snapshot the pad cells so any
 * content change (a lift, a placement) cancels. Ordinary callers check canOpen;
 * class requests are always revalidated here, including direct calls.
 */
export function startOpen(s: MatchState, unitId: UnitId, classPick?: ClassPick): void {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined) return;
  const pad = s.pads[unit.team];
  const classWall = matchRecipe(pad) === 'class';
  if (classWall && !canStartOpen(s, unitId, classPick)) return;
  pad.opening = {
    byUnit: unit.id,
    doneTick: s.tick + OPEN_TICKS,
    snapshot: JSON.stringify(pad.cells),
    ...(classWall ? { classId: classPick?.classId } : {}),
  };
  s.events.push({ tick: s.tick, kind: 'openStarted', unitId: unit.id, team: unit.team });
}

/**
 * Phase 6 (first half): cancel openings whose pad contents changed or whose opener
 * died, then complete the ones that survived to doneTick. The cancel check runs
 * before the completion check, so changing the pad on the done tick cancels.
 */
export function updateOpens(s: MatchState): void {
  for (const team of ['fruit', 'dessert'] as const) {
    const pad = s.pads[team];
    const opening = pad.opening;
    if (opening === null) continue;
    const opener = s.units.find((u) => u.id === opening.byUnit);
    const classChannel = opening.classId !== undefined || matchRecipe(pad) === 'class';
    if (
      opener === undefined ||
      unitDead(opener) ||
      JSON.stringify(pad.cells) !== opening.snapshot ||
      (classChannel &&
        (opener.carrying !== null ||
          padCellAt(pad, opener.pos) === null ||
          s.units.filter((u) => u.team === team).length >= TEAM_CAP ||
          recipeResult(s, team)?.recipe !== 'class' ||
          opening.classId === undefined ||
          !CLASS_IDS.includes(opening.classId) ||
          s.itemBans?.[team]?.includes(opening.classId)))
    ) {
      pad.opening = null;
      s.events.push({ tick: s.tick, kind: 'openCancelled', team });
      continue;
    }
    if (s.tick >= opening.doneTick) finishOpen(s, pad, opener);
  }
}

function finishOpen(s: MatchState, pad: Pad, opener: Unit): void {
  const result = recipeResult(s, pad.team);
  const classId = pad.opening?.classId;
  pad.opening = null;
  if (
    result === null ||
    (result.recipe === 'buddy' && s.units.filter((u) => u.team === pad.team).length >= TEAM_CAP)
  ) {
    // Fail closed if a rule or the alive+dead buddy cap changed during the channel.
    s.events.push({ tick: s.tick, kind: 'openCancelled', team: pad.team });
    return;
  }
  const { recipe, super: quality } = result;
  let spawnedUnitId: UnitId | undefined;
  if (recipe === 'gun')
    opener.gun = quality
      ? { kind: 'gun', super: true, ammoCooldownTicks: 0 }
      : { ammoCooldownTicks: 0 };
  else if (recipe === 'heavy') opener.gun = { kind: 'heavy', super: quality, ammoCooldownTicks: 0 };
  else if (recipe === 'bombs') {
    opener.bombs = quality ? SUPER_BOMBS_PER_RECIPE : BOMBS_PER_RECIPE; // replace, not add
    opener.bombsSuper = quality;
  } else spawnedUnitId = spawnBuddy(s, pad.team, quality, recipe === 'class' ? classId : undefined);
  clearPad(s, pad); // every recipe converts the whole pad
  s.events.push({
    tick: s.tick,
    kind: 'opened',
    recipe,
    super: quality,
    team: pad.team,
    unitId: opener.id,
    ...(recipe === 'class' ? { classId, spawnedUnitId } : {}),
  });
}

/** The buddy spawns at the team's first spawn slot (setup.ts convention, walkable). */
function spawnBuddy(s: MatchState, team: Team, quality: boolean, classId?: UnitClass): UnitId {
  const center = stallCenter(team);
  const sign = team === 'fruit' ? 1 : -1;
  const offset = SPAWN_OFFSETS[0];
  if (offset === undefined) throw new Error('spawnBuddy: no spawn offsets defined');
  // createMatch assigns unit ids 0..5 without consuming nextId, so take the next id
  // that is unique against both the shared counter and every existing unit.
  let id = s.nextId;
  for (const unit of s.units) id = Math.max(id, unit.id + 1);
  s.nextId = id + 1;
  const buddy: Unit = {
    id,
    team,
    isBot: true, // bot behaviour arrives in Task 5; until then it only exists
    pos: { x: center.x + sign * offset.x, y: center.y + sign * offset.y },
    facing: team === 'fruit' ? { x: 1, y: 0 } : { x: -1, y: 0 },
    hp: UNIT_MAX_HP,
    ...(quality ? { superBuddy: true } : {}),
    ...(classId === undefined ? {} : { classId }),
    carrying: null,
    gun: null,
    bombs: 0,
    attackCooldownTicks: 0,
    deadUntilTick: null,
  };
  buddy.hp = unitMaxHp(buddy); // all persistent traits must be present first
  s.units.push(buddy);
  return id;
}

/** Every recipe consumes the pad: cells emptied, the pad's crates deleted. */
function clearPad(s: MatchState, pad: Pad): void {
  const ids = new Set<number>();
  for (const column of pad.cells) {
    for (const crate of column) {
      if (crate !== null) ids.add(crate);
    }
    column[0] = null;
    column[1] = null;
  }
  s.crates = s.crates.filter((c) => !ids.has(c.id));
}
