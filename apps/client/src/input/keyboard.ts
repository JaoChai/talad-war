import { canOpen, vecNormalize } from '@talad/sim';
import type { MatchState, UnitId, UnitInput, Vec2 } from '@talad/sim';

const MOVE_KEYS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1],
  KeyA: [-1, 0],
  KeyS: [0, 1],
  KeyD: [1, 0],
};

/**
 * Desktop keyboard → UnitInput (WASD move, E pick/drop-or-open, Q throw).
 * Mouse aim/fire are wired by the scene and passed to read() — the sim keeps
 * auto-aim whenever aim is null.
 */
export class KeyboardInput {
  private held = new Set<string>();
  private pickDropPulse = false;
  private throwPulse = false;

  handleKey(code: string, down: boolean): void {
    if (down) {
      if (!this.held.has(code)) {
        if (code === 'KeyE') this.pickDropPulse = true;
        if (code === 'KeyQ') this.throwPulse = true;
      }
      this.held.add(code);
    } else {
      this.held.delete(code);
    }
  }

  read(state: MatchState, unitId: UnitId, opts?: { fire?: boolean; aim?: Vec2 | null }): UnitInput {
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir[0];
        y += dir[1];
      }
    }
    const move = x === 0 && y === 0 ? { x: 0, y: 0 } : vecNormalize({ x, y });
    const wantsE = this.pickDropPulse;
    const wantsQ = this.throwPulse;
    this.pickDropPulse = false;
    this.throwPulse = false;
    // E = Pick/Drop and Open — Open wins when visible (sim rule mirrored here so
    // the input object is unambiguous).
    const open = wantsE && canOpen(state, unitId);
    return {
      move,
      aim: opts?.aim ?? null,
      fire: opts?.fire ?? false,
      throwBomb: wantsQ,
      pickDrop: wantsE && !open,
      open,
    };
  }
}
