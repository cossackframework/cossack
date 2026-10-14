import { describe, expect, it } from 'vitest';
import {
  detectInvokedPackageManager,
  packageManagerCommands,
  packageManagerInvocation,
} from '../src/package-manager.js';

describe('package manager commands', () => {
  it.each([
    ['npm/11.4.0 node/v24', 'npm', 'npm install', 'npm run dev', 'npx cossack upgrade'],
    ['pnpm/10.29.3 npm/? node/v24', 'pnpm', 'pnpm install', 'pnpm dev', 'pnpm exec cossack upgrade'],
    ['yarn/4.9.2 npm/? node/v24', 'yarn', 'yarn install', 'yarn dev', 'yarn cossack upgrade'],
    ['bun/1.2.20 npm/? node/v24', 'bun', 'bun install', 'bun run dev', 'bun run cossack upgrade'],
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

  it('detects Bun without npm invocation metadata', () => {
    expect(detectInvokedPackageManager({
      env: {},
      versions: { bun: '1.2.20' },
      execPath: '/usr/bin/bun',
    })).toBe('bun');
  });

  it('falls back to npm for unknown invocations', () => {
    expect(detectInvokedPackageManager({
      env: {},
      versions: {},
      execPath: '/usr/bin/node',
    })).toBe('npm');
  });
});

describe('packageManagerInvocation', () => {
  it('runs the .cmd shim through the shell on Windows when no entry script is known', () => {
    expect(packageManagerInvocation('pnpm', ['install'], { platform: 'win32', env: {}, execPath: 'C:\\node.exe' }))
      .toEqual({ command: 'pnpm.cmd', args: ['install'], shell: true });
  });

  it('refuses shell metacharacters when it must use the Windows shell', () => {
    expect(() => packageManagerInvocation('pnpm', ['view', 'pkg@latest&calc'], { platform: 'win32', env: {} }))
      .toThrow(/Windows shell/);
  });

  it('runs the invoking package manager JS entry with the current Node binary', () => {
    const env = { npm_execpath: 'C:\\Users\\me\\pnpm\\bin\\pnpm.cjs' };
    expect(packageManagerInvocation('pnpm', ['install'], { platform: 'win32', env, execPath: 'C:\\node.exe' }))
      .toEqual({ command: 'C:\\node.exe', args: ['C:\\Users\\me\\pnpm\\bin\\pnpm.cjs', 'install'], shell: false });
  });

  it('runs a native package manager executable directly', () => {
    const env = { npm_execpath: 'C:\\tools\\pnpm.exe' };
    expect(packageManagerInvocation('pnpm', ['install'], { platform: 'win32', env }))
      .toEqual({ command: 'C:\\tools\\pnpm.exe', args: ['install'], shell: false });
  });

  it('ignores an entry that belongs to another package manager', () => {
    const env = { npm_execpath: 'C:\\npm\\bin\\npm-cli.js' };
    expect(packageManagerInvocation('pnpm', ['install'], { platform: 'win32', env }))
      .toEqual({ command: 'pnpm.cmd', args: ['install'], shell: true });
  });

  it('runs the PATH command outside Windows even when npm_execpath names the manager', () => {
    // PATH wrappers (version managers, test stubs) must keep working on POSIX.
    const env = { npm_execpath: '/home/me/.local/share/pnpm/pnpm.cjs' };
    expect(packageManagerInvocation('pnpm', ['install'], { platform: 'linux', env, execPath: '/usr/bin/node' }))
      .toEqual({ command: 'pnpm', args: ['install'], shell: false });
  });

  it('uses the bare command without a shell on POSIX', () => {
    expect(packageManagerInvocation('yarn', ['install'], { platform: 'darwin', env: {} }))
      .toEqual({ command: 'yarn', args: ['install'], shell: false });
  });
});
