import { afterEach, describe, expect, it, vi } from 'vitest';

const { removeMock } = vi.hoisted(() => ({
  removeMock: vi.fn(),
}));

vi.mock('@cossackframework/scaffold', () => ({
  FEATURES: ['ui', 'database', 'auth', 'dashboard', 'examples'],
  removeFeatureFromProject: removeMock,
}));

vi.mock('../src/fs-utils.js', () => ({
  findProjectRoot: vi.fn(async (cwd) => cwd),
}));

import { removeCommand } from '../src/commands/remove.js';

describe('remove command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removeMock.mockReset();
  });

  it('passes non-interactive and force options to the scaffold engine', async () => {
    removeMock.mockResolvedValue({
      status: 'removed',
      recipe: { resolvedFeatures: ['ui', 'examples'] },
      changes: { writes: [], deletes: [{ path: 'src/auth.ts' }] },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await removeCommand(['database'], {
      cwd: '/project',
      flags: { yes: true },
      force: true,
      dryRun: false,
    });

    expect(code).toBe(0);
    expect(removeMock).toHaveBeenCalledWith('/project', 'database', {
      force: true,
      dryRun: false,
      yes: true,
      interactive: false,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Resolved features: ui, examples'));
  });

  it('reports an already absent feature without failure', async () => {
    removeMock.mockResolvedValue({
      status: 'absent',
      recipe: { resolvedFeatures: [] },
      changes: { writes: [], deletes: [] },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await removeCommand(['auth'], {
      cwd: '/project',
      flags: {},
      force: false,
      dryRun: false,
    })).toBe(0);
    expect(log).toHaveBeenCalledWith('  absent   auth is not installed');
  });
});
