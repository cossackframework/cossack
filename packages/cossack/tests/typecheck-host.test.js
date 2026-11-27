import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { typecheckCommand } from '../src/commands/typecheck.js';

let root;

async function write(relative, value) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-typecheck-host-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('cossack typecheck and the mounted packages', () => {
  it('gives a package\'s steps for a project behind its template, before any type error', async () => {
    await write('package.json', { name: 'app', cossack: { packages: ['@acme/kit'], template: '0.9.2' } });
    await write('node_modules/@acme/kit/app/src/.keep', '');
    await write('node_modules/@acme/kit/package.json', { name: '@acme/kit', version: '0.9.3', cossack: { root: 'app/src', host: [],
      hostTemplate: '0.9.3', hostSteps: { '0.9.3': ['src/bootstrap/middlewares.ts: list ormRequestMiddleware first.'] } } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(typecheckCommand([], { flags: {}, cwd: root })).resolves.toBe(1);
    const message = errors.mock.calls.map(([line]) => String(line)).join('\n');
    expect(message).toContain('COSSACK_PACKAGE_HOST_OUTDATED');
    expect(message).toContain('needs project files from template 0.9.3, and this project is at 0.9.2');
    expect(message).toContain('  - src/bootstrap/middlewares.ts: list ormRequestMiddleware first.');
  });
});
