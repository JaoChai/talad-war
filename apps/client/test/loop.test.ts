import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/loop';

describe('FixedLoop', () => {
  it('runs one tick per 50 ms at 20 Hz', () => {
    const loop = new FixedLoop(20);
    expect(loop.advance(50)).toBe(1);
    expect(loop.advance(25)).toBe(0);
    expect(loop.advance(25)).toBe(1);
  });

  it('clamps catch-up to 5 ticks when a huge gap arrives (tab hidden)', () => {
    const loop = new FixedLoop(20);
    // Review Focus 5: returning from a hidden tab must not run hundreds of ticks.
    expect(loop.advance(10_000)).toBe(5);
    // The backlog is dropped, not stored: the next frame is a normal frame.
    expect(loop.advance(16)).toBe(0);
  });

  it('honours a custom maxCatchUpTicks', () => {
    const loop = new FixedLoop(20, 2);
    expect(loop.advance(10_000)).toBe(2);
  });

  it('keeps alpha in [0, 1)', () => {
    const loop = new FixedLoop(20);
    expect(loop.advance(0)).toBe(0);
    expect(loop.alpha()).toBe(0);
    loop.advance(30); // no tick yet
    expect(loop.alpha()).toBeGreaterThanOrEqual(0);
    expect(loop.alpha()).toBeLessThan(1);
    loop.advance(20); // one tick consumed, 0 ms left over
    expect(loop.alpha()).toBe(0);
    loop.advance(45); // 45 ms carried
    expect(loop.alpha()).toBeGreaterThanOrEqual(0);
    expect(loop.alpha()).toBeLessThan(1);
  });

  it('ignores negative elapsed time', () => {
    const loop = new FixedLoop(20);
    expect(loop.advance(-100)).toBe(0);
    expect(loop.alpha()).toBe(0);
  });
});
