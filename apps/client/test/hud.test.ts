import { describe, expect, it } from 'vitest';
import { createMatch } from '@talad/sim';
import type { MatchState, SquadCommand } from '@talad/sim';
import { applyToggle, SquadCommands } from '../src/hud/commands';
import { glowCellFor, PreviewText } from '../src/hud/padPreview';
import { StallBars } from '../src/hud/stallBars';
import { formatElapsed, MatchTimer } from '../src/hud/timer';

function state(): MatchState {
  return createMatch(1);
}

describe('timer', () => {
  it('formats tick 0 -> 0:00, 20*61 -> 1:01, 20*600 -> 10:00', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(20 * 61)).toBe('1:01');
    expect(formatElapsed(20 * 600)).toBe('10:00');
  });

  it('renders the elapsed time from the state tick', () => {
    const mount = document.createElement('div');
    const timer = new MatchTimer(mount);
    const s = state();
    timer.sync(s);
    expect(timer.el.textContent).toBe('0:00');
    s.tick = 20 * 61;
    timer.sync(s);
    expect(timer.el.textContent).toBe('1:01');
  });
});

describe('stall bars', () => {
  it('shows 100% / 50% / 0% as aria-valuenow for hp 6500 / 3250 / 0', () => {
    const mount = document.createElement('div');
    const bars = new StallBars(mount);
    const s = state();
    bars.sync(s);
    expect(bars.fruitBar.getAttribute('aria-valuenow')).toBe('100');
    s.stalls.dessert.hp = 3250;
    bars.sync(s);
    expect(bars.dessertBar.getAttribute('aria-valuenow')).toBe('50');
    s.stalls.dessert.hp = 0;
    bars.sync(s);
    expect(bars.dessertBar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('sizes the fill from hp and names both bars in Thai', () => {
    const mount = document.createElement('div');
    const bars = new StallBars(mount);
    const s = state();
    s.stalls.fruit.hp = 1625; // 25%
    bars.sync(s);
    expect(bars.fruitBar.style.width).toBe('25%');
    expect(bars.fruitBar.getAttribute('aria-label')).toBeTruthy();
    expect(bars.dessertBar.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('squad command toggle', () => {
  it('attack -> attack again -> null (and no cross-command surprise)', () => {
    expect(applyToggle(null, 'attack')).toBe('attack');
    expect(applyToggle('attack', 'attack')).toBeNull();
    expect(applyToggle('guard', 'attack')).toBe('attack');
    expect(applyToggle('fetch', 'fetch')).toBeNull();
  });

  it('buttons reflect the active command via aria-pressed', () => {
    const mount = document.createElement('div');
    const ui = new SquadCommands(mount, () => {});
    ui.setActive(null);
    for (const btn of Object.values(ui.buttons)) {
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
    ui.setActive('guard');
    expect(ui.buttons.guard.getAttribute('aria-pressed')).toBe('true');
    expect(ui.buttons.attack.getAttribute('aria-pressed')).toBe('false');
    ui.setActive(null);
    expect(ui.buttons.guard.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking a button emits the command; clicking the active one emits null', () => {
    const mount = document.createElement('div');
    let received: SquadCommand | undefined;
    const ui = new SquadCommands(mount, (cmd) => {
      received = cmd;
    });
    ui.setActive(null);
    ui.buttons.attack.click();
    expect(received).toBe('attack');
    ui.setActive('attack');
    ui.buttons.attack.click();
    expect(received).toBeNull();
  });
});

describe('pad preview', () => {
  it('glowCellFor: unit 0 alive on its own pad cell -> that cell; else null', () => {
    const s = state();
    expect(glowCellFor(s)).toBeNull(); // unit 0 starts at its stall
    s.units[0]!.pos = { x: s.pads.fruit.origin.x + 0.7, y: s.pads.fruit.origin.y + 0.7 };
    expect(glowCellFor(s)).toBe(0);
    s.units[0]!.deadUntilTick = s.tick + 1;
    expect(glowCellFor(s)).toBeNull();
  });

  it('preview text shows the Thai recipe for 1 crate and hides for an empty pad', () => {
    const mount = document.createElement('div');
    const preview = new PreviewText(mount);
    const s = state();
    preview.sync(s);
    expect(preview.el.hidden).toBe(true); // empty pad -> hidden ('empty' maps to "")
    s.pads.fruit.cells[0]![0] = 1;
    preview.sync(s);
    expect(preview.el.hidden).toBe(false);
    expect(preview.el.textContent).toBe('จะได้: ปืนฉีดน้ำ');
    s.pads.fruit.cells[0]![0] = null;
    s.pads.fruit.cells[0]![1] = null;
    s.pads.fruit.cells[0]![0] = 1; // two ground crates in cols 0 and 3:
    s.pads.fruit.cells[3]![0] = 2; // non-adjacent -> not a recipe
    preview.sync(s);
    expect(preview.el.textContent).toBe('ยังไม่ใช่สูตร');
  });
});
