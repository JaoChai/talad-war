import Phaser from 'phaser';
import './shell.css';
import { BootScene } from './scenes/Boot';
import { MatchScene } from './scenes/Match';
import { STAGE_H, STAGE_W } from './render/world';

/** Logical 720p stage; Scale.FIT letterboxes it into any screen. */
export const GAME_WIDTH = STAGE_W;
export const GAME_HEIGHT = STAGE_H;

export default new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1b1030',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 4,
  },
  scene: [BootScene, MatchScene],
});
