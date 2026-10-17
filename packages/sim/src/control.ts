import { unitDead } from './open';
import type { MatchState, Unit, UnitId } from './types';

/** Ownership is body-derived, including while the human waits for respawn. */
export function controlledUnit(s: MatchState): Unit | null {
  let controlled: Unit | null = null;
  for (const unit of s.units) {
    if (!unit.isBot && (controlled === null || unit.id < controlled.id)) controlled = unit;
  }
  return controlled;
}

/** Numeric-ID cycle, independent of array order; dead sources may leave their body. */
export function nextLivingTeammate(s: MatchState, fromId: UnitId): Unit | null {
  const source = controlledUnit(s);
  if (source === null || source.id !== fromId) return null;
  const living = s.units
    .filter((u) => u.team === source.team && u.id !== fromId && !unitDead(u))
    .sort((a, b) => a.id - b.id);
  return living.find((u) => u.id > fromId) ?? living[0] ?? null;
}

/** Mutates the supplied state; step calls this only on its fresh clone. */
export function switchControl(s: MatchState, fromId: UnitId): UnitId | null {
  if (s.winner !== null) return null;
  const source = controlledUnit(s);
  if (source === null || source.id !== fromId) return null;
  const target = nextLivingTeammate(s, fromId);
  if (target === null) return null;

  source.isBot = true;
  target.isBot = false;
  for (const pad of Object.values(s.pads)) {
    if (pad.opening?.byUnit === source.id && pad.opening.classId !== undefined) {
      pad.opening = null;
      s.events.push({ tick: s.tick, kind: 'openCancelled', team: pad.team });
    }
  }
  s.events.push({
    kind: 'controlSwitched',
    fromUnitId: source.id,
    toUnitId: target.id,
    team: source.team,
    tick: s.tick,
  });
  return target.id;
}
