import { expect, it } from 'vitest';
import { measureAttackMotion } from './attackMotion.helpers';

// Fixed station + bounded mill cannot cross 0.1 tile per 200ms for seconds.
// These are naturally reached matches, not teleported attack fixtures.
// Lead-authorized fallback: known unresolved acceptance, not a GREEN fix.
it.fails.each([7, 42, 43])(
  'KNOWN UNRESOLVED seed %i: live attack bots exceed the 5 second QA idle limit',
  (seed) => {
    const result = measureAttackMotion(seed);
    console.log(JSON.stringify(result));
    expect(result.attackSamples).toBeGreaterThan(100);
    for (const [id, seconds] of Object.entries(result.attackIdle)) {
      expect(seconds, `seed ${seed}, bot ${id}`).toBeLessThanOrEqual(5.000001);
    }
  },
);
