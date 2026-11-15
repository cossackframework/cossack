import { describe, expect, it, vi } from 'vitest';
import type { CmsHost } from '@cossackframework/cms/server';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { listUpTo } = await import('../src/cms/content');

/** A collection of `count` entries whose list, like the repository's, refuses more than 100 a call. */
function host(count: number, calls: { limit: number; offset: number }[]): CmsHost {
    const list = async ({ limit = 20, offset = 0 }: { limit?: number; offset?: number }) => {
        if (limit > 100) throw new Error('limit must be 1..100.');
        calls.push({ limit, offset });
        const records = Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, i) => ({ id: `e${offset + i}` }));
        return { records, ...(offset + limit < count ? { more: true } : {}) };
    };
    return { resource: () => ({ list }) } as unknown as CmsHost;
}

describe('listUpTo', () => {
    const principal = { kind: 'user' as const, id: 'a', roles: ['admin'], permissions: ['*'] };

    it('reads more than one list call takes, in pages of 100', async () => {
        const calls: { limit: number; offset: number }[] = [];
        const records = await listUpTo(host(250, calls), 'cms/patterns', {}, principal, 200);
        expect(records).toHaveLength(200);
        expect(records.at(-1)!.id).toBe('e199');
        expect(calls).toEqual([{ limit: 100, offset: 0 }, { limit: 100, offset: 100 }]);
    });

    it('stops at the last page', async () => {
        const calls: { limit: number; offset: number }[] = [];
        expect(await listUpTo(host(4, calls), 'cms/patterns', {}, principal, 200)).toHaveLength(4);
        expect(calls).toHaveLength(1);
    });
});
