import type { MatchState, SquadCommand, Team } from '@talad/sim';
import type { SfxKey } from './audio';
import type { MatchStats } from './stats';

export interface AudioLogEntry {
  key: SfxKey;
  tick: number;
  timeMs: number;
  started: boolean;
  musicGain: number;
}

export interface StallFeedback {
  now: number;
  flashUntil: number;
  shakeAt: number;
  tint: number;
  x: number;
  y: number;
  sparks: number;
  damage: { text: string; y: number; alpha: number; screenFont: number }[];
}

/** window.__talad — Playwright drives matches through these (plan Task 8).
 *
 * The assignment lives inline in MatchScene behind a build-time constant so the
 * prod bundle contains no trace of it: `import.meta.env.VITE_TEST_HOOKS` is
 * baked in by vite.config.ts's `define`, making the guard statically false and
 * dead-code eliminated (grep dist for `__talad` → 0 hits without the flag).
 */
export interface TaladTestHooks {
  stats(): MatchStats;
  audioLog(): AudioLogEntry[];
  audioReady(): boolean;
  musicGain(): number;
  unitFeedback(id: number): {
    now: number;
    attackAt: number;
    x: number;
    y: number;
    width: number;
    flipX: boolean;
    slash: { kind: string; screenSize: number; alpha: number } | null;
  };
  stallFeedback(team: Team): StallFeedback;
  state(): MatchState;
  setSeed(seed: number): void;
  fastForward(ticks: number): void;
  setCommand(team: Team, cmd: SquadCommand): void;
  /** Teleport a unit (review round 1 #1: deterministic staging, no chase loops). */
  placeUnit(unitId: number, x: number, y: number): void;
  /**
   * Task 9 staging: clear the team's pad then place ground-layer crates in the
   * given columns (real crate objects, `state: 'onPad'` at the cell center).
   */
  setPadCrates(team: Team, cols: number[]): void;
  /** Task 9 staging: set a stall's HP (clamped to 0..STALL_MAX_HP). */
  setStallHp(team: Team, hp: number): void;
}
