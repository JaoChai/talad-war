import { CLASS_IDS, canOpen, canStartOpen, padPreview, vecNormalize } from '@talad/sim';
import type { ClassPick, MatchState, UnitClass, UnitId, UnitInput, Vec2 } from '@talad/sim';
import type { ClassPickContext } from './r2Controls';

const MOVE_KEYS: Record<string, readonly [number, number]> = {
  KeyW: [0, -1],
  KeyA: [-1, 0],
  KeyS: [0, 1],
  KeyD: [1, 0],
};

/** Owner-approved 2026-10-17 (plan §2.4 OWNER? answer A): R switches; Q throw and E pick/open unchanged. */
const SWITCH_KEY = 'KeyR';

/** Digit1-4 → CLASS_IDS[0-3] = boxer/healer/ninja/giant (plan §2.4/§5 order). */
const DIGIT_CLASSES: ReadonlyMap<string, UnitClass> = new Map(
  CLASS_IDS.map((classId, i) => [`Digit${i + 1}`, classId] as const),
);

interface PendingPick {
  unitId: UnitId;
  snapshot: string;
  classId: UnitClass;
}

/** The wall snapshot when THIS unit can open a class wall, else null. */
function classWallSnapshot(s: MatchState, unitId: UnitId): string | null {
  if (!canOpen(s, unitId)) return null;
  const unit = s.units.find((u) => u.id === unitId)!;
  if (padPreview(s, unit.team).recipe !== 'class') return null;
  return JSON.stringify(s.pads[unit.team].cells);
}

/**
 * Desktop keyboard → UnitInput (WASD move, E pick/drop-or-open, Q throw,
 * R switch, digits 1-4 class picks inside a class context).
 * Mouse aim/fire are wired by the scene and passed to read() — the sim keeps
 * auto-aim whenever aim is null.
 */
export class KeyboardInput {
  private held = new Set<string>();
  private suppressed = new Set<string>();
  private pickDropPulse = false;
  private throwPulse = false;
  private switchPulse = false;
  private pendingPick: PendingPick | null = null;

  /**
   * `context` is the class-choice context at keydown (classPickContext from
   * input/r2Controls). Returns whether a Digit1-4 keydown was consumed by the
   * class context — the scene must NOT also route it to squad commands.
   * Outside a class context digits return false and keep their ordinary
   * squad-command routing. While a class channel owned by the controlled unit
   * runs, the context is null by definition (canOpen is false), so the scene
   * must swallow digits itself for that window (R2-11 routing).
   */
  handleKey(code: string, down: boolean, context?: ClassPickContext | null): boolean {
    if (down) {
      if (this.suppressed.has(code)) return false; // post-handoff auto-repeat
      const classId = context ? DIGIT_CLASSES.get(code) : undefined;
      if (classId && context) {
        if (!this.held.has(code)) {
          this.pendingPick = { unitId: context.unitId, snapshot: context.snapshot, classId };
        }
        this.held.add(code);
        return true; // consumed whether fresh or auto-repeated
      }
      if (!this.held.has(code)) {
        if (code === 'KeyE') this.pickDropPulse = true;
        if (code === 'KeyQ') this.throwPulse = true;
        if (code === SWITCH_KEY) this.switchPulse = true;
      }
      this.held.add(code);
    } else {
      this.held.delete(code);
      this.suppressed.delete(code);
    }
    return false;
  }

  /**
   * Client reset on a successful controlSwitched (plan §2.4): clears every
   * held key, pulse and cached pick. Physically-held keys stay suppressed
   * until released, so OS auto-repeat cannot re-fire movement or pulses.
   */
  resetForHandoff(): void {
    for (const code of this.held) this.suppressed.add(code);
    this.held.clear();
    this.pickDropPulse = false;
    this.throwPulse = false;
    this.switchPulse = false;
    this.pendingPick = null;
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
    const wantsSwitch = this.switchPulse;
    this.pickDropPulse = false;
    this.throwPulse = false;
    this.switchPulse = false;
    // E = Pick/Drop and Open — but on a class wall E alone neither lifts nor
    // opens: the wall opens only with an explicit class choice (plan §2.2).
    const wall = classWallSnapshot(state, unitId);
    const openable = wall === null && canOpen(state, unitId);

    // A cached digit pick fires exactly once, only for its cached source unit,
    // and only if the wall still validates (alive, empty-handed, on pad,
    // allowed class, unchanged snapshot — sim canStartOpen). Stale picks are
    // consumed without reissue. A validated pick emits open:true together with
    // the classPick (plan §2.2 shape): the sim only starts the channel when
    // input.open && canStartOpen (sim step.ts), so the pick must carry the
    // open itself. E alone on a class wall still never opens.
    const pending = this.pendingPick;
    this.pendingPick = null;
    let classPick: ClassPick | undefined;
    if (
      pending !== null &&
      pending.unitId === unitId &&
      canStartOpen(state, unitId, { classId: pending.classId, snapshot: pending.snapshot })
    ) {
      classPick = { classId: pending.classId, snapshot: pending.snapshot };
    }

    return {
      move,
      aim: opts?.aim ?? null,
      fire: opts?.fire ?? false,
      throwBomb: wantsQ,
      pickDrop: wantsE && wall === null && !openable,
      open: (wantsE && openable) || classPick !== undefined,
      ...(classPick !== undefined ? { classPick } : {}),
      ...(wantsSwitch ? { switchNext: true } : {}),
    };
  }
}
