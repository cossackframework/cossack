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

  it('treats command help flags as booleans before positional arguments', () => {
    expect(parseFlags(['--help', 'node'])).toEqual({
      flags: { help: true },
      args: ['node'],
    });
    expect(parseFlags(['-h', 'cloudflare'])).toEqual({
      flags: { h: true },
      args: ['cloudflare'],
    });
  });

  it('treats Studio remote and no-open flags as booleans', () => {
    expect(parseFlags(['--remote', '--no-open', '--port', '5000'])).toEqual({
      flags: { remote: true, 'no-open': true, port: '5000' },
      args: [],
    });
  });
});
