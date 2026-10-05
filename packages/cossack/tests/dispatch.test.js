import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findProjectRoot } from '../src/fs-utils.js';
import { COMMANDS, dispatch } from '../src/dispatch.js';
import { run, runCaptured } from '../src/spawn.js';
import { runLifecycle } from '../src/lifecycle-process.js';

vi.mock('../src/spawn.js', () => ({
  run: vi.fn(async () => 0),
  runCaptured: vi.fn(async () => ({ code: 0, stdout: 'built\n', stderr: '' })),
}));
vi.mock('../src/lifecycle-process.js', () => ({
  runLifecycle: vi.fn(async () => ({ exitCode: 0, data: { event: 'started' }, diagnostics: [] })),
}));

const projectRoot = await findProjectRoot(process.cwd());
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
const viteExecutable = path.join(path.dirname(projectRequire.resolve('vite/package.json')), 'bin/vite.js');
const viteOptions = { cwd: projectRoot, shell: false };

const temporaryDirectories = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(dir =>
    fs.rm(dir, { recursive: true, force: true })));
});

describe('command dispatch', () => {
  it.each(Object.keys(COMMANDS))('%s help succeeds without running the command', async command => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = vi.spyOn(COMMANDS[command], 'run');
    expect(await dispatch([command, '--help'])).toBe(0);
    expect(handler).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(COMMANDS[command].help());
  });

  it.each([
    ['build', ['--mode', 'staging', '--outDir=dist/staging'], 'build'],
    ['dev', ['--host', '127.0.0.1', '--port', '5174'], 'dev'],
    ['ssg', ['--mode', 'production'], 'build'],
  ])('forwards %s options to Vite', async (command, args, viteCommand) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch([command, ...args])).toBe(0);
    if (command === 'dev') {
      expect(runLifecycle).toHaveBeenCalledWith('dev', 'vite', [viteCommand, ...args], expect.objectContaining({
        cwd: process.cwd(), metadata: { tool: 'vite' }, json: false,
      }));
    } else if (command === 'build') expect(run).toHaveBeenCalledWith(process.execPath, [viteExecutable, viteCommand, ...args], viteOptions);
    else expect(run).toHaveBeenCalledWith('vite', [viteCommand, ...args]);
  });

  it.each([
    ['build', ['--env', 'staging', '--mode', 'development'], 'build'],
    ['dev', ['--mode', 'development', '--env=staging', '--host', '127.0.0.1'], 'dev'],
    ['ssg', ['--mode', 'staging', '--env', 'staging'], 'build'],
  ])('selects the Cloudflare environment before %s loads Vite config', async (command, args, viteCommand) => {
    vi.stubEnv('CLOUDFLARE_ENV', 'production');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch([command, ...args])).toBe(0);
    const expectedArgs = command === 'dev'
      ? ['dev', '--mode', 'development', '--host', '127.0.0.1']
      : command === 'build'
        ? ['build', '--mode', 'development']
        : ['build', '--mode', 'staging'];
    const options = { env: { CLOUDFLARE_ENV: 'staging' } };
    if (command === 'dev') {
      expect(runLifecycle).toHaveBeenCalledWith('dev', 'vite', expectedArgs, expect.objectContaining({
        env: options.env,
        metadata: { tool: 'vite', environment: 'staging' },
      }));
    } else {
      if (command === 'build') expect(run).toHaveBeenCalledWith(process.execPath, [viteExecutable, ...expectedArgs], { ...options, ...viteOptions });
      else expect(run).toHaveBeenCalledWith('vite', expectedArgs, options);
    }
    expect(viteCommand).toBe(command === 'dev' ? 'dev' : 'build');
  });

  it.each(['build', 'ssg'])('%s forwards --env to Vite through JSON child environment', async command => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch([command, '--env=staging', '--json', '--mode', 'preview'])).toBe(0);
    if (command === 'build') expect(runCaptured).toHaveBeenCalledWith(process.execPath, [viteExecutable, 'build', '--mode', 'preview'], {
      ...viteOptions, env: { CLOUDFLARE_ENV: 'staging' }, discardOutput: true,
    });
    else expect(runCaptured).toHaveBeenCalledWith('vite', ['build', '--mode', 'preview'], {
      env: { CLOUDFLARE_ENV: 'staging' }, discardOutput: true,
    });
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ command, ok: true,
      data: { environment: 'staging' } });
  });

  it.each(['build', 'dev', 'ssg'])('%s reports an inherited Cloudflare environment in JSON', async command => {
    vi.stubEnv('CLOUDFLARE_ENV', 'staging');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch([command, '--json'])).toBe(0);
    if (command === 'dev') {
      expect(runLifecycle).toHaveBeenCalledWith('dev', 'vite', ['dev'], expect.objectContaining({
        metadata: { tool: 'vite', environment: 'staging' },
      }));
    } else {
      expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ command, ok: true,
        data: { environment: 'staging' } });
      if (command === 'build') expect(runCaptured).toHaveBeenCalledWith(process.execPath, [viteExecutable, 'build'], { ...viteOptions, discardOutput: true });
      else expect(runCaptured).toHaveBeenCalledWith('vite', ['build'], { discardOutput: true });
    }
  });

  it.each([
    [['--env'], 'COSSACK_OPTION_VALUE_REQUIRED'],
    [['--env='], 'COSSACK_OPTION_VALUE_REQUIRED'],
    [['--env=staging', '--env=production'], 'COSSACK_OPTION_REPEATED'],
  ])('rejects invalid or repeated Vite environments before starting a process', async (args, code) => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch(['build', ...args, '--json'])).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(runCaptured).not.toHaveBeenCalled();
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      command: 'build', ok: false, diagnostics: [{ code, severity: 'error' }],
    });
  });

  it('leaves arguments after -- untouched, including help', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await dispatch(['dev', '--', '--help']);
    expect(runLifecycle).toHaveBeenCalledWith('dev', 'vite', ['dev', '--', '--help'], expect.any(Object));
  });

  it('leaves Cloudflare-looking arguments after -- to the underlying tool', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await dispatch(['dev', '--', '--env', 'staging']);
    expect(runLifecycle).toHaveBeenCalledWith('dev', 'vite', ['dev', '--', '--env', 'staging'], expect.any(Object));
  });

  it.each(['build', 'ssg'])('%s consumes --json and emits exactly one envelope', async command => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch([command, '--json', '--mode', 'staging'])).toBe(0);
    if (command === 'build') expect(runCaptured).toHaveBeenCalledWith(process.execPath, [viteExecutable, 'build', '--mode', 'staging'], { ...viteOptions, discardOutput: true });
    else expect(runCaptured).toHaveBeenCalledWith('vite', ['build', '--mode', 'staging'], { discardOutput: true });
    expect(run).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      schemaVersion: 1, command, ok: true, data: { exitCode: 0 },
    });
  });

  it('preserves --json after the forwarding boundary and handles explicit false', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await dispatch(['build', '--json=false', '--', '--json']);
    expect(run).toHaveBeenCalledWith(process.execPath, [viteExecutable, 'build', '--', '--json'], viteOptions);
  });

  it('reaches legacy SSG option diagnostics while preserving Vite flags', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await dispatch(['ssg', '--base-url', 'https://example.test', '--mode', 'staging']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('--base-url https://example.test'));
    expect(run).toHaveBeenCalledWith('vite', ['build', '--mode', 'staging']);
  });

  it('creates no project or manifest for create --dry-run', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-dispatch-'));
    temporaryDirectories.push(parent);
    const target = path.join(parent, 'app');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch(['create', target, '--adapter', 'node', '--preset', 'minimal', '--dry-run'])).toBe(0);
    expect(await fs.readdir(parent)).toEqual([]);
    expect(output).toHaveBeenCalledWith('  write package.json');
    expect(output).toHaveBeenCalledWith('No files were changed.');
  });

  it('emits one JSON creation plan with no secret values or filesystem writes', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-json-'));
    temporaryDirectories.push(parent);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch(['create', path.join(parent, 'app'), '--adapter=node',
      '--preset=auth', '--dry-run', '--json'])).toBe(0);
    expect(output).toHaveBeenCalledTimes(1);
    const result = JSON.parse(output.mock.calls[0][0]);
    expect(result).toMatchObject({ schemaVersion: 1, command: 'create', ok: true,
      diagnostics: [], data: { status: 'dry-run' } });
    expect(result.data.recipe.config).not.toHaveProperty('authSecret');
    expect(result.data.changes.writes).toContainEqual(expect.objectContaining({ path: 'package.json' }));
    expect(await fs.readdir(parent)).toEqual([]);
  });

  it('emits structured creation errors', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch(['create', '--json'])).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      schemaVersion: 1, command: 'create', ok: false,
      diagnostics: [{ code: 'COSSACK_ARGUMENT_MISSING', severity: 'error' }],
    });
  });
});
