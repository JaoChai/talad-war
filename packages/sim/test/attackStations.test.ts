import { describe, expect, it } from 'vitest';
import { botInput, createMatch, step } from '../src/index';
import type { MatchState, Team } from '../src/index';

function attackers(team: Team): MatchState {
  const s = createMatch(43, { humanUnit: null });
  s.units = s.units.filter((u) => u.team === team);
  s.commands[team] = 'attack';
  // Preserve team indices 1 and 2, including the idle human's index 0.
  s.units[0]!.isBot = false;
  s.units[1]!.pos = team === 'fruit' ? { x: 32.3, y: 4.5 } : { x: 7.7, y: 19.5 };
  s.units[2]!.pos = team === 'fruit' ? { x: 32.3, y: 4.7 } : { x: 7.7, y: 19.3 };
  return s;
}

describe('QA-01: close attackers', () => {
  it('two slappers spread to separate stations and keep hitting instead of milling over each other', () => {
    let s = attackers('fruit');
    let overlap = 0;
    let hits = 0;
    let anchor: { x: number; y: number } | null = null;
    let maxRoam = 0;
    for (let t = 0; t < 200; t++) {
      s = step(s, new Map());
      if (t < 40) continue; // allow two seconds to reach their stations
      const [a, b] = [s.units[1]!, s.units[2]!];
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 0.8) overlap++;
      if (t === 100) anchor = { ...a.pos };
      if (anchor) maxRoam = Math.max(maxRoam, Math.hypot(a.pos.x - anchor.x, a.pos.y - anchor.y));
      hits += s.events.filter((e) => e.kind === 'hit' && e.target === 'dessert').length;
    }
    expect(maxRoam).toBeLessThan(0.7); // hold the station, not a full-speed lap of the stall
    expect(overlap).toBeLessThan(16); // <10% of 160 settled ticks
    expect(hits).toBeGreaterThanOrEqual(25);
  });

  it('a late attacker takes a free nearby face instead of walking through occupied stations', () => {
    const s = attackers('fruit');
    s.units[1]!.pos = { x: 32.3, y: 4.4 };
    s.units[2]!.pos = { x: 33.7, y: 6.7 };
    const late = { ...s.units[2]!, id: 8, pos: { x: 32.2, y: 4.6 } };
    s.units.push(late);
    const input = botInput(s, late.id);
    // The free west-north face is directly above; the old fixed slot routes
    // this newcomer southeast through the two incumbents' corner.
    expect(input.move.y).toBeLessThan(-0.5);
    let next = s;
    for (let t = 0; t < 100; t++) next = step(next, new Map());
    const arrived = next.units.find((u) => u.id === late.id)!;
    expect(arrived.pos.y).toBeLessThan(3);
    expect(
      Math.hypot(arrived.pos.x - next.units[1]!.pos.x, arrived.pos.y - next.units[1]!.pos.y),
    ).toBeGreaterThan(1.8);
  });

  it('a lone slapper keeps its existing mobile approach when there is no crowd to spread', () => {
    const s = attackers('fruit');
    s.units = s.units.slice(0, 2);
    s.units[1]!.pos = { x: 32.3, y: 4.4 };
    const input = botInput(s, s.units[1]!.id);
    expect(Math.hypot(input.move.x, input.move.y)).toBeCloseTo(1, 9);
  });

  it('slappers explicitly face the stall while firing', () => {
    const s = attackers('fruit');
    const input = botInput(s, s.units[1]!.id);
    expect(input.fire).toBe(true);
    expect(input.aim).toEqual({ x: 33, y: 4.5 });
    const next = step(s, new Map());
    expect(next.units[1]!.facing.x).toBeGreaterThan(0.95);
  });

  it('close-attack stations and facing mirror by team index, not global unit id', () => {
    let f = attackers('fruit');
    let d = attackers('dessert');
    for (let t = 0; t < 200; t++) {
      for (const i of [1, 2]) {
        const a = botInput(f, f.units[i]!.id);
        const b = botInput(d, d.units[i]!.id);
        expect(b.move.x).toBeCloseTo(-a.move.x, 9);
        expect(b.move.y).toBeCloseTo(-a.move.y, 9);
        expect(b.fire).toBe(a.fire);
      }
      f = step(f, new Map());
      d = step(d, new Map());
      for (const i of [1, 2]) {
        expect(d.units[i]!.pos.x).toBeCloseTo(40 - f.units[i]!.pos.x, 9);
        expect(d.units[i]!.pos.y).toBeCloseTo(24 - f.units[i]!.pos.y, 9);
        expect(d.units[i]!.facing.x).toBeCloseTo(-f.units[i]!.facing.x, 9);
        expect(d.units[i]!.facing.y).toBeCloseTo(-f.units[i]!.facing.y, 9);
      }
    }
  });
});
