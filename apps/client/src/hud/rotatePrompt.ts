import { isTouchDevice } from '../input/touch';
import { th } from '../i18n/th';

export function shouldRotate(): boolean {
  return isTouchDevice() && window.innerHeight > window.innerWidth;
}

/** App-lifetime overlay; only the match loop pauses, never discards its state. */
export function mountRotatePrompt(mount: HTMLElement): void {
  const root = document.createElement('div');
  root.className = 'tw-rotate';
  root.setAttribute('role', 'status');
  root.innerHTML = `<div><span class="tw-rotate-device" aria-hidden="true"></span><h2>${th.rotate}</h2><p>${th.rotateBody}</p></div>`;
  const sync = () => {
    root.hidden = !shouldRotate();
  };
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  sync();
  mount.append(root);
}
