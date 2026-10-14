import { th } from '../i18n/th';
import type { Vec2 } from '@talad/sim';

const JOY_RADIUS = 56; // css px — knob travel; move vec = delta / JOY_RADIUS

export interface TouchRead {
  move: Vec2;
  fire: boolean;
  pickDrop: boolean;
  throwBomb: boolean;
  open: boolean;
}

/**
 * Mobile touch controls as a DOM overlay (joystick on the left half, action
 * buttons bottom-right). DOM — not Phaser — so e2e can select buttons, measure
 * the ≥ 56 px approved token size, and drive multi-touch via CDP.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly fireBtn: HTMLButtonElement;
  private readonly pickBtn: HTMLButtonElement;
  private readonly throwBtn: HTMLButtonElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly throwCount: HTMLSpanElement;

  private joyPointerId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private vec: Vec2 = { x: 0, y: 0 };
  private fireHeld = false;
  private pickPulse = false;
  private throwPulse = false;
  private openPulse = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'tw-hud-root';
    this.root.dataset.touch = isTouchDevice() ? '1' : '0';

    this.zone = document.createElement('div');
    this.zone.className = 'tw-joy-zone';
    this.joyBase = document.createElement('div');
    this.joyBase.className = 'tw-joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'tw-joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    this.zone.appendChild(this.joyBase);

    this.fireBtn = makeButton('tw-btn-fire', th.fire);
    this.pickBtn = makeButton('tw-btn-pick', th.pickDrop);
    this.openBtn = makeButton('tw-btn-open', th.open);
    this.throwBtn = makeButton('tw-btn-throw', th.throwBomb);
    this.throwCount = document.createElement('span');
    this.throwCount.className = 'tw-throw-count';
    this.throwBtn.appendChild(this.throwCount);

    this.root.append(this.zone, this.pickBtn, this.openBtn, this.throwBtn, this.fireBtn);
    mount.appendChild(this.root);

    this.zone.addEventListener('pointerdown', (e) => this.onJoyDown(e));
    this.zone.addEventListener('pointermove', (e) => this.onJoyMove(e));
    const endJoy = (e: PointerEvent) => this.onJoyEnd(e);
    this.zone.addEventListener('pointerup', endJoy);
    this.zone.addEventListener('pointercancel', endJoy);

    this.fireBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.fireHeld = true;
    });
    const endFire = () => {
      this.fireHeld = false;
    };
    this.fireBtn.addEventListener('pointerup', endFire);
    this.fireBtn.addEventListener('pointercancel', endFire);
    this.fireBtn.addEventListener('pointerleave', endFire);

    this.pickBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pickPulse = true;
    });
    this.throwBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.throwPulse = true;
    });
    this.openBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.openPulse = true;
    });
  }

  /** Consume one control frame; pulses fire exactly once. */
  read(): TouchRead {
    const read: TouchRead = {
      move: { ...this.vec },
      fire: this.fireHeld,
      pickDrop: this.pickPulse,
      throwBomb: this.throwPulse,
      open: this.openPulse,
    };
    this.pickPulse = false;
    this.throwPulse = false;
    this.openPulse = false;
    return read;
  }

  /** Called every frame: Open! only when valid, Throw only while bombs > 0. */
  syncUi(canOpen: boolean, bombs: number, matchOver: boolean): void {
    this.openBtn.hidden = !canOpen;
    this.throwBtn.hidden = bombs <= 0;
    this.throwCount.textContent = bombs > 0 ? String(bombs) : '';
    for (const btn of [this.fireBtn, this.pickBtn, this.throwBtn, this.openBtn]) {
      btn.disabled = matchOver;
    }
  }

  destroy(): void {
    this.root.remove();
  }

  private onJoyDown(e: PointerEvent): void {
    if (this.joyPointerId !== null) return;
    this.joyPointerId = e.pointerId;
    this.joyOrigin = { x: e.clientX, y: e.clientY };
    this.zone.setPointerCapture(e.pointerId);
    this.joyBase.style.left = `${e.clientX}px`;
    this.joyBase.style.top = `${e.clientY}px`;
    this.joyBase.style.display = 'block';
    this.moveKnob(0, 0);
  }

  private onJoyMove(e: PointerEvent): void {
    if (e.pointerId !== this.joyPointerId) return;
    let dx = e.clientX - this.joyOrigin.x;
    let dy = e.clientY - this.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    this.vec = { x: dx / JOY_RADIUS, y: dy / JOY_RADIUS };
    this.moveKnob(dx, dy);
  }

  private onJoyEnd(e: PointerEvent): void {
    if (e.pointerId !== this.joyPointerId) return;
    this.joyPointerId = null;
    this.vec = { x: 0, y: 0 };
    this.joyBase.style.display = 'none';
  }

  private moveKnob(dx: number, dy: number): void {
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}

function makeButton(id: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'tw-btn';
  btn.type = 'button';
  btn.textContent = label;
  return btn;
}

export function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
}
