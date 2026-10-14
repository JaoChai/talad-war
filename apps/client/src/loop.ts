/**
 * Fixed-step accumulator: converts frame time into whole sim ticks at a fixed
 * rate and reports the interpolation weight between the last two sim states.
 *
 * When a huge gap arrives (tab hidden / phone backgrounded), the catch-up is
 * clamped and the backlog is DROPPED — the sim never runs a burst of hundreds
 * of ticks on return (plan Review Focus 5).
 */
export class FixedLoop {
  private acc = 0;
  private readonly frameMs: number;

  constructor(
    hz: number,
    public readonly maxCatchUpTicks: number = 5,
  ) {
    this.frameMs = 1000 / hz;
  }

  /** Add frame time; returns the number of whole ticks to run this frame. */
  advance(dtMs: number): number {
    if (dtMs > 0) this.acc += dtMs;
    let ticks = Math.floor(this.acc / this.frameMs);
    if (ticks > this.maxCatchUpTicks) {
      ticks = this.maxCatchUpTicks;
      this.acc = ticks * this.frameMs; // drop the backlog — no spiral of death
    }
    this.acc -= ticks * this.frameMs;
    return ticks;
  }

  /** Interpolation weight between the previous and current sim state, in [0, 1). */
  alpha(): number {
    const a = this.acc / this.frameMs;
    return a < 0 ? 0 : a > 0.999 ? 0.999 : a;
  }
}
