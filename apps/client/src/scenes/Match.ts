import Phaser from 'phaser';
import { STALL_MAX_HP, TICK_HZ, canOpen, createMatch, padCellCenter, step } from '@talad/sim';
import type { MatchState, SquadCommand, Team, UnitId, UnitInput, Vec2 } from '@talad/sim';
import { AimMarker } from '../hud/aimMarker';
import { SquadCommands } from '../hud/commands';
import { MatchHud } from '../hud/status';
import { PreviewText } from '../hud/padPreview';
import { PadGlow } from '../hud/padGlow';
import { StallBars } from '../hud/stallBars';
import { MatchTimer } from '../hud/timer';
import { KeyboardInput } from '../input/keyboard';
import { TouchControls, isTouchDevice } from '../input/touch';
import { FixedLoop } from '../loop';
import { MatchView } from '../render/view';
import { stageToWorld } from '../render/world';
import type { TaladTestHooks } from '../testHooks';

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
  private readonly loop = new FixedLoop(TICK_HZ, 5);
  private readonly keyboard = new KeyboardInput();
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

  constructor() {
    super('match');
  }

  create(data: { seed?: number }): void {
    const mount = document.getElementById('app');
    if (!mount) throw new Error('MatchScene: #app mount missing');
    this.state = createMatch(data?.seed ?? 1);
    this.prevState = structuredClone(this.state);

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
    window.addEventListener('keydown', (e) => {
      this.keyboard.handleKey(e.code, true);
      const cmd = COMMAND_KEYS[e.code];
      if (cmd) this.commandsUi.request(cmd);
    });
    window.addEventListener('keyup', (e) => this.keyboard.handleKey(e.code, false));

    if (TEST_HOOKS_ENABLED) {
      const hooks: TaladTestHooks = {
        state: () => structuredClone(this.state),
        setSeed: (seed: number) => {
          this.state = createMatch(seed);
          this.prevState = structuredClone(this.state);
          this.command = {};
          this.syncAll();
        },
        fastForward: (ticks: number) => {
          for (let i = 0; i < ticks; i++) {
            this.prevState = this.state;
            this.state = step(this.state, new Map(), this.command);
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
        setPadCrates: (team: Team, cols: number[]) => {
          const pad = this.state.pads[team];
          // Drop crates this hook staged earlier so re-staging leaves no orphans.
          const stale = new Set<number>();
          for (const column of pad.cells) {
            for (const id of column) if (id !== null) stale.add(id);
          }
          this.state.crates = this.state.crates.filter((c) => !stale.has(c.id));
          for (const column of pad.cells) {
            column[0] = null;
            column[1] = null;
          }
          for (const col of cols) {
            const column = pad.cells[col];
            if (!column) continue;
            const id = this.state.nextId++;
            column[0] = id; // ground layer
            this.state.crates.push({
              id,
              pos: padCellCenter(pad, col),
              state: 'onPad',
              landTick: this.state.tick,
            });
          }
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
    if (document.hidden) return; // Review Focus 5: no ticks while hidden
    const ticks = this.loop.advance(delta);
    for (let i = 0; i < ticks; i++) {
      this.prevState = this.state;
      this.state = step(this.state, this.humanInputs(), this.command);
    }
    this.syncAll(this.loop.alpha());
    const human = this.state.units[HUMAN_UNIT];
    this.touch?.syncUi(
      human ? canOpen(this.state, HUMAN_UNIT) : false,
      human?.bombs ?? 0,
      this.state.winner !== null,
    );
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
