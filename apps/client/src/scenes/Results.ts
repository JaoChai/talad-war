import Phaser from 'phaser';
import type { MatchState } from '@talad/sim';
import { th } from '../i18n/th';
import type { MatchStats } from '../stats';
import { journeyButton, journeyRoot, nextSeed } from './Title';

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('results');
  }

  create(data: { winner: MatchState['winner']; seed: number; stats: MatchStats }): void {
    const root = journeyRoot('results');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => root.remove());
    const winner =
      data.winner === 'fruit'
        ? th.fruitWins
        : data.winner === 'dessert'
          ? th.dessertWins
          : th.drawResult;
    root.innerHTML = `
      <section class="tw-journey-panel tw-results-panel">
        <p class="tw-journey-eyebrow">${th.results}</p>
        <h1 id="tw-journey-heading" tabindex="-1">${winner}</h1>
        <div class="tw-results-teams"></div>
        <div class="tw-journey-actions"></div>
      </section>`;
    const teams = root.querySelector('.tw-results-teams')!;
    for (const team of ['fruit', 'dessert'] as const) {
      const section = document.createElement('section');
      section.dataset.team = team;
      section.className = `tw-score tw-score--${team}`;
      section.innerHTML = `<h2>${team === 'fruit' ? th.fruitTeam : th.dessertTeam}</h2><dl></dl>`;
      for (const key of ['cratesPlaced', 'itemsBuilt', 'stallDamage'] as const) {
        const row = document.createElement('div');
        const label = document.createElement('dt');
        label.textContent = th[key];
        const value = document.createElement('dd');
        value.dataset.stat = key;
        value.textContent = String(data.stats[team][key]);
        row.append(label, value);
        section.querySelector('dl')!.append(row);
      }
      teams.append(section);
    }
    root.querySelector('.tw-journey-actions')!.append(
      journeyButton(
        th.playAgain,
        () => this.scene.start('match', { seed: nextSeed(data.seed) }),
        true,
      ),
      journeyButton(th.home, () => this.scene.start('title', { seed: nextSeed(data.seed) })),
    );
    root.querySelector<HTMLElement>('h1')!.focus({ preventScroll: true });
  }
}
