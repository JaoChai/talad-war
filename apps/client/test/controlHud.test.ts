import { describe, expect, it } from 'vitest';
import { controlledUnit, createMatch, switchControl } from '@talad/sim';
import type { MatchState } from '@talad/sim';
import { glowCellFor } from '../src/hud/padPreview';
import { MatchHud } from '../src/hud/status';

/**
 * R2-9 RED: every player-body HUD selector must bind to `controlledUnit(state)`
 * — the lowest-ID non-bot body — never to array index 0. Control flips use the
 * real sim helper so the fixtures prove ownership, not a copied flag.
 */

/** Real pad records: quality must be resolved from referenced crate IDs. */
function layout(s: MatchState, entries: { col: number; layer: 0 | 1; super?: boolean }[]) {
  s.crates = s.crates.filter((c) => c.state !== 'onPad');
  s.pads.fruit.cells = Array.from({ length: 4 }, () => [null, null] as (number | null)[]);
  for (const entry of entries) {
    const id = s.nextId++;
    s.pads.fruit.cells[entry.col]![entry.layer] = id;
    s.crates.push({
      id,
      pos: { x: 8.75, y: 18.75 },
      state: 'onPad',
      landTick: 0,
      kind: entry.super ? 'super' : 'normal',
    });
  }
}

function hud(): MatchHud {
  return new MatchHud(document.createElement('div'));
}

describe('R2 control HUD binding', () => {
  it('after a real switch the panel shows the target body, not the released one', () => {
    const mount = document.createElement('div');
    const panel = new MatchHud(mount);
    const s = createMatch(1);
    const released = s.units[0]!;
    const target = s.units[1]!;
    released.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    released.bombs = 3;
    released.bombsSuper = false;
    target.gun = null;
    target.bombs = 2;
    target.bombsSuper = false;
    layout(s, [{ col: 0, layer: 0, super: true }]);
    target.carrying = s.crates[0]!.id;

    expect(switchControl(s, 0)).toBe(1);
    expect(controlledUnit(s)?.id).toBe(1);
    panel.sync(s);
    // The TARGET's independent primary/cargo and bomb slots, exactly.
    expect(panel.itemEl.querySelector('.tw-item-primary')!.textContent).toBe('ลัง พิเศษ');
    expect(panel.itemEl.querySelector('.tw-item-bombs')!.textContent).toBe('ระเบิด ×2');
    expect(panel.itemEl.textContent).not.toContain('บาซูก้ามะพร้าว');

    // And back: the third fruit body sits the cycle out, so control returns
    // to the original body with its own loadout (numeric cycle 0→1→2→0).
    s.units[2]!.deadUntilTick = s.tick + 100;
    expect(switchControl(s, 1)).toBe(0);
    panel.sync(s);
    expect(panel.itemEl.querySelector('.tw-item-primary')!.textContent).toBe('บาซูก้ามะพร้าว พิเศษ');
    expect(panel.itemEl.querySelector('.tw-item-bombs')!.textContent).toBe('ระเบิด ×3');
  });

  it('follows numeric IDs through sparse arrays, never array index 0', () => {
    const mount = document.createElement('div');
    const panel = new MatchHud(mount);
    const s = createMatch(1);
    // Sparse: unit id 1 leaves the array; ids are 0,2,3,4,5 with index 1 = id 2.
    s.units.splice(1, 1);
    s.units[0]!.bombs = 1;
    const id2 = s.units.find((u) => u.id === 2)!;
    id2.bombs = 2;
    id2.bombsSuper = false;

    expect(switchControl(s, 0)).toBe(2);
    panel.sync(s);
    expect(panel.itemEl.querySelector('.tw-item-primary')!.textContent).toBe('มือเปล่า');
    expect(panel.itemEl.querySelector('.tw-item-bombs')!.textContent).toBe('ระเบิด ×2');
    expect(panel.itemEl.textContent).not.toContain('×1');

    id2.deadUntilTick = s.tick + 100;
    panel.sync(s);
    expect(panel.itemEl.hidden).toBe(true);
  });

  it('nonzero humanUnit binds panel and glow cell to that body', () => {
    const mount = document.createElement('div');
    const panel = new MatchHud(mount);
    const s = createMatch(1, { humanUnit: 2 });
    expect(controlledUnit(s)?.id).toBe(2);
    s.units[0]!.bombs = 5;
    s.units[0]!.bombsSuper = true;
    const me = s.units.find((u) => u.id === 2)!;
    me.bombs = 2;
    me.bombsSuper = false;

    panel.sync(s);
    expect(panel.itemEl.querySelector('.tw-item-bombs')!.textContent).toBe('ระเบิด ×2');
    expect(panel.itemEl.textContent).not.toContain('×5');

    me.pos = { x: s.pads.fruit.origin.x + 0.7, y: s.pads.fruit.origin.y + 2.7 };
    expect(glowCellFor(s)).toBe(2);
    me.deadUntilTick = s.tick + 1;
    expect(glowCellFor(s)).toBeNull();
    panel.sync(s);
    expect(panel.itemEl.hidden).toBe(true);
  });

  it('a dead controlled body hides the panel even though an old body still lives', () => {
    const mount = document.createElement('div');
    const panel = new MatchHud(mount);
    const s = createMatch(1);
    s.units[0]!.bombs = 3;
    s.units[0]!.bombsSuper = true;
    expect(switchControl(s, 0)).toBe(1);
    const target = s.units.find((u) => u.id === 1)!;
    target.deadUntilTick = s.tick + 100;
    panel.sync(s);
    expect(panel.itemEl.hidden).toBe(true);
    expect(panel.itemEl.textContent).toBe('');

    s.units[2]!.deadUntilTick = s.tick + 100;
    expect(switchControl(s, 1)).toBe(0);
    panel.sync(s);
    expect(panel.itemEl.hidden).toBe(false);
    expect(panel.itemEl.querySelector('.tw-item-primary')!.textContent).toBe('มือเปล่า');
    expect(panel.itemEl.querySelector('.tw-item-bombs')!.textContent).toBe('ระเบิด พิเศษ ×3');
  });

  it('the pad glow follows the controlled body and never lights for bots', () => {
    const s = createMatch(1);
    expect(glowCellFor(s)).toBeNull(); // controlled 0 starts at its stall
    s.units[0]!.pos = { x: s.pads.fruit.origin.x + 0.7, y: s.pads.fruit.origin.y + 0.7 };
    expect(glowCellFor(s)).toBe(0);

    // After the switch, unit 0 is a bot on the pad: no glow, target off-pad.
    expect(switchControl(s, 0)).toBe(1);
    expect(glowCellFor(s)).toBeNull();
    s.units.find((u) => u.id === 1)!.pos = {
      x: s.pads.fruit.origin.x + 0.7,
      y: s.pads.fruit.origin.y + 2.7,
    };
    expect(glowCellFor(s)).toBe(2);

    // All-bot match: no controlled body, no glow even with a bot on the pad.
    const bots = createMatch(1, { humanUnit: null });
    bots.units[0]!.pos = { x: bots.pads.fruit.origin.x + 0.7, y: bots.pads.fruit.origin.y + 0.7 };
    expect(glowCellFor(bots)).toBeNull();
  });
});
