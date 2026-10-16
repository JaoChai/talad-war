import type Phaser from 'phaser';

export type CharacterAnim = 'idle' | 'run' | 'carry' | 'windup' | 'slap' | 'hurt' | 'ko';

export interface ArtFile {
  file: string;
  width: number;
  height: number;
}

export interface CharacterArt {
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: string[];
  anims: Record<CharacterAnim, [number, number]>;
  anchor: [number, number];
}

export interface ArtManifest {
  characters: Record<string, CharacterArt>;
  props: Record<string, ArtFile>;
  arena: ArtFile;
}

const FRAME_RATES: Record<CharacterAnim, number> = {
  idle: 6,
  run: 12,
  carry: 10,
  windup: 1,
  slap: 1,
  hurt: 1,
  ko: 1,
};

/** Register only the named cells: the last two atlas cells are intentionally empty. */
export function createCharacterAnimations(scene: Phaser.Scene, manifest: ArtManifest): void {
  for (const [skin, art] of Object.entries(manifest.characters)) {
    for (const [name, [start, count]] of Object.entries(art.anims)) {
      const key = `${skin}:${name}`;
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(skin, { start, end: start + count - 1 }),
        frameRate: FRAME_RATES[name as CharacterAnim],
        repeat: count > 1 ? -1 : 0,
      });
    }
  }
}

/** Single poses stop the previous loop, so it cannot overwrite the chosen frame. */
export function playCharacterPose(
  sprite: Phaser.GameObjects.Sprite,
  art: CharacterArt | undefined,
  pose: CharacterAnim,
  still: boolean,
): void {
  if (!art) return;
  if (still || art.anims[pose][1] === 1) {
    sprite.anims.stop();
    sprite.setFrame(art.anims[pose][0]);
  } else {
    sprite.anims.play(`${sprite.texture.key}:${pose}`, true);
  }
}
