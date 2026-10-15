import { expect, it } from 'vitest';
import { measureAttackMotion } from './attackMotion.helpers';

// Fixed station + bounded mill cannot cross 0.1 tile per 200ms for seconds.
// These are naturally reached matches, not teleported attack fixtures.
it.each([7, 42, 43])(
  'seed %i: live attack bots never stay below QA movement threshold for over 2 seconds',
  (seed) => {
    const result = measureAttackMotion(seed);
    console.log(JSON.stringify(result));
    expect(result.attackSamples).toBeGreaterThan(100);
    for (const [id, seconds] of Object.entries(result.attackIdle)) {
      expect(seconds, `seed ${seed}, bot ${id}`).toBeLessThanOrEqual(2.000001);
    }
  },
);
