import Phaser from 'phaser';
import { TICK_HZ, canOpen, createMatch, step } from '@talad/sim';
import type { MatchState, SquadCommand, Team, UnitId, UnitInput, Vec2 } from '@talad/sim';
import { MatchHud } from '../hud/status';
import { KeyboardInput } from '../input/keyboard';
import { TouchControls, isTouchDevice } from '../input/touch';
import { FixedLoop } from '../loop';
import { MatchView } from '../render/view';
import { stageToWorld } from '../render/world';
import type { TaladTestHooks } from '../testHooks';

const HUMAN_UNIT: UnitId = 0;

/** Static at build time: the prod bundle folds this block (and `__talad`) away. */
const TEST_HOOKS_ENABLED = import.meta.env.VITE_TEST_HOOKS === '1';

/**
 * The playable match: fixed 20 Hz sim stepping inside the render loop,
 * interpolated rendering, keyboard + touch controls, minimal HUD overlay.
 * Review Focus 5: document.hidden freezes the sim; the FixedLoop clamps any
 * catch-up burst to 5 ticks.
 */
export class MatchScene extends Phaser.Scene {
  private state!: MatchState;
  private prevState!: MatchState;
  private readonly loop = new FixedLoop(TICK_HZ, 5);
  private readonly keyboard = new KeyboardInput();
  private view!: MatchView;
  private hud!: MatchHud;
  private touch: TouchControls | null = null;
  private aim: Vec2 | null = null;
  private fireHeld = false;
  private command: Partial<Record<Team, SquadCommand>> = {};

  constructor() {
    super('match');
  }

  create(data: { seed?: number }): void {
    const mount = document.getElementById('app');
    if (!mount) throw new Error('MatchScene: #app mount missing');
    this.state = createMatch(data?.seed ?? 1);
    this.prevState = structuredClone(this.state);

    this.view = new MatchView(this);
    this.hud = new MatchHud(mount);
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
    window.addEventListener('keydown', (e) => this.keyboard.handleKey(e.code, true));
    window.addEventListener('keyup', (e) => this.keyboard.handleKey(e.code, false));

    if (TEST_HOOKS_ENABLED) {
      const hooks: TaladTestHooks = {
        state: () => structuredClone(this.state),
        setSeed: (seed: number) => {
          this.state = createMatch(seed);
          this.prevState = structuredClone(this.state);
          this.command = {};
          this.view.sync(this.prevState, this.state, 0);
          this.hud.sync(this.state);
        },
        fastForward: (ticks: number) => {
          for (let i = 0; i < ticks; i++) {
            this.prevState = this.state;
            this.state = step(this.state, new Map(), this.command);
          }
          this.view.sync(this.prevState, this.state, 0);
          this.hud.sync(this.state);
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
          this.view.sync(this.prevState, this.state, 0);
          this.hud.sync(this.state);
        },
      };
      (window as unknown as { __talad: TaladTestHooks }).__talad = hooks;
    }
  }

  update(_time: number, delta: number): void {
    if (document.hidden) return; // Review Focus 5: no ticks while hidden
    const ticks = this.loop.advance(delta);
    for (let i = 0; i < ticks; i++) {
      this.prevState = this.state;
      this.state = step(this.state, this.humanInputs(), this.command);
    }
    this.view.sync(this.prevState, this.state, this.loop.alpha());
    const human = this.state.units[HUMAN_UNIT];
    this.touch?.syncUi(
      human ? canOpen(this.state, HUMAN_UNIT) : false,
      human?.bombs ?? 0,
      this.state.winner !== null,
    );
    this.hud.sync(this.state);
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
