import { describe, expect, it, vi } from 'vitest';
import { collectionResource, posts, type RecordShape } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import type { Context } from 'hono';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);

const { buildFeed } = await import('../src/cms/feeds');
const { entrySeo } = await import('../src/cms/seo');
const { entriesList, entryRead } = await import('../src/cms/manage');

const record = (id: string, fields: Record<string, unknown>): RecordShape => ({ id, rev: 1, createdAt: 1, updatedAt: 1, publishedAt: 1, owner: 'author-1', title: `Entry ${id}`, slug: `entry-${id}`, status: 'published', ...fields }) as RecordShape;
const settings = new Proxy({ 'general.siteTitle': 'Site', 'reading.feedItems': 10, 'reading.feedContent': 'full' } as Record<string, unknown>, { get: (target, key: string) => key in target ? target[key] : '' });
const resource = collectionResource(posts);
const pattern = record('pat1', { title: 'Private pattern', content: [{ _id: 'pb', type: 'core/paragraph', data: { text: 'secret pattern' } }] });

function host(records: RecordShape[]): CmsHost {
    return {
        settings: { all: async () => settings },
        collection: () => posts,
        collections: () => [posts],
        resource: (name: string) => name === 'cms/patterns'
            ? { getMany: async () => new Map([[pattern.id, pattern]]) }
            : { list: async () => ({ records }), get: async (id: string) => records.find(entry => entry.id === id) ?? null, canUpdate: () => false },
        resourceById: () => resource,
        entryUrls: async (_collection: unknown, entries: readonly RecordShape[]) => new Map(entries.map(entry => [entry.id, `/posts/${String(entry.slug)}`])),
        users: { getMany: async () => new Map() },
        languages: async () => ({ multilingual: false, all: ['en'], default: 'en' }),
        archiveUrl: async () => '/posts',
        taxonomies: { getMany: async () => new Map() },
        blockTypes: new Map(),
    } as unknown as CmsHost;
}

describe('locked entries stay locked outside their page', () => {
    it('leaves protected and members-only entries out of feeds', async () => {
        const feed = await buildFeed(host([record('a', { body: 'open text' }), record('b', { password: 'x', body: 'secret body', summary: 'secret summary' }), record('c', { membersOnly: true, body: 'secret members' })]), { collection: posts, origin: 'https://example.com', self: 'https://example.com/feed' });
        expect(feed.items.map(item => item.id)).toEqual(['a']);
        expect(JSON.stringify(feed)).not.toContain('secret');
    });

    it('builds no structured data from a locked entry\'s content', async () => {
        const entry = record('p1', { password: 'x', summary: 'secret summary', content: [{ _id: 'f1', type: 'core/faq', data: { schema: true }, children: [{ _id: 'q1', type: 'core/faq-item', data: { question: 'Why?', answer: 'secret answer' } }] }] });
        const c = { req: { url: 'https://example.com/posts/entry-p1' } } as unknown as Context;
        const view = { locked: 'password', title: 'Entry p1', excerpt: '', url: '/posts/entry-p1', terms: [], locale: 'en', date: '', image: null } as never;
        const seo = await entrySeo(host([entry]), c, posts, entry, view, []);
        expect(JSON.stringify(seo)).not.toContain('secret');
        const open = await entrySeo(host([entry]), c, posts, entry, { ...(view as object), locked: null } as never, []);
        expect(open.jsonLd).toContain('secret answer');
    });

    it('lists no synced patterns for a locked entry in the API', async () => {
        const content = [{ _id: 'b1', type: 'core/pattern', data: { pattern: pattern.id } }];
        const read = (entry: RecordShape, principal: unknown) => entryRead({ get: (key: string) => key === 'cms' ? host([entry]) : principal } as unknown as Context, 'posts', String(entry.slug));
        const locked = await read(record('p1', { password: 'x', content }), { kind: 'anonymous' });
        expect(locked).toMatchObject({ item: { locked: 'password' }, patterns: {} });
        expect(JSON.stringify(locked)).not.toContain('secret');
        const open = await read(record('p2', { content }), { kind: 'anonymous' });
        expect(Object.keys(open!.patterns)).toEqual([pattern.id]);
    });

    it('lists only entries the reader may open when a filter or sort reads a field locked entries withhold', async () => {
        const calls: Record<string, unknown>[] = [];
        const listed = [record('a', { price: 49 }), record('m', { price: 49, membersOnly: true, memberRoles: ['vip'] })];
        const fields = { ...resource.fields, price: { kind: 'number', index: true } };
        const shop = { ...host(listed), resourceById: () => ({ ...resource, fields }),
            resource: () => ({ list: async (options: { where: Record<string, unknown> }) => { calls.push(options.where); return { records: listed }; }, count: async () => 2, canUpdate: () => false }) } as unknown as CmsHost;
        const list = (principal: unknown, query: Record<string, string>) => entriesList({ get: (key: string) => key === 'cms' ? shop : principal } as unknown as Context, 'posts', query);
        await list({ kind: 'anonymous' }, { 'filter[price]': '49' });
        expect(calls.at(-1)).toMatchObject({ price: 49, password: { in: [null, ''] }, membersOnly: { ne: true } });
        await list({ kind: 'anonymous' }, { sort: 'price' });
        expect(calls.at(-1)).toMatchObject({ password: { in: [null, ''] } });
        // A core field tells nothing a locked entry hides.
        await list({ kind: 'anonymous' }, { 'filter[title]': 'Entry a' });
        expect(calls.at(-1)).not.toHaveProperty('password');
        // Signed in, members-only entries stay in the query, and those for other roles leave the page.
        const member = { kind: 'user', id: 'u1', roles: ['subscriber'], permissions: [] };
        const page = await list(member, { 'filter[price]': '49' });
        expect(calls.at(-1)).not.toHaveProperty('membersOnly');
        expect(page.items.map(item => item.id)).toEqual(['a']);
        // Those who edit the collection see everything.
        await list({ kind: 'user', id: 'e1', roles: ['editor'], permissions: ['cms/*'] }, { 'filter[price]': '49' });
        expect(calls.at(-1)).not.toHaveProperty('password');
    });
});
