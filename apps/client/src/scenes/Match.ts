import Phaser from 'phaser';
import { STALL_MAX_HP, TICK_HZ, canOpen, createMatch, padCellCenter, step } from '@talad/sim';
import type { MatchState, SquadCommand, Team, UnitId, UnitInput, Vec2 } from '@talad/sim';
import { AudioMixer, readSoundPreference, sfxForTick } from '../audio';
import type { SfxKey } from '../audio';
import { AimMarker } from '../hud/aimMarker';
import { SquadCommands } from '../hud/commands';
import { MatchHud } from '../hud/status';
import { PreviewText } from '../hud/padPreview';
import { PadGlow } from '../hud/padGlow';
import { StallBars } from '../hud/stallBars';
import { MatchTimer } from '../hud/timer';
import { shouldRotate } from '../hud/rotatePrompt';
import { emptyStats, tallyStats } from '../stats';
import { KeyboardInput } from '../input/keyboard';
import { TouchControls, isTouchDevice } from '../input/touch';
import { FixedLoop } from '../loop';
import { MatchView } from '../render/view';
import { stageToWorld } from '../render/world';
import type { AudioLogEntry, TaladTestHooks } from '../testHooks';

const HUMAN_UNIT: UnitId = 0;

/** Static at build time: the prod bundle folds this block (and `__talad`) away. */
const TEST_HOOKS_ENABLED = import.meta.env.VITE_TEST_HOOKS === '1';

/** Desktop squad-command keys (card: Digit1/2/3 mirror the three buttons). */
const COMMAND_KEYS: Record<string, 'attack' | 'guard' | 'fetch'> = {
  Digit1: 'attack',
  Digit2: 'guard',
  Digit3: 'fetch',
};

/**
 * The playable match: fixed 20 Hz sim stepping inside the render loop,
 * interpolated rendering, keyboard + touch controls, and the Task 9 HUD
 * overlay (stall bars, timer, squad commands, pad preview + glow, aim marker).
 * Review Focus 5: document.hidden freezes the sim; the FixedLoop clamps any
 * catch-up burst to 5 ticks.
 */
export class MatchScene extends Phaser.Scene {
  private state!: MatchState;
  private prevState!: MatchState;
  private loop = new FixedLoop(TICK_HZ, 5);
  private keyboard = new KeyboardInput();
  private stats = emptyStats();
  private resultsTimer: number | null = null;
  private view!: MatchView;
  private hudRoot!: HTMLElement;
  private hud!: MatchHud;
  private stallBars!: StallBars;
  private timer!: MatchTimer;
  private commandsUi!: SquadCommands;
  private preview!: PreviewText;
  private glow!: PadGlow;
  private aimMarker!: AimMarker;
  private touch: TouchControls | null = null;
  private aim: Vec2 | null = null;
  private fireHeld = false;
  private command: Partial<Record<Team, SquadCommand>> = {};
  private audio = new AudioMixer();
  private observeAudio: ((key: SfxKey, started: boolean) => void) | null = null;

  constructor() {
    super('match');
  }

  create(data: { seed?: number }): void {
    const mount = document.getElementById('app');
    if (!mount) throw new Error('MatchScene: #app mount missing');
    this.state = createMatch(data?.seed ?? 1);
    this.prevState = structuredClone(this.state);
    this.loop = new FixedLoop(TICK_HZ, 5);
    this.keyboard = new KeyboardInput();
    this.stats = emptyStats();
    this.resultsTimer = null;
    this.command = {};
    this.aim = null;
    this.fireHeld = false;
    this.audio = new AudioMixer();
    this.audio.setMuted(!readSoundPreference());

    // Capture DOM controls too: touch buttons stop propagation before Phaser.
    const unlock = (event: Event) => {
      if (event.isTrusted) void this.audio.unlock();
    };
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.resultsTimer !== null) window.clearTimeout(this.resultsTimer);
      this.resultsTimer = null;
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      this.audio.dispose();
      this.observeAudio = null;
      this.hudRoot.remove();
      this.touch?.destroy();
      this.touch = null;
      this.input.removeAllListeners();
      if (TEST_HOOKS_ENABLED) {
        delete (window as unknown as { __talad?: TaladTestHooks }).__talad;
      }
    });

    this.view = new MatchView(this);
    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'tw-screen-hud';
    mount.appendChild(this.hudRoot);
    this.stallBars = new StallBars(this.hudRoot);
    this.timer = new MatchTimer(this.hudRoot);
    this.commandsUi = new SquadCommands(this.hudRoot, (cmd) => {
      // Merge (not overwrite): the dessert command must survive a fruit toggle.
      this.command = { ...this.command, fruit: cmd };
    });
    this.preview = new PreviewText(this.hudRoot);
    this.hud = new MatchHud(this.hudRoot);
    this.glow = new PadGlow(this);
    this.aimMarker = new AimMarker(this);
    if (isTouchDevice()) this.touch = new TouchControls(mount);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.aim = stageToWorld({ x: p.x, y: p.y });
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.aim = stageToWorld({ x: p.x, y: p.y });
      this.fireHeld = true;
    });
    this.input.on('pointerup', () => {
      this.fireHeld = false;
    });
    this.input.on('pointerupoutside', () => {
      this.fireHeld = false;
    });
    const keydown = (e: KeyboardEvent) => {
      this.keyboard.handleKey(e.code, true);
      const cmd = COMMAND_KEYS[e.code];
      if (cmd && !e.repeat) this.commandsUi.request(cmd);
    };
    const keyup = (e: KeyboardEvent) => this.keyboard.handleKey(e.code, false);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    });

    if (TEST_HOOKS_ENABLED) {
      const audioLog: AudioLogEntry[] = [];
      this.observeAudio = (key, started) => {
        audioLog.push({
          key,
          tick: this.state.tick,
          timeMs: performance.now(),
          started,
          musicGain: this.audio.musicGain,
        });
      };
      const hooks: TaladTestHooks = {
        artFeedback: () => ({
          animations: this.textures
            .getTextureKeys()
            .flatMap((key) => this.anims.getAnimsFromTexture(key))
            .map((key) => this.anims.get(key)!)
            .map((anim) => ({
              key: anim.key,
              frames: anim.frames.map((frame) => Number(frame.textureFrame)),
              fps: anim.frameRate,
              repeat: anim.repeat,
            })),
          sprites: this.children.list
            .filter(
              (child) =>
                child instanceof Phaser.GameObjects.Sprite ||
                child instanceof Phaser.GameObjects.Image,
            )
            .map((child) => {
              const sprite = child as Phaser.GameObjects.Sprite;
              return {
                name: sprite.name,
                texture: sprite.texture.key,
                frame: Number(sprite.frame.name),
                anim: sprite.anims?.currentAnim?.key ?? '',
                playing: sprite.anims?.isPlaying ?? false,
                timeScale: sprite.anims?.timeScale ?? 1,
                width: sprite.displayWidth,
                height: sprite.displayHeight,
                x: sprite.x,
                y: sprite.y,
                originX: sprite.originX,
                originY: sprite.originY,
                visible: sprite.visible,
              };
            }),
        }),
        renderSnapshot: (prev, cur, alpha) => {
          this.view.sync(prev, cur, alpha);
          this.preview.sync(cur);
          this.hud.sync(cur);
        },
        stats: () => structuredClone(this.stats),
        audioLog: () => structuredClone(audioLog),
        audioReady: () => this.audio.isReady,
        musicGain: () => this.audio.musicGain,
        unitFeedback: (id) => {
          const sprite = this.children.getByName(`unit-${id}`) as Phaser.GameObjects.Sprite | null;
          const slash = this.children.getByName(
            `attack-slash-${id}`,
          ) as Phaser.GameObjects.Graphics | null;
          return {
            slash: slash
              ? {
                  kind: slash.getData('kind') as string,
                  screenSize: (slash.getData('size') as number) * this.scale.displayScale.x ** -1,
                  alpha: slash.alpha,
                }
              : null,
            now: this.time.now,
            attackAt: (sprite?.getData('attackAt') as number | undefined) ?? -1,
            x: sprite?.x ?? 0,
            y: sprite?.y ?? 0,
            width: sprite?.displayWidth ?? 0,
            flipX: sprite?.flipX ?? false,
          };
        },
        stallFeedback: (team) => {
          // Observe real Phaser objects; no renderer test-only methods.
          const stall = this.children.getByName(`stall-${team}`) as Phaser.GameObjects.Image | null;
          return {
            now: this.time.now,
            flashUntil: (stall?.getData('flashUntil') as number | undefined) ?? 0,
            shakeAt: (stall?.getData('shakeAt') as number | undefined) ?? -1,
            tint: stall?.tintTopLeft ?? 0xffffff,
            x: stall?.x ?? 0,
            y: stall?.y ?? 0,
            sparks: this.children.list.filter((child) => child.name === `stall-hit-${team}`).length,
            damage: this.children.list
              .filter((child) => child.name === `stall-damage-${team}`)
              .map((child) => {
                const text = child as Phaser.GameObjects.Text;
                return {
                  text: text.text,
                  screenBounds: (() => {
                    const bounds = text.getBounds();
                    const canvas = this.game.canvas.getBoundingClientRect();
                    return {
                      x: canvas.x + bounds.x / this.scale.displayScale.x,
                      y: canvas.y + bounds.y / this.scale.displayScale.y,
                      width: bounds.width / this.scale.displayScale.x,
                      height: bounds.height / this.scale.displayScale.y,
                    };
                  })(),
                  y: text.y,
                  alpha: text.alpha,
                  screenFont:
                    Number(text.style.fontSize.toString().replace('px', '')) *
                    this.scale.displayScale.x ** -1,
                };
              }),
          };
        },
        state: () => structuredClone(this.state),
        setSeed: (seed: number) => {
          this.state = createMatch(seed);
          this.prevState = structuredClone(this.state);
          this.command = {};
          this.stats = emptyStats();
          if (this.resultsTimer !== null) window.clearTimeout(this.resultsTimer);
          this.resultsTimer = null;
          audioLog.length = 0;
          this.syncAll();
        },
        fastForward: (ticks: number) => {
          for (let i = 0; i < ticks && this.state.winner === null; i++) {
            this.stepTick(new Map());
          }
          this.syncAll();
        },
        setCommand: (team: Team, cmd: SquadCommand) => {
          // Merge: callers park both teams one call at a time (overwriting the
          // whole map silently un-guarded the other team — review round 1 #1).
          this.command = { ...this.command, [team]: cmd };
        },
        placeUnit: (unitId: number, x: number, y: number) => {
          const unit = this.state.units[unitId];
          if (!unit) return;
          unit.pos = { x, y };
          this.prevState = structuredClone(this.state);
          this.syncAll();
        },
        setPadCrates: (team, cols) => {
          hooks.setPadLayout(
            team,
            cols.map((col) => ({ col, layer: 0 })),
          );
        },
        setPadLayout: (team, entries) => {
          const pad = this.state.pads[team];
          if (!pad) throw new Error('Invalid pad team');
          // Validate the entire request before touching IDs, crates or an active
          // opening. Input order need not put a support before its upper crate.
          const occupied = new Set<string>();
          for (const { col, layer, kind } of entries) {
            const key = `${col}:${layer}`;
            if (
              !Number.isInteger(col) ||
              col < 0 ||
              col >= pad.cells.length ||
              (layer !== 0 && layer !== 1) ||
              (kind !== undefined && kind !== 'normal' && kind !== 'super') ||
              occupied.has(key)
            ) {
              throw new Error('Invalid pad layout');
            }
            occupied.add(key);
          }
          if (entries.some(({ col, layer }) => layer === 1 && !occupied.has(`${col}:0`))) {
            throw new Error('Unsupported upper crate');
          }
          const stale = new Set(pad.cells.flat());
          this.state.crates = this.state.crates.filter((c) => !stale.has(c.id));
          for (const column of pad.cells) column.fill(null);
          pad.opening = null;
          for (const { col, layer, kind = 'normal' } of entries) {
            const id = this.state.nextId++;
            pad.cells[col]![layer] = id;
            this.state.crates.push({
              id,
              kind,
              pos: padCellCenter(pad, col),
              state: 'onPad',
              landTick: this.state.tick,
            });
          }
          this.prevState = structuredClone(this.state);
          this.syncAll();
        },
        setStallHp: (team: Team, hp: number) => {
          this.state.stalls[team].hp = Math.max(0, Math.min(STALL_MAX_HP, Math.round(hp)));
          this.syncAll();
        },
      };
      (window as unknown as { __talad: TaladTestHooks }).__talad = hooks;
    }
  }

  update(_time: number, delta: number): void {
    if (document.hidden || shouldRotate()) return; // Pause without accumulating portrait time.
    const ticks = this.loop.advance(delta);
    for (let i = 0; i < ticks && this.state.winner === null; i++) {
      this.stepTick(this.humanInputs());
    }
    this.syncAll(this.loop.alpha());
    const human = this.state.units[HUMAN_UNIT];
    this.touch?.syncUi(
      human ? canOpen(this.state, HUMAN_UNIT) : false,
      human?.bombs ?? 0,
      this.state.winner !== null,
    );
  }

  private stepTick(inputs: ReadonlyMap<UnitId, UnitInput>): void {
    this.prevState = this.state;
    this.state = step(this.state, inputs, this.command);
    this.stats = tallyStats(this.stats, this.prevState, this.state);
    this.playTickAudio();
  }

  private playTickAudio(): void {
    // step() preserves terminal events; never repeat the winner jingle per frame.
    if (this.prevState.winner !== null) return;
    for (const key of sfxForTick(this.prevState, this.state)) {
      const started = this.audio.play(key);
      this.observeAudio?.(key, started);
    }
  }

  /** One render sync of the view and every HUD piece from the current state. */
  private syncAll(alpha = 0): void {
    this.view.sync(this.prevState, this.state, alpha);
    this.stallBars.sync(this.state);
    this.timer.sync(this.state);
    this.commandsUi.setActive(this.state.commands.fruit ?? null);
    this.preview.sync(this.state);
    this.glow.sync(this.state);
    this.aimMarker.sync(this.state);
    this.hud.sync(this.state);
    if (this.state.winner !== null && this.resultsTimer === null) {
      // Banner/jingle duration is wall time, not Phaser's smoothed scene delta
      // (initial slow frames can stretch a scene-clock second to many seconds).
      this.resultsTimer = window.setTimeout(() => {
        this.scene.start('results', {
          winner: this.state.winner,
          seed: this.state.seed,
          stats: this.stats,
        });
      }, 1200);
    }
  }

  /** The human unit's merged keyboard + touch input for one tick. */
  private humanInputs(): ReadonlyMap<UnitId, UnitInput> {
    const human = this.state.units[HUMAN_UNIT];
    if (!human || human.deadUntilTick !== null) return new Map();
    const k = this.keyboard.read(this.state, HUMAN_UNIT, {
      fire: this.fireHeld,
      aim: this.aim,
    });
    const t = this.touch?.read();
    if (!t) return new Map([[HUMAN_UNIT, k]]);
    const move = t.move.x !== 0 || t.move.y !== 0 ? t.move : k.move;
    return new Map([
      [
        HUMAN_UNIT,
        {
          move,
          aim: k.aim, // desktop mouse aim; touch relies on sim auto-aim
          fire: k.fire || t.fire,
          throwBomb: k.throwBomb || t.throwBomb,
          pickDrop: k.pickDrop || t.pickDrop,
          open: k.open || t.open,
        },
      ],
    ]);
  }
}
