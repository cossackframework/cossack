import { afterEach, describe, expect, it, vi } from 'vitest';

const { checkForCossackUpdateMock, createAppMock } = vi.hoisted(() => ({
  checkForCossackUpdateMock: vi.fn(),
  createAppMock: vi.fn(),
}));

vi.mock('@cossackframework/scaffold', () => ({
  createApp: createAppMock,
}));

vi.mock('../src/update-notice.js', () => ({
  checkForCossackUpdate: checkForCossackUpdateMock,
}));

import { createCommand } from '../src/commands/create.js';
import { readPackageVersion } from '../src/pkg.js';

const currentVersion = readPackageVersion();

describe('create command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    checkForCossackUpdateMock.mockReset();
    createAppMock.mockReset();
  });

  it('prints the Cossack banner before starting project creation', async () => {
    createAppMock.mockResolvedValue({
      projectDir: '/tmp/example',
      adapter: 'node',
      recipe: { preset: 'minimal' },
    });
    checkForCossackUpdateMock.mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const exitCode = await createCommand(['example'], {
      cwd: '/tmp',
      flags: { yes: true },
      force: false,
    });

    expect(exitCode).toBe(0);
    expect(log.mock.calls[0][0]).toContain('########');
    expect(log.mock.calls[0][0]).toContain(`Cossack v${currentVersion}`);
    expect(createAppMock).toHaveBeenCalledWith('example', expect.objectContaining({
      adapter: undefined,
      interactive: false,
      preset: undefined,
    }));
  });

  it.each([
    ['cloudflare', 'pnpm/10.29.3 npm/? node/v24', 'pnpm install', 'pnpm dev'],
    ['node', 'npm/11.4.0 node/v24', 'npm install', 'npm run dev'],
    ['node', 'yarn/4.9.2 npm/? node/v24', 'yarn install', 'yarn dev'],
    ['node', 'bun/1.2.20 npm/? node/v24', 'bun install', 'bun run dev'],
    ['node', 'deno/2.4.0', 'deno install', 'deno task dev'],
  ])(
    'prints matching next steps for the %s adapter invoked by %s',
    async (adapter, userAgent, install, dev) => {
      vi.stubEnv('npm_config_user_agent', userAgent);
      createAppMock.mockResolvedValue({
        projectDir: '/tmp/example',
        adapter,
        recipe: { preset: 'minimal' },
      });
      checkForCossackUpdateMock.mockResolvedValue(undefined);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      expect(await createCommand(['example'], {
        cwd: '/tmp',
        flags: { adapter, yes: true },
        force: false,
      })).toBe(0);

      const output = log.mock.calls.map(([message]) => message).join('\n');
      expect(output).toContain(`Next steps:\n  cd example\n  ${install}\n  ${dev}`);
      expect(output).not.toContain('cossack dev');
      expect(output).not.toContain('pnpm start');
    },
  );

  it('prints a self-service update notice without updating automatically', async () => {
    vi.stubEnv('npm_config_user_agent', 'pnpm/10.29.3 npm/? node/v24');
    createAppMock.mockResolvedValue({
      projectDir: '/tmp/example',
      adapter: 'cloudflare',
      recipe: { preset: 'minimal' },
    });
    checkForCossackUpdateMock.mockResolvedValue('0.8.0');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await createCommand(['example'], {
      cwd: '/tmp',
      flags: { yes: true },
      force: false,
    })).toBe(0);

    const output = log.mock.calls.map(([message]) => message).join('\n');
    expect(output).toContain(`Update available: Cossack v${currentVersion} → v0.8.0`);
    expect(output).toContain('pnpm exec cossack upgrade');
  });

  it('supports an explicit package-manager override', async () => {
    vi.stubEnv('npm_config_user_agent', 'npm/11.4.0 node/v24');
    createAppMock.mockResolvedValue({
      projectDir: '/tmp/example',
      adapter: 'node',
      recipe: { preset: 'minimal' },
    });
    checkForCossackUpdateMock.mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await createCommand(['example'], {
      cwd: '/tmp',
      flags: { 'package-manager': 'bun', yes: true },
      force: false,
    })).toBe(0);

    const output = log.mock.calls.map(([message]) => message).join('\n');
    expect(output).toContain('bun install\n  bun run dev');
  });

  it('rejects an unsupported package manager', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await createCommand(['example'], {
      cwd: '/tmp',
      flags: { 'package-manager': 'composer', yes: true },
      force: false,
    })).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(
      'Use npm, pnpm, yarn, bun, or deno',
    ));
    expect(createAppMock).not.toHaveBeenCalled();
  });
});
