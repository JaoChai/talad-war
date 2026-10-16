import { expect, test, vi } from 'vitest';
// The GPU allocation boundary is replaced, not glow math or match rendering.
vi.mock('phaser', () => ({ default: {} }));
import { MatchView } from '../src/render/view';

test('ground-crate glow emits a saturated, readable1.6x halo while pad layers stay soft', () => {
  // Shrinking the outer layer or restoring faint0.06/0.10/0.16 alpha makes
  // the ground halo indistinguishable from arena light pools at phone size.
  const makeView = () => {
    const layers: { width: number; height: number; colour: number; alpha: number }[] = [];
    const container = {
      setName: () => container,
      add: (layer: (typeof layers)[number]) => layers.push(layer),
    };
    const subject = Object.create(MatchView.prototype) as MatchView;
    Object.assign(subject, {
      scene: {
        add: {
          container: () => container,
          ellipse: (
            _x: number,
            _y: number,
            width: number,
            height: number,
            colour: number,
            alpha: number,
          ) => ({ width, height, colour, alpha }),
        },
      },
    });
    return { subject, layers };
  };
  const ground = makeView();
  const glow = ground.subject['groundGlow'] as unknown as (
    name: string,
    width: number,
    height: number,
    colour: number,
    vivid: boolean,
  ) => unknown;
  glow.call(ground.subject, 'crate-glow-1', 66, 26, 0xffb21f, true);
  expect(ground.layers).toEqual([
    { width: 105.60000000000001, height: 41.6, colour: 0xffb21f, alpha: 0.2 },
    { width: 82.5, height: 32.5, colour: 0xffb21f, alpha: 0.34 },
    { width: 62.699999999999996, height: 24.7, colour: 0xffb21f, alpha: 0.48 },
  ]);
  const pad = makeView();
  pad.subject['groundGlow']('pad-glow-fruit', 100, 80, 0x2f7bff);
  expect(pad.layers.map(({ alpha }) => alpha)).toEqual([0.06, 0.1, 0.16]);
});
