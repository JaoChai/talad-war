import type { MatchState } from '@talad/sim';
import { th } from '../i18n/th';

/**
 * Winner banner — the one piece of the Task 8 minimal HUD that stayed in this
 * file; preview text moved to hud/padPreview.ts, the rest of the Task 9 HUD
 * lives in hud/{stallBars,timer,commands,aimMarker,buttons}.ts.
 */
export class MatchHud {
  private readonly winner: HTMLDivElement;

  constructor(mount: HTMLElement) {
    this.winner = document.createElement('div');
    this.winner.className = 'tw-winner';
    this.winner.hidden = true;
    mount.appendChild(this.winner);
  }

  sync(state: MatchState): void {
    if (state.winner !== null) {
      this.winner.textContent =
        state.winner === 'fruit' ? th.youWin : state.winner === 'dessert' ? th.youLose : th.draw;
      this.winner.hidden = false;
    }
  }
}
