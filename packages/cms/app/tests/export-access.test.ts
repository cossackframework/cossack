import { describe, expect, it, vi } from 'vitest';
import { collectionResource, posts, type RecordShape } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);

const { exportEntries } = await import('../src/cms/content');

const record = (id: string, fields: Record<string, unknown>): RecordShape => ({ id, rev: 1, createdAt: 1, updatedAt: 1, publishedAt: 1, owner: 'author-1', title: `Entry ${id}`, slug: `entry-${id}`, status: 'published', ...fields }) as RecordShape;
const resource = collectionResource(posts);

function host(records: RecordShape[], editable: (record: RecordShape) => boolean): CmsHost {
    return {
        collection: () => posts,
        resource: () => ({ list: async () => ({ records }), canUpdate: (entry: RecordShape) => editable(entry) }),
        resourceById: () => resource,
        entryUrls: async (_collection: unknown, entries: readonly RecordShape[]) => new Map(entries.map(entry => [entry.id, `/posts/${String(entry.slug)}`])),
    } as unknown as CmsHost;
}

async function exported(cms: CmsHost, principal: unknown): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    for await (const page of exportEntries(cms, 'posts', principal as never)) items.push(...page);
    return items;
}

describe('export', () => {
    const entries = [
        record('open', { body: 'open text' }),
        record('protected', { password: 'hunter2', body: 'secret protected' }),
        record('members', { membersOnly: true, body: 'secret members' }),
        record('vip', { membersOnly: true, memberRoles: ['vip'], body: 'secret vip' }),
    ];
    const subscriber = { kind: 'user', id: 'u1', roles: ['subscriber'], permissions: [] };

    it('leaves out entries the caller could not open, and every password the caller may not change', async () => {
        const items = await exported(host(entries, () => false), subscriber);
        expect(items.map(item => item.id)).toEqual(['open', 'members']);
        expect(JSON.stringify(items)).not.toMatch(/hunter2|secret (protected|vip)/);
        expect(items.every(item => !('password' in item))).toBe(true);
    });

    it('exports whole entries, passwords included, to those who may change them', async () => {
        const items = await exported(host(entries, entry => entry.id === 'protected'), subscriber);
        expect(items.map(item => item.id)).toEqual(['open', 'protected', 'members']);
        expect(items.find(item => item.id === 'protected')).toMatchObject({ password: 'hunter2', body: 'secret protected', url: '/posts/entry-protected' });
    });
});
