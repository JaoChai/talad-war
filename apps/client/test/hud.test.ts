import { describe, expect, it } from 'vitest';
import { createMatch } from '@talad/sim';
import type { MatchState, SquadCommand } from '@talad/sim';
import { applyToggle, SquadCommands } from '../src/hud/commands';
import { activeRecipe, glowCellFor, glowStagePos, PreviewText } from '../src/hud/padPreview';
import { RECIPE_COLOURS } from '../src/hud/recipeColour';
import { padPaintedCellStagePos } from '../src/render/world';
import { StallBars } from '../src/hud/stallBars';
import { MatchHud } from '../src/hud/status';
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

// Real pad records: quality must be resolved from referenced IDs, not fixtures' labels.
function layout(s: MatchState, entries: { col: number; layer: 0 | 1; super?: boolean }[]) {
  s.crates = [];
  s.pads.fruit.cells = Array.from({ length: 4 }, () => [null, null]);
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

const stars = (el: HTMLElement) => el.querySelectorAll('img[src$="prop_badge_super.webp"]');

/** R2d chip helper: the small colour swatch inside the mixing label. */
const chipOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.tw-chip');

// R2-9 note: the fixtures below deliberately pin the DEFAULT control start
// (createMatch's human = unit 0 = `controlledUnit` at tick 0), per the §8
// migration ledger. Target-ID, sparse-array and nonzero-humanUnit coverage
// lives in test/controlHud.test.ts; do not rewrite these into control flips.
describe('R1 held-item HUD', () => {
  function setup() {
    const mount = document.createElement('div');
    const hud = new MatchHud(mount);
    const s = state();
    hud.sync(s);
    expect(mount.querySelector('.tw-loadout')).not.toBeNull();
    return { hud, s };
  }

  it('shows unarmed and every equipped quality, including legacy guns', () => {
    const { hud, s } = setup();
    expect(hud.itemEl.textContent).toBe('มือเปล่า');
    for (const [gun, text, starCount] of [
      [{ ammoCooldownTicks: 0 }, 'ปืนฉีดน้ำ', 0],
      [{ kind: 'gun', super: true, ammoCooldownTicks: 0 }, 'ปืนฉีดน้ำ พิเศษ', 1],
      [{ kind: 'heavy', super: false, ammoCooldownTicks: 0 }, 'บาซูก้ามะพร้าว', 0],
      [{ kind: 'heavy', super: true, ammoCooldownTicks: 0 }, 'บาซูก้ามะพร้าว พิเศษ', 1],
    ] as const) {
      s.units[0]!.gun = gun;
      hud.sync(s);
      expect(hud.itemEl.textContent).toBe(text);
      expect(stars(hud.itemEl)).toHaveLength(starCount);
      expect(hud.itemEl.getAttribute('aria-label')).toBe(text);
      expect(hud.itemEl.querySelectorAll('img[src$="prop_shot_coconut.webp"]')).toHaveLength(
        'kind' in gun && gun.kind === 'heavy' ? 1 : 0,
      );
    }
  });

  it('prioritizes cargo by its own quality, independently of weapon and bomb quality', () => {
    const { hud, s } = setup();
    const u = s.units[0]!;
    u.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    u.bombs = 3;
    u.bombsSuper = false;
    layout(s, [{ col: 0, layer: 0, super: true }]);
    u.carrying = s.crates[0]!.id;
    hud.sync(s);
    expect(hud.itemEl.querySelector('.tw-item-primary')!.textContent).toBe('ลัง พิเศษ');
    expect(hud.itemEl.querySelector('.tw-item-bombs')!.textContent).toBe('ระเบิด ×3');
    expect(stars(hud.itemEl.querySelector('.tw-item-bombs')!)).toHaveLength(0);
    s.crates[0]!.kind = 'normal'; // rendering fixture, not gameplay mutation
    u.bombs = 5;
    u.bombsSuper = true;
    hud.sync(s);
    expect(hud.itemEl.querySelector('.tw-item-primary')!.textContent).toBe('ลัง');
    expect(stars(hud.itemEl.querySelector('.tw-item-primary')!)).toHaveLength(0);
    expect(hud.itemEl.querySelector('.tw-item-bombs')!.textContent).toBe('ระเบิด พิเศษ ×5');
    expect(stars(hud.itemEl.querySelector('.tw-item-bombs')!)).toHaveLength(1);
    u.carrying = null;
    u.gun = { ammoCooldownTicks: 0 };
    hud.sync(s);
    expect(hud.itemEl.querySelector('.tw-item-primary')!.textContent).toBe('ปืนฉีดน้ำ');
    expect(stars(hud.itemEl.querySelector('.tw-item-primary')!)).toHaveLength(0);
  });

  it('clears last-bomb, death, missing-unit, winner and reset state without stale badges', () => {
    const { hud, s } = setup();
    s.units[0]!.bombs = 5;
    s.units[0]!.bombsSuper = true;
    hud.sync(s);
    s.units[0]!.bombs = 0; // even a stale optional flag must not display stock
    hud.sync(s);
    expect(hud.itemEl.textContent).toBe('มือเปล่า');
    expect(stars(hud.itemEl)).toHaveLength(0);
    s.units[0]!.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    s.units[0]!.deadUntilTick = 100;
    hud.sync(s);
    expect(hud.itemEl.hidden).toBe(true);
    expect(hud.itemEl.textContent).toBe('');
    expect(stars(hud.itemEl)).toHaveLength(0);
    hud.sync(state());
    expect(hud.itemEl.hidden).toBe(false);
    expect(hud.itemEl.textContent).toBe('มือเปล่า');
    s.winner = 'fruit';
    hud.sync(s);
    expect(hud.itemEl.hidden).toBe(true);
    hud.sync(state());
    expect(hud.itemEl.hidden).toBe(false);
    s.winner = null;
    s.units = [];
    hud.sync(s);
    expect(hud.itemEl.hidden).toBe(true);
  });

  it('hides failed images but keeps Thai meaning; identical sync does not recreate or reannounce', () => {
    const { hud, s } = setup();
    s.units[0]!.gun = { kind: 'heavy', super: true, ammoCooldownTicks: 0 };
    hud.sync(s);
    const images = [...hud.itemEl.querySelectorAll('img')];
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image.alt).toBe('');
      expect(image.getAttribute('aria-hidden')).toBe('true');
      image.dispatchEvent(new Event('error'));
      expect(image.hidden).toBe(true);
    }
    hud.sync(s);
    expect([...hud.itemEl.querySelectorAll('img')]).toEqual(images);
    expect(images.every((image) => image.hidden)).toBe(true);
    expect(hud.itemEl.textContent).toBe('บาซูก้ามะพร้าว พิเศษ');
    expect(hud.itemEl.getAttribute('role')).toBe('status');
    expect(hud.itemEl.getAttribute('aria-atomic')).toBe('true');
  });

  it('resets the winner banner for a new match', () => {
    const mount = document.createElement('div');
    const hud = new MatchHud(mount);
    const s = state();
    s.winner = 'fruit';
    hud.sync(s);
    expect((mount.querySelector('.tw-winner') as HTMLElement).hidden).toBe(false);
    hud.sync(state());
    expect((mount.querySelector('.tw-winner') as HTMLElement).hidden).toBe(true);
  });
});

describe('R1 preview states', () => {
  it.each([false, true])('shows heavy with its own quality (%s), not a buddy', (quality) => {
    const preview = new PreviewText(document.createElement('div'));
    const s = state();
    layout(
      s,
      [0, 1, 2, 3].map((col) => ({ col, layer: 0, super: col === 2 && quality })),
    );
    preview.sync(s);
    expect(preview.el.textContent).toBe(`กำลังผสม: บาซูก้ามะพร้าว${quality ? ' พิเศษ' : ''}`);
    expect(stars(preview.el)).toHaveLength(quality ? 1 : 0);
    // Review round 1 #2: the mixing label carries exactly ONE weapon marker —
    // the colour chip. The coconut art stays in the loadout panel only.
    expect(chipOf(preview.el)?.style.background).toBe(RECIPE_COLOURS.heavy);
    expect(preview.el.querySelectorAll('.tw-chip')).toHaveLength(1);
    expect(preview.el.querySelectorAll('.tw-item-coconut')).toHaveLength(0);
    expect(preview.el.querySelectorAll('img[src$="prop_shot_coconut.webp"]')).toHaveLength(0);
    expect(preview.el.style.borderColor).toBe(RECIPE_COLOURS.heavy);
  });

  it('shows super gun/bombs/buddy but suppresses all stars on errors, empty and finished pads', () => {
    const preview = new PreviewText(document.createElement('div'));
    const s = state();
    for (const [entries, recipe, want] of [
      [[{ col: 0, layer: 0, super: true }], 'gun', 'กำลังผสม: ปืนฉีดน้ำ พิเศษ'],
      [
        [
          { col: 0, layer: 0 },
          { col: 1, layer: 0, super: true },
        ],
        'bombs',
        'กำลังผสม: ระเบิด พิเศษ',
      ],
      [
        [
          { col: 0, layer: 0 },
          { col: 0, layer: 1, super: true },
        ],
        'buddy',
        'กำลังผสม: ลูกทีม พิเศษ',
      ],
    ] as const) {
      layout(s, [...entries]);
      preview.sync(s);
      expect(preview.el.textContent).toBe(want);
      expect(stars(preview.el)).toHaveLength(1);
      expect(chipOf(preview.el)?.style.background).toBe(RECIPE_COLOURS[recipe]);
      expect(preview.el.style.borderColor).toBe(RECIPE_COLOURS[recipe]);
    }
    s.units.push({ ...s.units[1]!, id: 6 }, { ...s.units[1]!, id: 7 });
    preview.sync(s);
    expect(preview.el.textContent).toBe('ทีมเต็มแล้ว');
    expect(stars(preview.el)).toHaveLength(0);
    // Team full keeps the default look: no chip, no weapon border.
    expect(chipOf(preview.el)).toBeNull();
    expect(preview.el.style.borderColor).toBe('');
    layout(s, [
      { col: 0, layer: 0, super: true },
      { col: 3, layer: 0 },
    ]);
    preview.sync(s);
    expect(preview.el.textContent).toBe('ยังไม่ใช่สูตร');
    expect(stars(preview.el)).toHaveLength(0);
    // R2d: not-a-recipe reads grey — muted text, grey border, no chip.
    expect(chipOf(preview.el)).toBeNull();
    expect(preview.el.style.color).toBe('#adb5bd');
    expect(preview.el.style.borderColor).toBe('#868e96');
    layout(s, []);
    preview.sync(s);
    expect(preview.el.hidden).toBe(true);
    expect(preview.el.textContent).toBe('');
    layout(s, [{ col: 0, layer: 0, super: true }]);
    s.winner = 'dessert';
    preview.sync(s);
    expect(preview.el.hidden).toBe(true);
    expect(stars(preview.el)).toHaveLength(0);
  });

  it('keeps super text when images fail, without recreating failed images every frame', () => {
    const preview = new PreviewText(document.createElement('div'));
    const s = state();
    layout(s, [{ col: 0, layer: 0, super: true }]);
    preview.sync(s);
    expect(stars(preview.el)).toHaveLength(1);
    const star = stars(preview.el)[0] as HTMLImageElement;
    star.dispatchEvent(new Event('error'));
    preview.sync(s);
    expect(star.hidden).toBe(true);
    expect(stars(preview.el)[0]).toBe(star);
    expect(preview.el.textContent).toBe('กำลังผสม: ปืนฉีดน้ำ พิเศษ');
  });
});

describe('R2d activeRecipe (label chip + pad glow source of truth)', () => {
  it.each([
    [[{ col: 0, layer: 0 }], 'gun'],
    [
      [
        { col: 0, layer: 0 },
        { col: 1, layer: 0 },
      ],
      'bombs',
    ],
    [
      [
        { col: 0, layer: 0 },
        { col: 0, layer: 1 },
      ],
      'buddy',
    ],
    [
      [
        { col: 0, layer: 0 },
        { col: 1, layer: 0 },
        { col: 2, layer: 0 },
        { col: 3, layer: 0 },
      ],
      'heavy',
    ],
    [
      [
        { col: 0, layer: 0 },
        { col: 0, layer: 1 },
        { col: 1, layer: 0 },
        { col: 1, layer: 1 },
      ],
      'class',
    ],
  ] as const)('lights %s -> %s', (entries, recipe) => {
    const s = state();
    layout(s, [...entries]);
    expect(activeRecipe(s)).toBe(recipe);
  });

  it('stays dark for diagonal pairs, three crates, team-full buddy, empty and finished pads', () => {
    const s = state();
    layout(s, [
      { col: 0, layer: 0 },
      { col: 3, layer: 0 },
    ]);
    expect(activeRecipe(s)).toBeNull(); // diagonal pair is not a recipe
    layout(s, [
      { col: 0, layer: 0 },
      { col: 1, layer: 0 },
      { col: 3, layer: 0 },
    ]);
    expect(activeRecipe(s)).toBeNull(); // three crates: no shape
    s.units.push({ ...s.units[1]!, id: 6 }, { ...s.units[1]!, id: 7 });
    layout(s, [
      { col: 0, layer: 0 },
      { col: 0, layer: 1 },
    ]);
    expect(activeRecipe(s)).toBeNull(); // team full: no glow
    layout(s, []);
    expect(activeRecipe(s)).toBeNull(); // empty pad
    layout(s, [{ col: 0, layer: 0 }]);
    s.winner = 'dessert';
    expect(activeRecipe(s)).toBeNull(); // match over
  });
});

describe('pad preview', () => {
  // Deliberate default-control fixture (see the R2-9 note above R1 held-item).
  it('glowCellFor: unit 0 alive on its own pad cell -> that cell; else null', () => {
    const s = state();
    expect(glowCellFor(s)).toBeNull(); // unit 0 starts at its stall
    s.units[0]!.pos = { x: s.pads.fruit.origin.x + 0.7, y: s.pads.fruit.origin.y + 0.7 };
    expect(glowCellFor(s)).toBe(0);
    s.units[0]!.deadUntilTick = s.tick + 1;
    expect(glowCellFor(s)).toBeNull();
  });

  it('glowStagePos: the glow marks the PAINTED tile, not the world-rect cell centre (R2c)', () => {
    const s = state();
    expect(glowStagePos(s)).toBeNull(); // no controlled unit on the pad yet
    s.units[0]!.pos = { x: s.pads.fruit.origin.x + 0.7, y: s.pads.fruit.origin.y + 0.7 };
    expect(glowStagePos(s)).toEqual(padPaintedCellStagePos(s.pads.fruit.origin, 0));
    // The painted tile of col0 (back) sits BELOW the world-rect cell centre
    // (591 vs 573 stage px) — the x1.3 art grew the painted floor downwards
    // from the world rect, so the old position glowed the pad's back skirt.
    expect(glowStagePos(s)!.y).toBeGreaterThan(Math.round((s.pads.fruit.origin.y + 1.1) * 30));
    s.units[0]!.deadUntilTick = s.tick + 1;
    expect(glowStagePos(s)).toBeNull();
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
    expect(preview.el.textContent).toBe('กำลังผสม: ปืนฉีดน้ำ');
    s.pads.fruit.cells[0]![0] = null;
    s.pads.fruit.cells[0]![1] = null;
    s.pads.fruit.cells[0]![0] = 1; // two ground crates in cols 0 and 3:
    s.pads.fruit.cells[3]![0] = 2; // non-adjacent -> not a recipe
    preview.sync(s);
    expect(preview.el.textContent).toBe('ยังไม่ใช่สูตร');
  });
});
