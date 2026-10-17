import { PAD_CELL_SIZE, PAD_FLOOR, TEAM_CAP } from './constants';
import { pointInRect } from './geometry';
import { padRect } from './map';
import type { CrateId, MatchState, Pad, Team, UnitId, Vec2 } from './types';

export type Recipe = 'gun' | 'bombs' | 'buddy' | 'heavy' | 'class';

export type Preview =
  | { recipe: Recipe; super: boolean; openable: true }
  | {
      recipe: Recipe | null;
      super: boolean;
      openable: false;
      reason: 'notRecipe' | 'teamFull' | 'empty';
    };

/**
 * Floor cell under pos: col 0..3 (2x2 floor read as col = cellX + PAD_FLOOR * cellY)
 * or null off the pad. Col pairs 0-1, 2-3, 0-2, 1-3 share a side; 0-3 and 1-2 are
 * the diagonals.
 */
export function padCellAt(pad: Pad, pos: Vec2): number | null {
  if (!pointInRect(pos, padRect(pad.team))) return null;
  const origin = pad.origin;
  const cellX = Math.min(PAD_FLOOR - 1, Math.floor((pos.x - origin.x) / PAD_CELL_SIZE));
  const cellY = Math.min(PAD_FLOOR - 1, Math.floor((pos.y - origin.y) / PAD_CELL_SIZE));
  return cellY * PAD_FLOOR + cellX;
}

/** Center of pad column `col` — where a placed crate rests. */
export function padCellCenter(pad: Pad, col: number): Vec2 {
  const cellX = col % PAD_FLOOR;
  const cellY = Math.floor(col / PAD_FLOOR);
  return {
    x: pad.origin.x + cellX * PAD_CELL_SIZE + PAD_CELL_SIZE / 2,
    y: pad.origin.y + cellY * PAD_CELL_SIZE + PAD_CELL_SIZE / 2,
  };
}

/** Place a crate: ground layer first, upper layer second, 'full' when the column is taken. */
export function placeCrate(pad: Pad, col: number, crate: CrateId): 'ground' | 'upper' | 'full' {
  const column = pad.cells[col];
  if (column === undefined) throw new Error(`placeCrate: invalid column ${col}`);
  if ((column[0] ?? null) === null) {
    column[0] = crate;
    return 'ground';
  }
  if ((column[1] ?? null) === null) {
    column[1] = crate;
    return 'upper';
  }
  return 'full';
}

/** Remove and return the top crate of a column (upper first), or null when empty. */
export function liftTop(pad: Pad, col: number): CrateId | null {
  const column = pad.cells[col];
  if (column === undefined) throw new Error(`liftTop: invalid column ${col}`);
  const layer = (column[1] ?? null) !== null ? 1 : 0;
  const crate = column[layer] ?? null;
  if (crate === null) return null;
  column[layer] = null;
  return crate;
}

/**
 * v1 recipes, exact shapes only: 1 crate anywhere -> gun; 2 ground crates in
 * adjacent cols -> bombs; one column with both layers -> buddy. R1 adds exactly
 * four ground crates with every upper cell empty -> heavy. Anything else -> null.
 */
export function matchRecipe(pad: Pad): Recipe | null {
  let count = 0;
  let stackedCol: number | null = null;
  const groundCols: number[] = [];
  for (let col = 0; col < pad.cells.length; col++) {
    const column = pad.cells[col];
    if (column === undefined) continue;
    if ((column[0] ?? null) !== null) {
      count++;
      groundCols.push(col);
    }
    if ((column[1] ?? null) !== null) {
      count++;
      stackedCol = col;
    }
  }
  if (count === 1) return 'gun';
  if (count === 4 && groundCols.length === 4) return 'heavy';
  if (count === 2) {
    if (stackedCol !== null) return 'buddy'; // ground + upper in one column
    const a = groundCols[0] ?? -1;
    const b = groundCols[1] ?? -1;
    return areAdjacent(a, b) ? 'bombs' : null;
  }
  return null;
}

function areAdjacent(a: number, b: number): boolean {
  const dx = Math.abs((a % PAD_FLOOR) - (b % PAD_FLOOR));
  const dy = Math.abs(Math.floor(a / PAD_FLOOR) - Math.floor(b / PAD_FLOOR));
  return dx + dy === 1;
}

/** Resolve shape, team bans and quality before any recipe consumes its crates. */
export function recipeResult(s: MatchState, team: Team): { recipe: Recipe; super: boolean } | null {
  const pad = s.pads[team];
  const recipe = matchRecipe(pad);
  const bans = s.itemBans?.[team];
  if (recipe === null || (recipe === 'heavy' && bans?.includes('heavy'))) return null;
  const ids = new Set(pad.cells.flat());
  const quality =
    !bans?.includes('super') && s.crates.some((c) => ids.has(c.id) && c.kind === 'super');
  return { recipe, super: quality };
}

/** What Open! would give on this team's pad right now — the client renders this. */
export function padPreview(s: MatchState, team: Team): Preview {
  const pad = s.pads[team];
  if (countCrates(pad) === 0)
    return { openable: false, reason: 'empty', recipe: null, super: false };
  const result = recipeResult(s, team);
  if (result === null) return { openable: false, reason: 'notRecipe', recipe: null, super: false };
  if (result.recipe === 'buddy') {
    const teamSize = s.units.filter((u) => u.team === team).length; // alive + dead
    if (teamSize >= TEAM_CAP) return { ...result, openable: false, reason: 'teamFull' };
  }
  return { ...result, openable: true };
}

function countCrates(pad: Pad): number {
  let count = 0;
  for (const column of pad.cells) {
    for (const crate of column) if (crate !== null) count++;
  }
  return count;
}

/**
 * Open! is allowed here: standing on the own pad floor, alive, empty-handed, no
 * opening already running on the pad, and the preview is openable.
 */
export function canOpen(s: MatchState, unitId: UnitId): boolean {
  const unit = s.units.find((u) => u.id === unitId);
  if (unit === undefined || unit.deadUntilTick !== null || unit.carrying !== null) return false;
  const pad = s.pads[unit.team];
  if (pad.opening !== null) return false;
  if (padCellAt(pad, unit.pos) === null) return false;
  return padPreview(s, unit.team).openable;
}
