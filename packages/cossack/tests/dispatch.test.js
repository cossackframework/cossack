import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COMMANDS, dispatch } from '../src/dispatch.js';
import { run, runCaptured } from '../src/spawn.js';

vi.mock('../src/spawn.js', () => ({
  run: vi.fn(async () => 0),
  runCaptured: vi.fn(async () => ({ code: 0, stdout: 'built\n', stderr: '' })),
}));

const temporaryDirectories = [];
afterEach(async () => {
  vi.restoreAllMocks();
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
    expect(run).toHaveBeenCalledWith('vite', [viteCommand, ...args]);
  });

  it('leaves arguments after -- untouched, including help', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await dispatch(['dev', '--', '--help']);
    expect(run).toHaveBeenCalledWith('vite', ['dev', '--', '--help']);
  });

  it.each(['build', 'ssg'])('%s consumes --json and emits exactly one envelope', async command => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await dispatch([command, '--json', '--mode', 'staging'])).toBe(0);
    expect(runCaptured).toHaveBeenCalledWith('vite', ['build', '--mode', 'staging']);
    expect(run).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledTimes(1);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      schemaVersion: 1, command, ok: true, data: { exitCode: 0, output: 'built' },
    });
  });

  it('preserves --json after the forwarding boundary and handles explicit false', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await dispatch(['build', '--json=false', '--', '--json']);
    expect(run).toHaveBeenCalledWith('vite', ['build', '--', '--json']);
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
      diagnostics: [{ code: 'COSSACK_PROJECT_NAME_REQUIRED', severity: 'error' }],
    });
  });
});
