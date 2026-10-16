/** All shared simulation types. Pure data — no engine or DOM dependencies. */

export type Team = 'fruit' | 'dessert';
export type UnitId = number;
export type CrateId = number;
export type CrateKind = 'normal' | 'super';
export type ItemId = 'unarmed' | 'gun' | 'heavy' | 'bombs' | 'crate';
export type ItemBan = 'heavy' | 'super';

export interface Vec2 {
  x: number;
  y: number;
}

export interface UnitInput {
  move: Vec2; // length <= 1 (clamped)
  aim: Vec2 | null; // world point; null = auto-aim (Task 4)
  fire: boolean;
  throwBomb: boolean;
  pickDrop: boolean;
  open: boolean;
}

export type SquadCommand = 'attack' | 'guard' | 'fetch' | null;

export interface Unit {
  id: UnitId;
  team: Team;
  isBot: boolean;
  pos: Vec2;
  facing: Vec2;
  hp: number;
  carrying: CrateId | null;
  gun: { ammoCooldownTicks: number } | null;
  bombs: number;
  /** Ticks until the next unarmed slap may fire (Task 4). */
  attackCooldownTicks: number;
  deadUntilTick: number | null;
}

export type CrateState = 'falling' | 'ground' | 'carried' | 'onPad';

export interface Crate {
  id: CrateId;
  pos: Vec2;
  state: CrateState;
  /** Missing quality is normal for legacy callers; production spawns set it explicitly. */
  kind?: CrateKind;
  landTick: number;
}

export interface Pad {
  team: Team;
  origin: Vec2;
  /** [col 0..3][layer 0..1]; col = 2x2 floor index. */
  cells: (CrateId | null)[][];
  opening: { byUnit: UnitId; doneTick: number; snapshot: string } | null;
}

export interface Stall {
  team: Team;
  pos: Vec2;
  hp: number;
}

/** Declared now, used from Task 4. */
export interface Projectile {
  id: number;
  team: Team;
  kind: 'bullet' | 'bomb';
  pos: Vec2;
  vel: Vec2;
  ttlTicks: number;
}

export interface DropZone {
  team: Team | 'center';
  x: number;
  y: number;
  r: number;
}

export interface MatchEvent {
  tick: number;
  kind: string;
  [key: string]: unknown;
}

export interface MatchState {
  seed: number;
  rng: number;
  tick: number;
  units: Unit[];
  crates: Crate[];
  pads: Record<Team, Pad>;
  stalls: Record<Team, Stall>;
  projectiles: Projectile[];
  commands: Record<Team, SquadCommand>;
  /** Q10: 'draw' when both stalls reach 0 HP in the same tick. */
  winner: Team | 'draw' | null;
  /** Only the latest tick's events (the client reads them for SFX/FX). */
  events: MatchEvent[];
  nextId: number;
  /** Deterministic harness/testing rules; omitted in ordinary matches. */
  itemBans?: Partial<Record<Team, readonly ItemBan[]>>;
}
