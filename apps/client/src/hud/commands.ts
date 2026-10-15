import type { SquadCommand } from '@talad/sim';
import { commandName } from '../i18n/th';

/** Non-null squad command (the sim union includes null = no command). */
export type ActiveCommand = Exclude<SquadCommand, null>;

const ORDER: readonly ActiveCommand[] = ['attack', 'guard', 'fetch'];

/** Tap the active command again -> null; a different one replaces it. */
export function applyToggle(current: SquadCommand, clicked: ActiveCommand): SquadCommand {
  return current === clicked ? null : clicked;
}

/**
 * Right-edge vertical column of squad commands (บุก / เฝ้าแผง / ไปขนลัง), on
 * desktop AND touch. Every activation path — button tap, Digit1/2/3 — funnels
 * through request(); the scene feeds state.commands.fruit back via setActive,
 * so the sim state stays the single source of truth.
 */
export class SquadCommands {
  readonly buttons: Record<ActiveCommand, HTMLButtonElement>;
  private active: SquadCommand = null;

  constructor(
    mount: HTMLElement,
    private readonly onCommand: (command: SquadCommand) => void,
  ) {
    const column = document.createElement('div');
    column.className = 'tw-commands';
    this.buttons = {} as Record<ActiveCommand, HTMLButtonElement>;
    for (const cmd of ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `tw-cmd-${cmd}`;
      btn.className = 'tw-cmd-btn';
      btn.textContent = commandName(cmd);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => this.request(cmd));
      column.appendChild(btn);
      this.buttons[cmd] = btn;
    }
    mount.appendChild(column);
  }

  /** Activate a command from any input path; emits the new (toggled) value. */
  request(cmd: ActiveCommand): void {
    this.active = applyToggle(this.active, cmd);
    this.paint();
    this.onCommand(this.active);
  }

  /** Sync from the authoritative sim state (runs every frame). */
  setActive(command: SquadCommand): void {
    this.active = command;
    this.paint();
  }

  private paint(): void {
    for (const cmd of ORDER) {
      const on = this.active === cmd;
      this.buttons[cmd].setAttribute('aria-pressed', String(on));
      this.buttons[cmd].classList.toggle('is-active', on);
    }
  }
}
