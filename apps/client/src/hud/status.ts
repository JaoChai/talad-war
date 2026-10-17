import type { MatchState } from '@talad/sim';
import { itemName, qualityName, th } from '../i18n/th';

/** Shared decorative art: text remains meaningful even if an image fails. */
export function itemLabel(text: string, superItem: boolean, heavy = false): HTMLSpanElement {
  const label = document.createElement('span');
  label.className = 'tw-item-label';
  const image = (file: string, className: string) => {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.addEventListener(
      'error',
      () => {
        img.hidden = true;
      },
      { once: true },
    );
    img.src = `/art/prop_${file}.webp`;
    return img;
  };
  if (heavy) label.append(image('shot_coconut', 'tw-item-coconut'));
  label.append(document.createTextNode(text));
  if (superItem) label.append(image('badge_super', 'tw-item-star'));
  return label;
}

/** Winner banner and the human's independent primary/cargo and bomb slots. */
export class MatchHud {
  readonly itemEl: HTMLDivElement;
  private readonly winner: HTMLDivElement;
  private itemKey = '';

  constructor(mount: HTMLElement) {
    this.winner = document.createElement('div');
    this.winner.className = 'tw-winner';
    this.winner.hidden = true;
    this.itemEl = document.createElement('div');
    this.itemEl.className = 'tw-loadout';
    this.itemEl.hidden = true;
    this.itemEl.setAttribute('role', 'status');
    this.itemEl.setAttribute('aria-atomic', 'true');
    mount.append(this.winner, this.itemEl);
  }

  sync(state: MatchState): void {
    const winnerText =
      state.winner === null
        ? ''
        : state.winner === 'fruit'
          ? th.youWin
          : state.winner === 'dessert'
            ? th.youLose
            : th.draw;
    if (this.winner.textContent !== winnerText) this.winner.textContent = winnerText;
    this.winner.hidden = winnerText === '';

    const unit = state.units[0];
    const visible = !!unit && unit.deadUntilTick === null && state.winner === null;
    this.itemEl.hidden = !visible;
    if (!visible) {
      if (this.itemKey !== '') {
        this.itemEl.replaceChildren();
        this.itemEl.removeAttribute('aria-label');
        this.itemKey = '';
      }
      return;
    }
    const cargo = unit.carrying !== null;
    const kind = cargo ? 'crate' : unit.gun ? (unit.gun.kind ?? 'gun') : 'unarmed';
    const quality = cargo
      ? state.crates.find((c) => c.id === unit.carrying)?.kind === 'super'
      : unit.gun?.super === true;
    const primary = qualityName(itemName(kind), quality);
    const bombs =
      unit.bombs > 0
        ? `${qualityName(itemName('bombs'), unit.bombsSuper === true)} ×${unit.bombs}`
        : '';
    // Stable DOM avoids per-frame announcements, retries of failed images, and
    // needless allocation. A slot change rebuilds both independent labels.
    const key = `${primary}|${bombs}`;
    if (key === this.itemKey) return;
    this.itemKey = key;
    const primaryEl = itemLabel(primary, quality, kind === 'heavy');
    primaryEl.classList.add('tw-item-primary');
    this.itemEl.replaceChildren(primaryEl);
    if (bombs) {
      const bombEl = itemLabel(bombs, unit.bombsSuper === true);
      bombEl.classList.add('tw-item-bombs');
      this.itemEl.append(bombEl);
    }
    this.itemEl.setAttribute('aria-label', [primary, bombs].filter(Boolean).join(' · '));
  }
}
