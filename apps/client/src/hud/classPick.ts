import { CLASS_IDS, OPEN_TICKS, controlledUnit } from '@talad/sim';
import type { MatchState, UnitClass } from '@talad/sim';
import { className, th } from '../i18n/th';
import { classPickContext } from '../input/r2Controls';
import type { ClassPickContext } from '../input/r2Controls';

/**
 * R2 class tray (#tw-class-pick, plan §5): four 72×76 icon+label buttons in
 * CLASS_IDS order with 1–4 digit hints, or the noninteractive opening status
 * whose remaining fraction is computed from sim ticks (never a wall-clock
 * timer). Hidden whenever the choices are not freshly eligible. The tray
 * caches exactly the context it displays and sends it with every pick; input
 * semantics stay in input/r2Controls.ts — the scene (R2-11) wires onPick.
 */
export class ClassPickHud {
  readonly root: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly actions: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private displayed: ClassPickContext | null = null;

  constructor(mount: HTMLElement, onPick: (context: ClassPickContext, classId: UnitClass) => void) {
    this.root = document.createElement('div');
    this.root.id = 'tw-class-pick';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', th.chooseClass);
    this.root.hidden = true;

    this.header = document.createElement('div');
    this.header.className = 'tw-class-header';
    this.header.textContent = th.chooseClass;

    this.status = document.createElement('div');
    this.status.className = 'tw-class-status';
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    this.status.textContent = th.classOpening;

    this.progress = document.createElement('div');
    this.progress.className = 'tw-class-progress';
    this.progress.setAttribute('role', 'progressbar');
    this.progress.setAttribute('aria-label', th.classOpening);
    this.progress.setAttribute('aria-valuemin', '0');
    this.progress.setAttribute('aria-valuemax', '1');
    this.progress.setAttribute('aria-valuenow', '0');
    this.status.appendChild(this.progress);

    this.actions = document.createElement('div');
    this.actions.className = 'tw-class-actions';
    for (const [i, classId] of CLASS_IDS.entries()) {
      this.actions.appendChild(this.makeButton(i + 1, classId, onPick));
    }

    // Tray pointer starts never reach the canvas fire or joystick zone below.
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.root.append(this.header, this.status, this.actions);
    mount.appendChild(this.root);
  }

  sync(s: MatchState): void {
    const unit = controlledUnit(s);

    // Class channel owned by the controlled unit: noninteractive status with
    // the remaining channel fraction, computed from sim ticks only.
    const opening = unit === null ? null : s.pads[unit.team].opening;
    const openingMine =
      unit !== null &&
      opening !== null &&
      opening.byUnit === unit.id &&
      opening.classId !== undefined;
    if (openingMine) {
      this.displayed = null;
      const remaining = Math.min(1, Math.max(0, (opening!.doneTick - s.tick) / OPEN_TICKS));
      this.progress.setAttribute('aria-valuenow', remaining.toFixed(3));
      this.progress.style.setProperty('--tw-r2-progress', remaining.toFixed(3));
      this.status.hidden = false;
      this.actions.hidden = true;
      for (const btn of this.buttons) btn.hidden = true;
      this.root.hidden = false;
      return;
    }

    const ctx = classPickContext(s);
    this.displayed = ctx === null ? null : { ...ctx };
    if (ctx === null) {
      this.root.hidden = true;
      return;
    }
    // Banned choices stay labelled but disabled; ordinary matches have none.
    const team = s.units.find((u) => u.id === ctx.unitId)!.team;
    const bans = s.itemBans?.[team];
    for (const btn of this.buttons) {
      btn.hidden = false;
      btn.disabled = bans?.includes(btn.dataset.class as UnitClass) ?? false;
    }
    this.status.hidden = true;
    this.actions.hidden = false;
    this.root.hidden = false;
  }

  destroy(): void {
    this.displayed = null;
    this.root.remove();
  }

  private makeButton(
    digit: number,
    classId: UnitClass,
    onPick: (context: ClassPickContext, classId: UnitClass) => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tw-class-btn';
    btn.dataset.class = classId;

    // Decorative icon: a failed image hides itself and the Thai name stays.
    const icon = document.createElement('img');
    icon.className = 'tw-class-icon';
    icon.src = `/art/class_pick_${classId}.webp`;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    icon.addEventListener(
      'error',
      () => {
        icon.hidden = true;
      },
      { once: true },
    );

    const label = document.createElement('span');
    label.className = 'tw-class-label';
    label.textContent = className(classId);

    const key = document.createElement('span');
    key.className = 'tw-class-key';
    key.textContent = String(digit);
    key.setAttribute('aria-hidden', 'true');

    btn.append(icon, label, key);
    btn.addEventListener('click', () => {
      if (btn.disabled || this.displayed === null) return;
      onPick(this.displayed, classId);
    });
    this.buttons.push(btn);
    return btn;
  }
}
