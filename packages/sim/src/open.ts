import { BOMBS_PER_RECIPE, OPEN_TICKS, SPAWN_OFFSETS, UNIT_MAX_HP } from './constants';
import { stallCenter } from './map';
import { matchRecipe } from './pad';
import type { MatchState, Pad, Team, Unit, UnitId } from './types';

/** True while the unit waits for respawn — the single check Task 4 reuses. */
export function unitDead(unit: Unit): boolean {
  return unit.deadUntilTick !== null;
}

/**
 * Start the Open! channel on the unit's own pad: snapshot the pad cells so any
 * content change (a lift, a placement) cancels. Callers must check `canOpen` first.
 */
export function startOpen(s: MatchState, unitId: UnitId): void {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined) return;
  const pad = s.pads[unit.team];
  pad.opening = {
    byUnit: unit.id,
    doneTick: s.tick + OPEN_TICKS,
    snapshot: JSON.stringify(pad.cells),
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
    if (
      opener === undefined ||
      unitDead(opener) ||
      JSON.stringify(pad.cells) !== opening.snapshot
    ) {
      pad.opening = null;
      s.events.push({ tick: s.tick, kind: 'openCancelled', team });
      continue;
    }
    if (s.tick >= opening.doneTick) finishOpen(s, pad, opener);
  }
}

function finishOpen(s: MatchState, pad: Pad, opener: Unit): void {
  const recipe = matchRecipe(pad);
  pad.opening = null;
  if (recipe === null) {
    // Unreachable while the snapshot matches (canOpen previewed a recipe at start);
    // fail closed rather than grant a phantom item.
    s.events.push({ tick: s.tick, kind: 'openCancelled', team: pad.team });
    return;
  }
  if (recipe === 'gun') opener.gun = { ammoCooldownTicks: 0 };
  else if (recipe === 'bombs')
    opener.bombs = BOMBS_PER_RECIPE; // refill, not add
  else spawnBuddy(s, pad.team);
  clearPad(s, pad); // every recipe converts the whole pad
  s.events.push({ tick: s.tick, kind: 'opened', recipe, team: pad.team });
}

/** The buddy spawns at the team's first spawn slot (setup.ts convention, walkable). */
function spawnBuddy(s: MatchState, team: Team): void {
  const center = stallCenter(team);
  const sign = team === 'fruit' ? 1 : -1;
  const offset = SPAWN_OFFSETS[0];
  if (offset === undefined) throw new Error('spawnBuddy: no spawn offsets defined');
  // createMatch assigns unit ids 0..5 without consuming nextId, so take the next id
  // that is unique against both the shared counter and every existing unit.
  let id = s.nextId;
  for (const unit of s.units) id = Math.max(id, unit.id + 1);
  s.nextId = id + 1;
  s.units.push({
    id,
    team,
    isBot: true, // bot behaviour arrives in Task 5; until then it only exists
    pos: { x: center.x + sign * offset.x, y: center.y + sign * offset.y },
    facing: team === 'fruit' ? { x: 1, y: 0 } : { x: -1, y: 0 },
    hp: UNIT_MAX_HP,
    carrying: null,
    gun: null,
    bombs: 0,
    deadUntilTick: null,
  });
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
