import Phaser from 'phaser';
import './shell.css';

/** Logical 720p stage; Scale.FIT letterboxes it into any screen. */
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    // Intentionally empty — the map, walk and market UI land in later tasks.
  }
}

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
  scene: [BootScene],
});
