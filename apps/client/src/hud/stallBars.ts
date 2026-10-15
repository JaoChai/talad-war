import { STALL_MAX_HP } from '@talad/sim';
import type { MatchState, Team } from '@talad/sim';
import { th } from '../i18n/th';

const ICONS: Record<Team, string> = {
  fruit: 'art/prop_stall_fruit_ok.webp',
  dessert: 'art/prop_stall_dessert_ok.webp',
};

const BAR_IDS: Record<Team, string> = { fruit: 'tw-bar-fruit', dessert: 'tw-bar-dessert' };
const NAMES: Record<Team, string> = { fruit: th.fruitStallName, dessert: th.dessertStallName };

/**
 * Top bar (card layout): fruit stall HP on the left growing rightwards, dessert
 * stall HP mirrored on the right depleting from the inner end. Fill reads
 * `stalls[team].hp` from the CURRENT state every frame; `aria-valuenow` is the
 * rounded percent.
 */
export class StallBars {
  readonly fruitBar: HTMLDivElement;
  readonly dessertBar: HTMLDivElement;

  constructor(mount: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'tw-topbar';
    this.fruitBar = buildSide(root, 'fruit');
    this.dessertBar = buildSide(root, 'dessert');
    mount.appendChild(root);
  }

  sync(state: MatchState): void {
    setBar(this.fruitBar, state.stalls.fruit.hp);
    setBar(this.dessertBar, state.stalls.dessert.hp);
  }
}

function buildSide(root: HTMLElement, team: Team): HTMLDivElement {
  const side = document.createElement('div');
  side.className = team === 'dessert' ? 'tw-hp tw-hp--dessert' : 'tw-hp';

  const icon = document.createElement('img');
  icon.src = ICONS[team];
  icon.alt = ''; // decorative — the progressbar carries the accessible name

  const track = document.createElement('div');
  track.className = 'tw-hp-track';
  const fill = document.createElement('div');
  fill.className = 'tw-hp-fill';
  fill.id = BAR_IDS[team];
  fill.setAttribute('role', 'progressbar');
  fill.setAttribute('aria-valuemin', '0');
  fill.setAttribute('aria-valuemax', '100');
  fill.setAttribute('aria-valuenow', '100');
  fill.setAttribute('aria-label', NAMES[team]);
  track.appendChild(fill);

  if (team === 'dessert') side.append(track, icon);
  else side.append(icon, track);
  root.appendChild(side);
  return fill;
}

function setBar(fill: HTMLDivElement, hp: number): void {
  const clamped = Math.max(0, Math.min(hp, STALL_MAX_HP));
  const pct = Math.round((clamped / STALL_MAX_HP) * 100);
  fill.style.width = `${pct}%`;
  fill.setAttribute('aria-valuenow', String(pct));
}
