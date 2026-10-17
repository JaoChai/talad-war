import type { Rect } from './geometry';
import type { DropZone, Team, Vec2 } from './types';

/** Every tunable number lives here. Fixed tick: 20 Hz. */
export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export const ARENA_W = 40;
export const ARENA_H = 24;

export const UNIT_SPEED = 6;
export const CARRY_SPEED = 4;
export const UNIT_RADIUS = 0.45;
export const PICK_RADIUS = 1.0;

export const DROP_INTERVAL_CENTER_TICKS = 60;
export const DROP_INTERVAL_SIDE_TICKS = 140;
export const DROP_FALL_TICKS = 30;
export const MAX_GROUND_CRATES = 10;
export const SUPER_CRATE_CHANCE = 1 / 16;

/** A resting crate must sit at least this far inside the arena bounds. */
export const CRATE_MARGIN = 0.1;

/** Q9 loadout values: units respawn at this HP after death. */
export const UNIT_MAX_HP = 100;
/** Q5 win condition target (Task 6-tuned pacing: ~6 min all-bot median). */
export const STALL_MAX_HP = 6500;

/**
 * Task 4 combat values (initial — the balance harness tunes them later).
 * Cooldowns are "ticks until the attack may fire again"; damage to stalls is
 * plain for bullets and slaps, and ×BOMB_STALL_MULT for bombs.
 */
export const SLAP_DMG = 8;
export const SLAP_RANGE = 1.2;
export const SLAP_COOLDOWN_TICKS = 10;
export const GUN_DMG = 12;
export const GUN_RANGE = 9;
export const GUN_COOLDOWN_TICKS = 6;
export const BULLET_SPEED = 18;
export const BOMB_DMG = 45;
export const BOMB_RADIUS = 2.2;
export const BOMB_THROW_RANGE = 7;
export const BOMB_FUSE_TICKS = 24;
export const BOMB_STALL_MULT = 1.5;
export const RESPAWN_TICKS = 100;

/** R1 profiles: normal v1 values above remain unchanged. */
export const SUPER_GUN_COOLDOWN_TICKS = 5;
export const SUPER_GUN_RANGE = 9.9;
export const SUPER_BOMBS_PER_RECIPE = 5;
export const SUPER_BOMB_RADIUS = 2.25;
export const SUPER_BUDDY_MAX_HP = 101;
export const SUPER_BUDDY_SPEED_MULT = 1.01;
export const HEAVY_DMG = 60;
export const SUPER_HEAVY_DMG = 65;
export const HEAVY_RANGE = 9;
export const HEAVY_COOLDOWN_TICKS = 30;
export const COCONUT_SPEED = 12;
export const HEAVY_RADIUS = 2.4;
export const HEAVY_STALL_MULT = 0.25;
export const BOT_HEAVY_MIN_SUPPLY = 4;

export const PAD_CELL_SIZE = 1.5;
export const PAD_FLOOR = 2; // 2x2 floor cells -> 4 pad columns
export const PAD_LAYERS = 2; // cells[col][layer 0..1]

/** Task 3: recipes and the Open! channel (1.0 s at 20 Hz). */
export const OPEN_TICKS = 20;
export const BOMBS_PER_RECIPE = 3; // the bombs recipe refills to this
export const TEAM_CAP = 5; // max units per team, alive + dead

export const STALL_RECTS: Record<Team, Rect> = {
  fruit: { minX: 3, minY: 18, maxX: 7, maxY: 22 },
  dessert: { minX: 33, minY: 2, maxX: 37, maxY: 6 }, // exact 180° rotation of fruit's
};

export const PAD_ORIGINS: Record<Team, Vec2> = {
  fruit: { x: 8, y: 18 },
  // Exact 180° rotation of the fruit pad rect (8,18)-(11,21) about (20,12); plan Step 3's
  // "(30,3.5)" was not rotation-symmetric — the card's symmetry acceptance wins (see ledger).
  dessert: { x: 29, y: 3 },
};

export const CENTER_DROP_ZONE: { x: number; y: number; r: number } = { x: 20, y: 12, r: 5 };

export const SIDE_DROP_ZONES: DropZone[] = [
  { team: 'fruit', x: 12, y: 16, r: 2 },
  { team: 'dessert', x: 28, y: 8, r: 2 },
];

/** Offsets from own stall center, fruit side; dessert uses the negated (rotated) offsets. */
export const SPAWN_OFFSETS: Vec2[] = [
  { x: 0, y: -2.8 },
  { x: -2.5, y: 2.8 },
  { x: 2.5, y: 2.8 },
];
