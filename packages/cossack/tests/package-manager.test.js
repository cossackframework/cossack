import { describe, expect, it } from 'vitest';
import {
  detectInvokedPackageManager,
  packageManagerCommands,
} from '../src/package-manager.js';

describe('package manager commands', () => {
  it.each([
    ['npm/11.4.0 node/v24', 'npm', 'npm install', 'npm run dev', 'npx cossack upgrade'],
    ['pnpm/10.29.3 npm/? node/v24', 'pnpm', 'pnpm install', 'pnpm dev', 'pnpm exec cossack upgrade'],
    ['yarn/4.9.2 npm/? node/v24', 'yarn', 'yarn install', 'yarn dev', 'yarn cossack upgrade'],
    ['bun/1.2.20 npm/? node/v24', 'bun', 'bun install', 'bun run dev', 'bun run cossack upgrade'],
    ['deno/2.4.0', 'deno', 'deno install', 'deno task dev', 'deno x -A npm:cossack upgrade'],
  ])('maps %s invocation to %s commands', (
    userAgent,
    manager,
    install,
    dev,
    upgrade,
  ) => {
    const detected = detectInvokedPackageManager({
      env: { npm_config_user_agent: userAgent },
      versions: {},
      execPath: '/usr/bin/node',
    });

    expect(detected).toBe(manager);
    expect(packageManagerCommands(detected)).toEqual({ install, dev, upgrade });
  });

  it('detects Bun and Deno without npm invocation metadata', () => {
    expect(detectInvokedPackageManager({
      env: {},
      versions: { bun: '1.2.20' },
      execPath: '/usr/bin/bun',
    })).toBe('bun');
    expect(detectInvokedPackageManager({
      env: { DENO_VERSION: '2.4.0' },
      versions: {},
      execPath: '/usr/bin/deno',
    })).toBe('deno');
  });

  it('falls back to npm for unknown invocations', () => {
    expect(detectInvokedPackageManager({
      env: {},
      versions: {},
      execPath: '/usr/bin/node',
    })).toBe('npm');
  });
});
