import { describe, expect, it } from 'vitest';
import { SIM_VERSION } from '../src/index';

describe('sim package', () => {
  it('exposes the sim version constant', () => {
    expect(SIM_VERSION).toBe('0.3.5');
  });
});
