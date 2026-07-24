import { afterEach, describe, expect, it, vi } from 'vitest';

const { createAppMock } = vi.hoisted(() => ({
  createAppMock: vi.fn(),
}));

vi.mock('@cossackframework/scaffold', () => ({
  createApp: createAppMock,
}));

import { createCommand } from '../src/commands/create.js';

describe('create command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    createAppMock.mockReset();
  });

  it('prints the Cossack banner before starting project creation', async () => {
    createAppMock.mockResolvedValue({
      projectDir: '/tmp/example',
      adapter: 'node',
      recipe: { preset: 'minimal' },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const exitCode = await createCommand(['example'], {
      cwd: '/tmp',
      flags: { yes: true },
      force: false,
    });

    expect(exitCode).toBe(0);
    expect(log.mock.calls[0][0]).toContain('########');
    expect(createAppMock).toHaveBeenCalledWith('example', expect.objectContaining({
      adapter: undefined,
      interactive: false,
      preset: undefined,
    }));
  });
});
