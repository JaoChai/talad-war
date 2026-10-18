import { canOpen, canStartOpen, controlledUnit, padPreview } from '@talad/sim';
import type { ClassPick, MatchState, UnitClass, UnitId, UnitInput } from '@talad/sim';

export interface ClassPickContext {
  unitId: UnitId;
  snapshot: string;
}

/**
 * The class-choice context for keyboard caching and queue validation: nonnull
 * only while the CONTROLLED unit can open a class wall (alive, empty-handed,
 * standing on the own pad, no channel running, openable wall of the class
 * recipe). R2-11 passes this to keyboard.handleKey and the tray HUD.
 */
export function classPickContext(s: MatchState): ClassPickContext | null {
  const unit = controlledUnit(s);
  if (unit === null || !canOpen(s, unit.id)) return null;
  if (padPreview(s, unit.team).recipe !== 'class') return null;
  return { unitId: unit.id, snapshot: JSON.stringify(s.pads[unit.team].cells) };
}

interface QueuedPick {
  context: ClassPickContext;
  classId: UnitClass;
}

/**
 * DOM-originated one-shot requests (class tray buttons + switch HUD). The
 * scene merges read() into the controlled unit's input next to the keyboard
 * and touch reads; no second simulation API is introduced — the sim stays
 * the only validator of the final open/switch (plan §2.2/§2.4).
 */
export class R2Controls {
  private pick: QueuedPick | null = null;
  private switchQueued = false;

  queuePick(context: ClassPickContext, classId: UnitClass): void {
    this.pick = { context: { ...context }, classId };
  }

  queueSwitch(): void {
    this.switchQueued = true;
  }

  /**
   * Consume one-shot requests. A pick fires only if the source is still the
   * controlled unit, the wall snapshot still matches and canStartOpen still
   * holds; stale requests are consumed without reissue. A validated pick emits
   * open:true together with the classPick (plan §2.2 shape): the sim only
   * starts the channel when input.open && canStartOpen (sim step.ts), so the
   * scene merge {...keyboard, ...tray} opens with no second sim API.
   * switchNext is emitted as requested — even for a dead source with a live
   * target — and the sim no-ops it when no teammate is eligible (drain stays
   * available, plan §2.4).
   */
  read(s: MatchState): Partial<UnitInput> {
    const out: Partial<UnitInput> = {};
    const pick = this.pick;
    this.pick = null;
    if (pick !== null) {
      const classPick: ClassPick = {
        classId: pick.classId,
        snapshot: pick.context.snapshot,
      };
      if (
        controlledUnit(s)?.id === pick.context.unitId &&
        canStartOpen(s, pick.context.unitId, classPick)
      ) {
        out.classPick = classPick;
        out.open = true;
      }
    }
    if (this.switchQueued) {
      this.switchQueued = false;
      out.switchNext = true;
    }
    return out;
  }

  /** Client reset on a successful controlSwitched (plan §2.4). */
  resetForHandoff(): void {
    this.pick = null;
    this.switchQueued = false;
  }
}
