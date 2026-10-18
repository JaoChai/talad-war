import { controlledUnit, nextLivingTeammate } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { th } from '../i18n/th';

/**
 * R2 switch button (#tw-btn-switch, plan §5): a screen-HUD button for BOTH
 * desktop and touch — never inside the touch-only `.tw-btn` hiding selector.
 * 24 px swap icon + visible สลับตัว label + R hint (owner-approved key,
 * plan §2.4 answer A). Enabled for a dead source while another teammate
 * lives; visible+disabled with the Thai description when no target exists;
 * hidden without a controlled body or once the match is over.
 */
export class SwitchHud {
  readonly root: HTMLButtonElement;
  private readonly desc: HTMLSpanElement;

  constructor(mount: HTMLElement, onSwitch: () => void) {
    this.root = document.createElement('button');
    this.root.type = 'button';
    this.root.id = 'tw-btn-switch';
    this.root.className = 'tw-switch-btn';

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '24');
    icon.setAttribute('height', '24');
    icon.classList.add('tw-switch-icon');
    icon.setAttribute('aria-hidden', 'true');
    const arrow = (d: string) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'currentColor');
      return p;
    };
    icon.append(
      // swap arrows: top row → right, bottom row → left
      arrow('M4 7h11V4l6 4-6 4V9H4V7z'),
      arrow('M20 15H9v-3l-6 4 6 4v-3h11z'),
    );

    const label = document.createElement('span');
    label.className = 'tw-switch-label';
    label.textContent = th.switchUnit;

    const key = document.createElement('span');
    key.className = 'tw-switch-key';
    key.textContent = 'R';
    key.setAttribute('aria-hidden', 'true');

    this.desc = document.createElement('span');
    this.desc.id = 'tw-switch-desc';
    this.desc.className = 'tw-switch-desc';

    this.root.append(icon, label, key);
    this.root.hidden = true;
    mount.append(this.root, this.desc);

    this.root.addEventListener('click', () => {
      if (this.root.disabled) return;
      onSwitch();
    });
    // Pointer starts on the button never reach the canvas fire or joystick.
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  sync(s: MatchState): void {
    const unit = controlledUnit(s);
    if (unit === null || s.winner !== null) {
      this.root.hidden = true;
      this.root.disabled = true;
      this.desc.textContent = '';
      this.root.removeAttribute('aria-describedby');
      return;
    }
    this.root.hidden = false;
    if (nextLivingTeammate(s, unit.id) === null) {
      this.root.disabled = true;
      this.desc.textContent = th.switchUnavailable;
      this.root.setAttribute('aria-describedby', 'tw-switch-desc');
    } else {
      this.root.disabled = false;
      this.desc.textContent = '';
      this.root.removeAttribute('aria-describedby');
    }
  }

  destroy(): void {
    this.root.remove();
    this.desc.remove();
  }
}
