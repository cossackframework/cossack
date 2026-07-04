import { describe, it, expect } from 'vitest';
import { parseFlags } from '../src/flags.js';

describe('parseFlags', () => {
  it('treats --no-index and --ni as boolean flags', () => {
    const long = parseFlags(['--no-index', 'hello']);
    expect(long.flags['no-index']).toBe(true);
    expect(long.args).toEqual(['hello']);

    const short = parseFlags(['--ni', 'hello']);
    expect(short.flags.ni).toBe(true);
    expect(short.args).toEqual(['hello']);
  });
});
