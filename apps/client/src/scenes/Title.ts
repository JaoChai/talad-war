import Phaser from 'phaser';
import { readSoundPreference, writeSoundPreference } from '../audio';
import { th } from '../i18n/th';

export function journeyRoot(screen: string): HTMLElement {
  const root = document.createElement('main');
  root.className = 'tw-journey';
  root.dataset.screen = screen;
  root.setAttribute('aria-labelledby', 'tw-journey-heading');
  document.getElementById('app')!.appendChild(root);
  return root;
}

export function journeyButton(
  text: string,
  action: () => void,
  primary = false,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'tw-journey-btn tw-journey-btn--primary' : 'tw-journey-btn';
  button.textContent = text;
  button.addEventListener('click', action);
  return button;
}

/** Guaranteed different from the completed match, including uint32 wraparound. */
export function nextSeed(seed: number): number {
  return (seed + 1) >>> 0;
}

let howtoSeen = false;
function seenHowto(): boolean {
  try {
    howtoSeen = localStorage.getItem('tw.howto.seen') === '1' || howtoSeen;
  } catch {
    // Session-only fallback for denied storage.
  }
  return howtoSeen;
}

export class TitleScene extends Phaser.Scene {
  private root!: HTMLElement;
  private seed = 1;

  constructor() {
    super('title');
  }

  create(data: { seed?: number }): void {
    this.seed = data?.seed ?? 1;
    this.root = journeyRoot('title');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.root.remove());
    this.showTitle();
  }

  private showTitle(): void {
    this.root.dataset.screen = 'title';
    this.root.innerHTML = `
      <section class="tw-journey-panel tw-title-panel">
        <p class="tw-journey-eyebrow">${th.titleTagline}</p>
        <div class="tw-title-cast" aria-hidden="true">
          <span class="tw-mascot tw-mascot--fruit"></span>
          <img class="tw-title-crate" src="/art/prop_crate_stack2.webp" alt="" />
          <span class="tw-mascot tw-mascot--dessert"></span>
        </div>
        <h1 id="tw-journey-heading" tabindex="-1">${th.gameName}</h1>
        <div class="tw-journey-actions"></div>
      </section>`;
    const actions = this.root.querySelector('.tw-journey-actions')!;
    actions.append(
      journeyButton(
        th.play,
        () => {
          if (seenHowto()) this.startMatch();
          else this.showHowto(0);
        },
        true,
      ),
    );
    let on = readSoundPreference();
    const sound = journeyButton(on ? th.soundOn : th.soundOff, () => {
      on = !on;
      writeSoundPreference(on);
      sound.textContent = on ? th.soundOn : th.soundOff;
      sound.setAttribute('aria-pressed', String(on));
    });
    sound.setAttribute('aria-pressed', String(on));
    actions.append(sound);
    this.focusHeading();
  }

  private showHowto(card: number): void {
    this.root.dataset.screen = 'howto';
    const cards = [
      { title: th.howtoMove, body: th.howtoMoveBody, art: 'prop_crate.webp' },
      { title: th.howtoBuild, body: th.howtoBuildBody, art: 'prop_crate_stack2.webp' },
      { title: th.howtoWin, body: th.howtoWinBody, art: 'prop_stall_dessert_destroyed.webp' },
    ];
    const current = cards[card]!;
    this.root.innerHTML = `
      <section class="tw-journey-panel tw-howto-panel">
        <header class="tw-howto-header"><span>${th.howto}</span><span>${card + 1} / 3</span></header>
        <div class="tw-howto-content">
          <img class="tw-howto-art" src="/art/${current.art}" alt="" />
          <div><h1 id="tw-journey-heading" tabindex="-1">${current.title}</h1><p>${current.body}</p></div>
        </div>
        <div class="tw-journey-actions"></div>
      </section>`;
    const done = () => {
      howtoSeen = true;
      try {
        localStorage.setItem('tw.howto.seen', '1');
      } catch {
        // Starting the game must not depend on storage access.
      }
      this.startMatch();
    };
    this.root
      .querySelector('.tw-journey-actions')!
      .append(
        journeyButton(
          card === 2 ? th.play : th.next,
          card === 2 ? done : () => this.showHowto(card + 1),
          true,
        ),
        journeyButton(th.skip, done),
      );
    this.focusHeading();
  }

  private focusHeading(): void {
    this.root.querySelector<HTMLElement>('h1')!.focus({ preventScroll: true });
  }

  private startMatch(): void {
    this.scene.start('match', { seed: this.seed });
  }
}
