import { CLASS_IDS } from '@talad/sim';
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

/** §4.3: one measured head landmark for one 256x256 sheet cell. */
export interface HeadFrame {
  x: number;
  y: number;
  width: number;
}

/** §4.2: per-class accessory keys and registration metadata. */
export interface ClassArtEntry {
  head: string;
  badge: string;
  pick: string;
  anchor: [number, number];
  fitWidth: number;
  bodyScale: number;
}

/** §4.2 top-level `classArt` block; optional so legacy manifests keep loading. */
export interface ClassArtManifest {
  headFrames: Record<string, HeadFrame[]>;
  classes: Record<string, ClassArtEntry>;
  control: { ring: string; arrow: string; switchIcon: string };
}

export interface ArtManifest {
  characters: Record<string, CharacterArt>;
  props: Record<string, ArtFile>;
  arena: ArtFile;
  classArt?: ClassArtManifest;
}

/**
 * §4.2/§4.3 schema gate for the optional classArt block: every skin needs one
 * finite landmark per sheet frame in range, and every referenced prop key must
 * exist. Undefined means "fall back to classless rendering", never a crash.
 */
export function validateClassArt(manifest: ArtManifest): ClassArtManifest | undefined {
  const ca = manifest.classArt;
  if (!ca || typeof ca !== 'object') return undefined;
  const skins = Object.keys(manifest.characters);
  if (!ca.headFrames || Object.keys(ca.headFrames).length !== skins.length) return undefined;
  for (const skin of skins) {
    const frames = ca.headFrames[skin];
    if (!Array.isArray(frames)) return undefined;
    if (frames.length !== manifest.characters[skin]!.frames.length) return undefined;
    for (const frame of frames) {
      if (!frame) return undefined;
      if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y) || !Number.isFinite(frame.width))
        return undefined;
      if (frame.x < 0 || frame.x > 256 || frame.y < 0 || frame.y > 256) return undefined;
      if (frame.width <= 0 || frame.width > 256) return undefined;
    }
  }
  if (!ca.classes || typeof ca.classes !== 'object') return undefined;
  for (const cls of CLASS_IDS) {
    const entry = ca.classes[cls];
    if (!entry) return undefined;
    for (const key of [entry.head, entry.badge, entry.pick]) {
      if (typeof key !== 'string' || !(key in manifest.props)) return undefined;
    }
    const [ax, ay] = entry.anchor;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return undefined;
    if (!Number.isFinite(entry.fitWidth) || entry.fitWidth <= 0) return undefined;
    if (!Number.isFinite(entry.bodyScale) || entry.bodyScale <= 0) return undefined;
  }
  if (!ca.control || typeof ca.control !== 'object') return undefined;
  for (const key of [ca.control.ring, ca.control.arrow, ca.control.switchIcon]) {
    if (typeof key !== 'string' || !(key in manifest.props)) return undefined;
  }
  return ca;
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
