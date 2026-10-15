import { th } from '../i18n/th';

export interface ActionButtons {
  fire: HTMLButtonElement;
  pick: HTMLButtonElement;
  throwBtn: HTMLButtonElement;
  open: HTMLButtonElement;
  throwCount: HTMLSpanElement;
}

/**
 * The four touch action buttons (ids kept for the e2e helpers): Fire largest
 * bottom-right, Pick/Drop left of it, Throw above with its count badge,
 * Open! left of Throw. DOM only — input semantics stay in input/touch.ts.
 */
export function createActionButtons(): ActionButtons {
  const fire = makeButton('tw-btn-fire', th.fire);
  const pick = makeButton('tw-btn-pick', th.pickDrop);
  const open = makeButton('tw-btn-open', th.open);
  const throwBtn = makeButton('tw-btn-throw', th.throwBomb);
  const throwCount = document.createElement('span');
  throwCount.className = 'tw-throw-count';
  throwBtn.appendChild(throwCount);
  return { fire, pick, throwBtn, open, throwCount };
}

function makeButton(id: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'tw-btn';
  btn.type = 'button';
  btn.textContent = label;
  return btn;
}
