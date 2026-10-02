import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandSpec, runWithSpec } from '../src/command-spec.js';
import { versionCommand } from '../src/commands/version.js';
import { routesCommand } from '../src/commands/routes.js';
import { parseFlags } from '../src/flags.js';

function ctxWith(flags) {
  const { flags: parsed } = parseFlags(flags);
  return { flags: parsed, cwd: process.cwd(), force: false, dryRun: false };
}

afterEach(() => vi.restoreAllMocks());

describe('CommandSpec validation (CLI-02)', () => {
  const spec = new CommandSpec({
    name: 'demo',
    positionals: ['target'],
    minPositionals: 1,
    flags: { port: { type: 'string' }, verbose: { type: 'boolean', aliases: ['v'] } },
  });

  it('accepts declared flags, aliases, and global flags', () => {
    expect(spec.validate(['x'], { port: '3000', verbose: true, force: true, json: true })).toEqual([]);
  });

  it('rejects unknown flags with the supported alternatives', () => {
    const diagnostics = spec.validate(['x'], { prot: '3000' });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'COSSACK_OPTION_UNKNOWN' });
    expect(diagnostics[0].message).toContain('--prot');
    expect(diagnostics[0].supported).toEqual(expect.arrayContaining(['--port', '--verbose', '--json']));
  });

  it('validates declared types, empty values, repetition, and aliases before effects', () => {
    expect(spec.validate(['x'], { port: true })[0]).toMatchObject({ code: 'COSSACK_OPTION_VALUE_REQUIRED' });
    expect(spec.validate(['x'], { port: '' })[0]).toMatchObject({ code: 'COSSACK_OPTION_VALUE_REQUIRED' });
    expect(spec.validate(['x'], { port: ['3000', '8080'] })[0]).toMatchObject({ code: 'COSSACK_OPTION_REPEATED' });
    expect(spec.validate(['x'], { 'x-typo': 'oops' })[0]).toMatchObject({ code: 'COSSACK_OPTION_UNKNOWN' });
    expect(spec.validate(['x'], { force: true, f: true })).toEqual([]);
  });

  it('rejects missing and extra positionals with stable codes', () => {
    expect(spec.validate([], {})).toEqual([expect.objectContaining({ code: 'COSSACK_ARGUMENT_MISSING' })]);
    expect(spec.validate(['a', 'b'], {})).toEqual([expect.objectContaining({ code: 'COSSACK_ARGUMENT_UNEXPECTED' })]);
  });

  it('does not validate unknown flags for forwarding commands', () => {
    const forwarder = new CommandSpec({ name: 'fwd', forwardsArgs: true });
    expect(forwarder.validate([], { anything: true, weird: 'x' })).toEqual([]);
  });
});

describe('runWithSpec envelope (CLI-03)', () => {
  it('emits one versioned JSON result for a data handler', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spec = new CommandSpec({ name: 'demo' });
    await runWithSpec(spec, [], ctxWith(['--json']), async () => ({ value: 7 }));
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      schemaVersion: 1, command: 'demo', ok: true, data: { value: 7 }, diagnostics: [],
    });
  });

  it('maps exit-code results and thrown failures to coded diagnostics', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spec = new CommandSpec({ name: 'demo' });
    expect(await runWithSpec(spec, [], ctxWith(['--json']), async () => 2)).toBe(2);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ ok: false, data: { exitCode: 2 } });
    log.mockClear();
    expect(await runWithSpec(spec, [], ctxWith(['--json']), async () => {
      throw Object.assign(new Error('nope'), { code: 'COSSACK_X' });
    })).toBe(1);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      ok: false, diagnostics: [{ code: 'COSSACK_X', severity: 'error' }],
    });
  });

  it('validation failures emit diagnostics before any handler effect', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spec = new CommandSpec({ name: 'demo', minPositionals: 1 });
    const handler = vi.fn();
    expect(await runWithSpec(spec, [], ctxWith(['--json']), handler)).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0][0]).diagnostics[0].code).toBe('COSSACK_ARGUMENT_MISSING');
  });
});

describe('command integration', () => {
  it('version --json emits the envelope', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await versionCommand([], ctxWith(['--json']))).toBe(0);
    const result = JSON.parse(log.mock.calls.at(-1)[0]);
    expect(result).toMatchObject({ schemaVersion: 1, command: 'version', ok: true });
    expect(result.data.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('version rejects unknown flags and extra positionals', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Unknown flag: use the =value form so parsing succeeds and the command
    // spec (not the parser) rejects it with the supported alternatives.
    expect(await versionCommand([], ctxWith(['--bogus=1']))).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown option --bogus'));
    expect(await versionCommand(['extra'], ctxWith(['--json']))).toBe(1);
  });

  it('routes --json returns structured route rows', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await routesCommand([], ctxWith(['--json']))).toBe(0);
    const result = JSON.parse(log.mock.calls.at(-1)[0]);
    expect(result.command).toBe('routes');
    expect(Array.isArray(result.data.routes)).toBe(true);
    for (const route of result.data.routes) {
      expect(route).toHaveProperty('route');
      expect(route).toHaveProperty('filePath');
      expect(Array.isArray(route.layouts)).toBe(true);
    }
  });
});

describe('flag parsing edge cases (CLI-02 acceptance)', () => {
  it('aliases resolve to their canonical flag', () => {
    const { args, flags } = parseFlags(['--yes', 'target']);
    expect(flags.yes).toBe(true);
    const { flags: aliased } = parseFlags(['-f']);
    expect(aliased.force).toBe(true);
  });

  it('repeated string values collect in order', () => {
    const { flags } = parseFlags(['--port', '3000', '--port', '8080']);
    expect(flags.port).toEqual(['3000', '8080']);
  });

  it('stops flag parsing at -- so tool arguments survive verbatim', () => {
    const { args, flags } = parseFlags(['--json', '--', '--weird', 'value']);
    expect(flags.json).toBe(true);
    expect(args).toEqual(['--weird', 'value']);
  });

  it('a flag value that resembles another flag is a parse error, not a silent boolean', () => {
    expect(() => parseFlags(['--tag', '--force'])).toThrow('--tag expects a value');
    expect(() => parseFlags(['--tag'])).toThrow('--tag expects a value');
  });

  it('explicit false survives and overrides an earlier true', () => {
    const { flags } = parseFlags(['--force', '--force=false']);
    expect(flags.force).toBe(false);
  });

  it('invalid boolean values are rejected with a parse error', () => {
    expect(() => parseFlags(['--force=maybe'])).toThrow();
  });
});
