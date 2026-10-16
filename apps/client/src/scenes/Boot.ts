import Phaser from 'phaser';

import { createCharacterAnimations, type ArtManifest } from '../render/anims';

/** `?seed=<int>` overrides the match seed; anything else is seed 1. */
export function seedFromUrl(): number {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) ? n : 1;
}

/** Loads the art manifest, then every texture it lists, then starts Match. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    this.load.json('art-manifest', 'art/manifest.json');
  }

  create(): void {
    const manifest = this.cache.json.get('art-manifest') as ArtManifest | null;
    if (!manifest) {
      // No manifest: still enter the match (placeholders render untextured).
      this.scene.start('title', { seed: seedFromUrl() });
      return;
    }
    for (const [key, c] of Object.entries(manifest.characters)) {
      this.load.spritesheet(key, `art/${c.file}`, {
        frameWidth: c.frameWidth,
        frameHeight: c.frameHeight,
      });
    }
    for (const [key, p] of Object.entries(manifest.props)) {
      this.load.image(key, `art/${p.file}`);
    }
    this.load.image('arena', `art/${manifest.arena.file}`);
    this.load.once('complete', () => {
      createCharacterAnimations(this, manifest);
      this.scene.start('title', { seed: seedFromUrl() });
    });
    this.load.start();
  }
}
