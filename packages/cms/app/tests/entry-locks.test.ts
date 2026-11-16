import { describe, expect, it } from 'vitest';
import { collectionResource, CORE_BLOCKS, posts, type RecordShape } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { entryLock, entryViewParts } from '../src/cms/site';
import { apiEntries } from '../src/cms/content-api';

const record = (fields: Record<string, unknown>): RecordShape => ({ id: 'p1', rev: 1, createdAt: 1, updatedAt: 1, owner: 'author-1', title: 'Members news', slug: 'members-news', status: 'published', ...fields }) as RecordShape;
const resource = collectionResource({ ...posts, fields: { ...posts.fields, subtitle: { kind: 'string', label: 'Subtitle' } } });
const host = (editor: boolean) => ({
    resource: () => ({ canUpdate: () => editor }),
    resourceById: () => resource,
    entryUrls: async (_collection: unknown, records: readonly RecordShape[]) => new Map(records.map(entry => [entry.id, `/posts/${String(entry.slug)}`])),
}) as unknown as CmsHost;
const visitor = { kind: 'anonymous' } as const;
const member = { kind: 'user', id: 'reader-1', roles: ['subscriber'], permissions: [] } as const;

describe('locked entries', () => {
    it('locks a protected entry until it is unlocked, and a members-only one until the visitor signs in', () => {
        expect(entryLock(record({}), { signedIn: false })).toBeNull();
        expect(entryLock(record({ password: 'open sesame' }), { signedIn: true })).toBe('password');
        expect(entryLock(record({ password: 'open sesame' }), { signedIn: false, unlocked: new Set(['p1']) })).toBeNull();
        expect(entryLock(record({ membersOnly: true }), { signedIn: false })).toBe('members');
        expect(entryLock(record({ membersOnly: true }), { signedIn: true })).toBeNull();
        // Signing in does not unlock a password.
        expect(entryLock(record({ membersOnly: true, password: 'x' }), { signedIn: true })).toBe('password');
    });

    it('limits a members-only entry to its roles, and never locks an entry for its editors', () => {
        const gold = record({ membersOnly: true, memberRoles: ['gold', 'silver'] });
        expect(entryLock(gold, { signedIn: false })).toBe('members');
        expect(entryLock(gold, { signedIn: true, roles: ['subscriber'] })).toBe('members');
        expect(entryLock(gold, { signedIn: true, roles: ['subscriber', 'silver'] })).toBeNull();
        expect(entryLock(gold, { signedIn: true, roles: ['author'], editor: true })).toBeNull();
        expect(entryLock(record({ password: 'x' }), { signedIn: true, editor: true })).toBeNull();
        // Roles apply only with the switch on.
        expect(entryLock(record({ memberRoles: ['gold'] }), { signedIn: false })).toBeNull();
    });

    it('gives the content API the core fields of a members-only entry alone until the reader signs in', async () => {
        const entry = record({ membersOnly: true, content: [{ _id: 'b1', type: 'core/paragraph', data: { text: 'secret' } }], excerpt: 'secret', subtitle: 'secret', summary: 'secret', categories: ['c1'] });
        const [locked] = await apiEntries(host(false), posts, [entry], false, visitor);
        expect(locked).toMatchObject({ id: 'p1', title: 'Members news', slug: 'members-news', categories: ['c1'], membersOnly: true, locked: 'members', url: '/posts/members-news' });
        expect(JSON.stringify(locked)).not.toContain('secret');
        const [open] = await apiEntries(host(false), posts, [entry], false, member);
        expect(open).toMatchObject({ subtitle: 'secret', excerpt: 'secret' });
        const [other] = await apiEntries(host(false), posts, [{ ...entry, memberRoles: ['gold'] }], false, member);
        expect(other).toMatchObject({ locked: 'members' });
        expect(JSON.stringify(other)).not.toContain('secret');
    });

    it('withholds every declared field of a protected entry, not only its content, and never sends the password', async () => {
        const entry = record({ password: 'open sesame', subtitle: 'secret', content: [] });
        const [locked] = await apiEntries(host(false), posts, [entry], false, member);
        expect(locked).toMatchObject({ protected: true, locked: 'password' });
        expect(JSON.stringify(locked)).not.toMatch(/secret|sesame/);
        const [edited] = await apiEntries(host(true), posts, [entry], false, member);
        expect(edited).toMatchObject({ password: 'open sesame', subtitle: 'secret' });
        const [plain] = await apiEntries(host(false), posts, [record({ password: '' })], false, visitor);
        expect(plain).not.toHaveProperty('password');
    });
});

describe('the cms.site.entry-view hook', () => {
    const view = { title: 'Hello', excerpt: 'An entry.', url: '/posts/hello' } as never;
    const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));
    const filtered = (value: unknown) => ({ hooks: { applyFilters: async () => value }, blockTypes: types }) as unknown as CmsHost;
    const paragraph = (id: string, text: string) => ({ _id: id, type: 'core/paragraph', data: { text } });

    it('takes a filter\'s title, excerpt and blocks around the content', async () => {
        const parts = await entryViewParts(filtered({ title: 'Hello!', excerpt: 'Changed.', before: [paragraph('ad1', 'Sponsored')], after: [paragraph('sub1', 'Subscribe')] }), posts, record({}), view, false);
        expect(parts).toMatchObject({ title: 'Hello!', excerpt: 'Changed.', before: [{ type: 'core/paragraph' }], after: [{ type: 'core/paragraph' }] });
    });

    it('drops markup blocks, unknown types and oversized lists, so no filter puts script on the site', async () => {
        const html = { _id: 'h1', type: 'core/html', data: { html: '<script>alert(1)</script>' } };
        const nested = { _id: 'g1', type: 'core/group', data: {}, children: [html] };
        const parts = await entryViewParts(filtered({ title: 'Hello', excerpt: 'An entry.', before: [html], after: [nested] }), posts, record({}), view, false);
        expect(parts).toMatchObject({ before: [], after: [] });
        const unknown = await entryViewParts(filtered({ title: 'Hello', excerpt: '', before: [{ _id: 'x1', type: 'evil/script', data: {} }], after: Array.from({ length: 11 }, (_, index) => paragraph(`p${index}`, 'x')) }), posts, record({}), view, false);
        expect(unknown).toMatchObject({ before: [], after: [] });
    });

    it('keeps the view as it is when a filter returns nothing usable', async () => {
        expect(await entryViewParts(filtered(null), posts, record({}), view, false)).toBeNull();
        expect(await entryViewParts(filtered({ title: 42, excerpt: null }), posts, record({}), view, false)).toMatchObject({ title: 'Hello', excerpt: 'An entry.' });
    });
});
