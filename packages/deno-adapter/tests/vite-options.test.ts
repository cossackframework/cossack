import { describe, expect, it } from 'vitest';
import { cossackDeno } from '../src/vite';

describe('Deno development lifecycle bounds', () => {
  it.each([0, -1, NaN, Infinity, 2147483648])('rejects unusable startup/shutdown deadlines: %s', value => {
    expect(() => cossackDeno({ startupTimeoutMs: value })).toThrow('milliseconds');
    expect(() => cossackDeno({ shutdownTimeoutMs: value })).toThrow('milliseconds');
  });
});
