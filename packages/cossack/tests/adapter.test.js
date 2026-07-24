import { afterEach, describe, expect, it, vi } from 'vitest';

const { detectProjectRuntimeMock, switchAdapterMock } = vi.hoisted(() => ({
  detectProjectRuntimeMock: vi.fn(),
  switchAdapterMock: vi.fn(),
}));

vi.mock('@cossackframework/scaffold', () => ({
  ADAPTERS: ['cloudflare', 'node'],
  detectProjectRuntime: detectProjectRuntimeMock,
  switchAdapter: switchAdapterMock,
}));

vi.mock('../src/fs-utils.js', () => ({
  exists: vi.fn(async () => false),
  findProjectRoot: vi.fn(async (cwd) => cwd),
  readJsonIfExists: vi.fn(async () => ({ packageManager: 'pnpm@10.0.0' })),
}));

import {
  adapterCommand,
  adapterHelp,
} from '../src/commands/adapter.js';
import { detectAdapter } from '../src/commands/start.js';

describe('adapter command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    detectProjectRuntimeMock.mockReset();
    switchAdapterMock.mockReset();
  });

  it('passes runtime switch flags to the scaffold engine', async () => {
    switchAdapterMock.mockResolvedValue({
      status: 'changed',
      previousAdapter: 'cloudflare',
      targetAdapter: 'node',
      databaseChange: {
        previous: 'd1',
        target: 'sqlite',
        changed: true,
        installed: true,
      },
      changes: { writes: [{ path: 'src/index.ts' }], deletes: [], preserved: [] },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await adapterCommand(['node'], {
      cwd: '/project',
      flags: { database: 'sqlite', yes: true },
      force: true,
      dryRun: false,
    });

    expect(code).toBe(0);
    expect(switchAdapterMock).toHaveBeenCalledWith('/project', 'node', {
      database: 'sqlite',
      force: true,
      dryRun: false,
      yes: true,
      interactive: false,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm install'));
    expect(log).toHaveBeenCalledWith('No database contents were migrated.');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DB_PATH'));
  });

  it('previews dry-run paths and does not print install steps', async () => {
    switchAdapterMock.mockResolvedValue({
      status: 'dry-run',
      previousAdapter: 'node',
      targetAdapter: 'cloudflare',
      changes: {
        writes: [{ path: 'wrangler.jsonc', overwrite: false }],
        deletes: [{ path: '.env.example' }],
        preserved: [{ path: 'src/pages/index.ts', reason: 'locally-modified' }],
      },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await adapterCommand(['cloudflare'], {
      cwd: '/project',
      flags: {},
      force: false,
      dryRun: true,
    })).toBe(0);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('wrangler.jsonc');
    expect(output).toContain('.env.example');
    expect(output).toContain('src/pages/index.ts');
    expect(output).not.toContain('install');
  });

  it('handles present, cancellation, invalid targets, help, and prompt aborts', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    switchAdapterMock.mockResolvedValueOnce({ status: 'present' });
    expect(await adapterCommand(['node'], {
      cwd: '/project', flags: {}, force: false, dryRun: false,
    })).toBe(0);
    expect(log).toHaveBeenCalledWith(
      '  present  node is already the active adapter',
    );

    switchAdapterMock.mockResolvedValueOnce({ status: 'cancelled' });
    expect(await adapterCommand(['cloudflare'], {
      cwd: '/project', flags: {}, force: false, dryRun: false,
    })).toBe(0);
    expect(log).toHaveBeenCalledWith('Cancelled. No files were changed.');

    expect(await adapterCommand([], {
      cwd: '/project', flags: {}, force: false, dryRun: false,
    })).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(
      'Supported values: cloudflare, node',
    ));

    expect(await adapterCommand([], {
      cwd: '/project', flags: { help: true }, force: false, dryRun: false,
    })).toBe(0);
    expect(log).toHaveBeenCalledWith(adapterHelp());

    switchAdapterMock.mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { code: 'COSSACK_PROMPT_ABORTED' }),
    );
    expect(await adapterCommand(['node'], {
      cwd: '/project', flags: {}, force: false, dryRun: false,
    })).toBe(130);
  });

  it('uses scaffold runtime metadata for lifecycle detection', async () => {
    detectProjectRuntimeMock.mockResolvedValue('cloudflare');
    await expect(detectAdapter('/project')).resolves.toBe('cloudflare');
    expect(detectProjectRuntimeMock).toHaveBeenCalledWith('/project');
  });
});
