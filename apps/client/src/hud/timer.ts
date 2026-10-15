import { TICK_HZ } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { th } from '../i18n/th';

/** Match clock: `M:SS` counted up from the sim tick (v1 has no time limit). */
export function formatElapsed(ticks: number): string {
  const totalSeconds = Math.floor(ticks / TICK_HZ);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Top-centre timer capsule (card layout: counts up, setSeed resets it to 0:00). */
export class MatchTimer {
  readonly el: HTMLDivElement;

  constructor(mount: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tw-timer';
    this.el.id = 'tw-timer';
    this.el.setAttribute('role', 'timer');
    this.el.setAttribute('aria-label', th.timerLabel);
    this.el.textContent = formatElapsed(0);
    mount.appendChild(this.el);
  }

  sync(state: MatchState): void {
    this.el.textContent = formatElapsed(state.tick);
  }
}
