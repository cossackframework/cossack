import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studioCommand, studioHelp } from '../src/commands/studio.js';

let root;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-studio-cli-'));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture","type":"module"}\n');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function context(flags = {}) {
  return { cwd: root, flags, force: false, dryRun: false };
}

describe('studio command', () => {
  it('documents the public flags', () => {
    expect(studioHelp()).toContain('--remote');
    expect(studioHelp()).toContain('--database <d1-binding>');
    expect(studioHelp()).toContain('--driver <driver>');
    expect(studioHelp()).toContain('--env <wrangler-environment>');
    expect(studioHelp()).toContain('--port <number>');
    expect(studioHelp()).toContain('--no-open');
  });

  it('prints help without resolving the optional package', async () => {
    expect(await studioCommand([], context({ help: true }))).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('cossack studio'));
  });

  it('reports a friendly missing-package error', async () => {
    expect(await studioCommand([], context({ 'no-open': true }))).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('cossack add studio'),
    );
  });

  it('validates ports before starting Studio', async () => {
    expect(await studioCommand([], context({ port: 'nope' }))).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--port must be'));
  });

  it('resolves Studio from the consumer project and forwards all options', async () => {
    const packageRoot = path.join(
      root,
      'node_modules',
      '@cossackframework',
      'studio',
    );
    await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: '@cossackframework/studio',
      type: 'module',
      exports: {
        '.': './dist/index.js',
        './package.json': './package.json',
      },
    }));
    await fs.writeFile(path.join(packageRoot, 'dist/index.js'), `
      export async function runStudio(options) {
        globalThis.__cossackStudioCliOptions = options;
      }
    `);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'fixture',
      type: 'module',
      devDependencies: { '@cossackframework/studio': '^0.7.4' },
    }));
    expect(await studioCommand([], context({
      remote: true,
      database: 'DB',
      driver: 'postgres',
      env: 'production',
      port: '5001',
      'no-open': true,
    }))).toBe(0);
    expect(globalThis.__cossackStudioCliOptions).toEqual({
      projectRoot: root,
      remote: true,
      database: 'DB',
      provider: 'postgres',
      env: 'production',
      port: 5001,
      open: false,
    });
    delete globalThis.__cossackStudioCliOptions;
  });
});
