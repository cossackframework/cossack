import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandSpecs } from '../src/command-specs.js';
import { parseFlags } from '../src/flags.js';
import { COMMANDS, dispatch } from '../src/dispatch.js';
import { setResultSink } from '../src/output.js';

const bin = fileURLToPath(new URL('../bin/cossack.js', import.meta.url));
const initialCwd = process.cwd();
let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-contract-'));
  // Any attempted project-code/config parsing is detectable and must not occur.
  await fs.writeFile(path.join(root, 'package.json'), '{private-parse-value');
  process.chdir(root);
});
afterEach(async () => {
  process.chdir(initialCwd);
  setResultSink(undefined);
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * Dispatch in-process with the same result sink the JSON runner installs, and
 * report what would have reached stdout/stderr. Validation contracts do not
 * need a fresh Node process per command; `run()` below keeps real-subprocess
 * smoke coverage for the bin/JSON-runner path.
 */
async function dispatchCaptured(argv) {
  const results = [];
  setResultSink(result => results.push(result));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const code = await dispatch(argv);
    return {
      code,
      stdout: results.map(result => JSON.stringify(result) + '\n').join('') + log.mock.calls.map(args => args.join(' ') + '\n').join(''),
      stderr: error.mock.calls.map(args => args.join(' ')).join('\n'),
    };
  } finally {
    setResultSink(undefined);
    log.mockRestore();
    error.mockRestore();
  }
}

function run(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...argv], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI timeout')); }, 10000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(deadline); reject(error); });
    child.on('close', code => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
  });
}

describe('metadata-backed command validation', () => {
  it.each(Object.entries(COMMANDS))('%s generates options/help from its parser contract', async (name, command) => {
    expect(command.spec).toBe(commandSpecs[name]);
    const help = (await command.load()).help();
    for (const [option, definition] of command.spec.options([], true)) {
      expect(help).toContain((option.length === 1 ? '-' : '--') + option);
      const scope = Object.entries(command.spec.subcommands ?? {}).find(([, sub]) =>
        Object.hasOwn(sub.flags ?? {}, definition.name))?.[0] ?? Object.keys(command.spec.subcommands ?? {})[0];
      const raw = [...(scope ? [scope] : []), ...(definition.type === 'boolean'
        ? [`--${option}=false`] : [`--${option}=--literal`])];
      // Parse without executing or requiring positionals; validation may reject an enum/arity.
      try { parseFlags(raw, command.spec); }
      catch (error) { expect(error.code).not.toBe('COSSACK_OPTION_UNKNOWN'); }
    }
  });

  it('canonicalizes aliases and rejects contradictions without exposing values', () => {
    expect(parseFlags(['app', '-f=false', '-y', '--adapter=node'], commandSpecs.create).flags)
      .toMatchObject({ force: false, yes: true, adapter: 'node' });
    expect(() => parseFlags(['app', '--force=false', '-f'], commandSpecs.create))
      .toThrow('Conflicting values');
    expect(() => parseFlags(['database', '--database=d1', '--dialect=postgres'], commandSpecs.add))
      .toThrow('Conflicting values');
    expect(parseFlags(['app', '--force', '--force=false'], commandSpecs.create).flags.force).toBe(false);
    expect(parseFlags(['app', '--force', '-f'], commandSpecs.create).flags.force).toBe(true);
  });

  it('allows repeated list options but rejects repeated scalar options', () => {
    expect(parseFlags(['app', '--features=ui', '--features=auth'], commandSpecs.create).flags.features).toEqual(['ui', 'auth']);
    expect(() => parseFlags(['app', '--adapter=node', '--adapter=cloudflare'], commandSpecs.create)).toThrow('one value');
    expect(parseFlags(['--force-file=a', '--force-file=b'], commandSpecs.upgrade).flags['force-file']).toEqual(['a', 'b']);
    expect(parseFlags(['plan', '--local', '--remote=false'], commandSpecs.migration).flags)
      .toMatchObject({ local: true, remote: false });
  });

  it('preserves inline flag-looking values and treats everything after -- as positional', () => {
    expect(() => parseFlags(['app', '--', '--json'], commandSpecs.create)).toThrow('positional');
    expect(parseFlags(['--title=--literal', 'page', 'index'], commandSpecs.generate).flags.title).toBe('--literal');
    expect(() => parseFlags(['--title', '--literal', 'page', 'index'], commandSpecs.generate)).toThrow('expects a value');
    expect(parseFlags(['--', '--literal'], commandSpecs.upgrade).args).toEqual(['--literal']);
  });

  it.each([
    ['create', ['app', '--adapter=node', '--database=d1'], 'COSSACK_TARGET_INCOMPATIBLE'],
    ['adapter', ['node', '--database=d1'], 'COSSACK_TARGET_INCOMPATIBLE'],
    ['migration', ['up', '--local', '--remote'], 'COSSACK_OPTION_CONFLICT'],
    ['migration', ['plan', '--local', '--target=remote'], 'COSSACK_OPTION_CONFLICT'],
    ['migration', ['up', '--direction=down'], 'COSSACK_OPTION_UNKNOWN'],
    ['migration', ['status', 'ignored'], 'COSSACK_ARGUMENT_UNEXPECTED'],
    ['schema', ['check', '--output=models.ts'], 'COSSACK_OPTION_UNKNOWN'],
    ['seeder', ['list', '--only=secret-seeder'], 'COSSACK_OPTION_UNKNOWN'],
    ['studio', ['--driver=postgres', '--remote'], 'COSSACK_TARGET_INCOMPATIBLE'],
    ['lang', ['publish', 'ignored'], 'COSSACK_ARGUMENT_UNEXPECTED'],
    ['lang', ['add', '../escape'], 'COSSACK_LOCALE_INVALID'],
    ['lang', ['add', 'es', '--locale=de'], 'COSSACK_OPTION_CONFLICT'],
    ['generate', ['service', 'Thing', '--head'], 'COSSACK_OPTION_UNSUPPORTED'],
    ['inspect', ['routes', '--env'], 'COSSACK_OPTION_VALUE_REQUIRED'],
    ['check', ['cloudflare', 'ignored'], 'COSSACK_ARGUMENT_UNEXPECTED'],
  ])('%s rejects invalid input before project parsing/effects', async (command, args, code) => {
    const result = await dispatchCaptured([command, ...args, '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      schemaVersion: 1, command, ok: false, diagnostics: [{ code, severity: 'error' }],
    });
    expect(result.stdout).not.toContain('private-parse-value');
    expect(await fs.readdir(root)).toEqual(['package.json']);
    expect(await fs.readFile(path.join(root, 'package.json'), 'utf8')).toBe('{private-parse-value');
  });

  it.each(Object.keys(COMMANDS))('%s rejects invalid boolean syntax', async command => {
    const result = await dispatchCaptured([command, '--json', '--json=invalid']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    const resultData = JSON.parse(result.stdout);
    expect(resultData).toMatchObject({ command, ok: false });
    expect(resultData.diagnostics[0].code).toBe('COSSACK_OPTION_INVALID');
    expect(await fs.readdir(root)).toEqual(['package.json']);
  });

  it.each(Object.keys(COMMANDS).filter(name => !commandSpecs[name].forwardsArgs))(
    '%s rejects unknown options with supported alternatives before project imports', async command => {
      const result = await dispatchCaptured([command, '--unknown-option=private-option-value', '--json']);
      expect(result.code).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('private-option-value');
      expect(JSON.parse(result.stdout).diagnostics[0]).toMatchObject({
        code: 'COSSACK_OPTION_UNKNOWN', supported: expect.arrayContaining(['--json', '--help']),
      });
      expect(await fs.readdir(root)).toEqual(['package.json']);
    });

  it.each(['g', 'd', 'migrate', 'seed', 'v'])('%s resolves its canonical command before validation', async alias => {
    const result = await dispatchCaptured([alias, '--unknown-option=value', '--json']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).command).toBe(Object.entries(COMMANDS).find(([, def]) => def.aliases.includes(alias))[0]);
  });

  it.each([
    ['migration', 'up', '--direction=down'],
    ['seeder', 'list', '--only=TestSeeder'],
    ['schema', 'check', '--output=models.ts'],
  ])('%s rejects scoped options before importing even declared project tooling', async (command, action, option) => {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      type: 'module', dependencies: { '@cossackframework/database': '0.8.3' },
    }));
    const packageRoot = path.join(root, 'node_modules', '@cossackframework', 'database');
    await fs.mkdir(path.join(packageRoot, 'dist', 'tooling'), { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: '@cossackframework/database', type: 'module', exports: { './package.json': './package.json' },
    }));
    await fs.writeFile(path.join(packageRoot, 'dist', 'tooling', 'index.js'),
      'import fs from "node:fs"; fs.writeFileSync("project-imported", "effect"); ' +
      'console.log("private-project-log"); export async function runORMCommand() { return 0; }');
    const result = await dispatchCaptured([command, action, option, '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('private-project-log');
    expect(JSON.parse(result.stdout).diagnostics[0].code).toBe('COSSACK_OPTION_UNKNOWN');
    expect(await fs.readdir(root)).toEqual(['node_modules', 'package.json']);
  });

  it.each([
    [['version', '--json', '--json=invalid'], 'version', 'COSSACK_OPTION_INVALID'],
    [['migrate', 'up', '--direction=down', '--json'], 'migration', 'COSSACK_OPTION_UNKNOWN'],
  ])('real subprocess smoke: %j fails validation through the JSON runner', async (argv, command, code) => {
    const result = await run(argv);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ schemaVersion: 1, command, ok: false, diagnostics: [{ code }] });
    expect(await fs.readdir(root)).toEqual(['package.json']);
  });

  it('supports explicit help true/false and never resolves a project for help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch(['create', '--help=true', '--json'])).toBe(0);
    expect(JSON.parse(log.mock.calls[0][0]).data.help).toContain('--package-manager');
    log.mockClear();
    expect(await dispatch(['create', '--help', '--help=false', '--json'])).toBe(1);
    expect(JSON.parse(log.mock.calls[0][0]).diagnostics[0].code).toBe('COSSACK_ARGUMENT_MISSING');
  });
});
