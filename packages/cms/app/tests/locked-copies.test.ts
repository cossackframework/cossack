import { describe, expect, it, vi } from 'vitest';
import { collectionResource, posts, type Note, type Principal, type RecordShape } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);

const { duplicateEntry } = await import('../src/cms/content');
const { openMatches } = await import('../src/cms/site');
const { announceNote } = await import('../src/cms/notes-announce');

const record = (id: string, fields: Record<string, unknown> = {}): RecordShape => ({ id, rev: 1, createdAt: 1, updatedAt: 1, owner: 'author-1', title: `Entry ${id}`, slug: `entry-${id}`, status: 'published', ...fields }) as RecordShape;
const resource = collectionResource(posts);
const reader: Principal = { kind: 'user', id: 'reader-1', roles: ['subscriber'], permissions: ['cms/posts:read', 'cms/posts:create'] };

function host(records: RecordShape[], editors: readonly string[], created: Record<string, unknown>[] = []): CmsHost {
    return {
        collection: () => posts,
        resourceById: () => resource,
        resource: () => ({
            get: async (id: string) => records.find(entry => entry.id === id) ?? null,
            canUpdate: (_record: RecordShape, principal: Principal) => principal.kind === 'user' && editors.includes(principal.id),
            create: async (input: Record<string, unknown>) => { created.push(input); return record('copy', input); },
        }),
    } as unknown as CmsHost;
}

describe('copies and searches of locked entries', () => {
    it('copies a protected or members-only entry only for its editors', async () => {
        const entries = [record('open', { body: 'text' }), record('secret', { password: 'open sesame', body: 'secret' }), record('members', { membersOnly: true, body: 'secret' })];
        const created: Record<string, unknown>[] = [];
        await expect(duplicateEntry(host(entries, [], created), 'posts', 'secret', reader)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(duplicateEntry(host(entries, [], created), 'posts', 'members', reader)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(created).toEqual([]);
        await duplicateEntry(host(entries, [], created), 'posts', 'open', reader);
        await duplicateEntry(host(entries, ['reader-1'], created), 'posts', 'secret', reader);
        expect(created.map(input => input.password)).toEqual([undefined, 'open sesame']);
    });

    it('leaves locked entries out of dashboard searches for those who cannot open them', () => {
        const entries = [record('open'), record('secret', { password: 'x' }), record('members', { membersOnly: true }), record('gold', { membersOnly: true, memberRoles: ['gold'] })];
        expect(openMatches(host(entries, []), 'cms/posts', entries, reader).map(entry => entry.id)).toEqual(['open', 'members']);
        expect(openMatches(host(entries, ['reader-1']), 'cms/posts', entries, reader).map(entry => entry.id)).toEqual(['open', 'secret', 'members', 'gold']);
    });

    it('emails a note only to mentioned people who may read the entry\'s notes', async () => {
        const sent: string[] = [];
        const people = new Map([['ed', { id: 'ed', status: 'active', email: 'ed@example.com' }], ['rita', { id: 'rita', status: 'active', email: 'rita@example.com' }]]);
        const cms = {
            ...host([record('p1')], ['ed']),
            mail: { send: async (message: { to: string }) => { sent.push(message.to); } },
            mailFrom: 'site@example.com',
            settings: { get: async (key: string) => key === 'writing.notesEmail' ? true : 'Site' },
            notes: { mentioned: async () => ['ed', 'rita'] },
            users: { getMany: async () => people, principal: async (id: string) => ({ kind: 'user', id, roles: [], permissions: ['cms/posts:read'] }) },
            webhooks: { wants: async () => false },
        } as unknown as CmsHost;
        const note = { id: 'n1', resource: 'cms/posts', recordId: 'p1', parentId: null, userId: 'ann', target: 'entry', range: null, quote: '', body: 'Hi @ed @rita', status: 'open', resolvedBy: null, resolvedAt: null, createdAt: 1, updatedAt: 1 } as Note;
        await announceNote(cms, { kind: 'created', note }, { origin: null, route: 'posts', collection: 'posts', title: 'Entry', author: 'Ann' });
        expect(sent).toEqual(['ed@example.com']);
    });
});
