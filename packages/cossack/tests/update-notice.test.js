import { describe, expect, it, vi } from 'vitest';
import {
  checkForCossackUpdate,
  isNewerVersion,
} from '../src/update-notice.js';

describe('Cossack update notice', () => {
  it('compares stable semantic versions', () => {
    expect(isNewerVersion('0.8.0', '0.7.6')).toBe(true);
    expect(isNewerVersion('0.7.6', '0.7.6')).toBe(false);
    expect(isNewerVersion('0.7.5', '0.7.6')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true);
  });

  it('returns the latest npm version only when it is newer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.8.0' }),
    });

    await expect(checkForCossackUpdate('0.7.6', { fetchImpl }))
      .resolves.toBe('0.8.0');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://registry.npmjs.org/cossack/latest',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('silently ignores registry and network failures', async () => {
    await expect(checkForCossackUpdate('0.7.6', {
      fetchImpl: vi.fn().mockResolvedValue({ ok: false }),
    })).resolves.toBeUndefined();
    await expect(checkForCossackUpdate('0.7.6', {
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
    })).resolves.toBeUndefined();
  });

  it('respects a configured npm registry including path prefixes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.8.0' }),
    });

    await checkForCossackUpdate('0.7.6', {
      fetchImpl,
      registry: 'https://registry.example.test/npm/public',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://registry.example.test/npm/public/cossack/latest',
      expect.any(Object),
    );
  });
});
