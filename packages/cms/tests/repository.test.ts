import { beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import { afterCommit, beforeWrite, createCMS, defineResource, field, systemPrincipal, userPrincipal, type CmsHost, type ResourceEvent } from '../src/server/index';
import { romedbService, live } from './helpers';

const system = systemPrincipal('test');
const alice = userPrincipal('alice', ['author'], ['app/notes:create']);
const bob = userPrincipal('bob', ['author'], ['app/notes:create']);
const editor = userPrincipal('eve', ['editor'], ['app/*', 'staff']);

const articles = defineResource({
    name: 'articles',
    titleField: 'title',
    fields: {
        title: field.string({ required: true, max: 100, search: true }),
        body: field.text({ search: true }),
        status: field.enum(['draft', 'live'], { required: true, default: 'draft', index: true }),
        views: field.integer({ default: 0, min: 0 }),
        rating: field.number({ nullable: true }),
        big: field.bigint(),
        tags: field.list('string'),
        meta: field.json(),
        internal: field.string({ access: { read: 'staff', write: 'staff' } }),
    },
    access: { read: 'public', create: 'authenticated', update: { permission: 'app/articles:update' }, delete: { permission: 'app/articles:delete' } },
});

const notes = defineResource({
    name: 'notes',
    ownership: true,
    fields: { text: field.string({ required: true, search: true }) },
    access: { read: 'owner', create: { permission: 'app/notes:create' }, update: { any: ['owner', { permission: 'app/notes:update' }] }, delete: 'owner' },
});

describe.skipIf(!live)('resource repositories', () => {
    const service = romedbService();
    let cms: CmsHost;
    const events: ResourceEvent[] = [];
    const hooks = createHookRegistry();
    hooks.addFilter(beforeWrite, (draft, context) => {
        if (context.input.resource !== 'app/articles') return draft;
        if (typeof draft.title === 'string' && draft.title.includes('spam')) throw new Error('Titles cannot contain spam.');
        return typeof draft.title === 'string' ? { ...draft, title: draft.title.trim() } : draft;
    }, { plugin: 'moderation' });
    hooks.addAction(afterCommit, event => { events.push(event); }, { plugin: 'recorder' });

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), resources: [articles, notes], hooks });
        const report = await cms.migrate();
        expect(report.failed).toBeUndefined();
    });

    const count = async (rql: string) => Number((await cms.db.read([{ rql }])).results[0]!.rows[0]![0] as bigint);

    it('creates, reads and maps typed values to JSON-safe public shapes', async () => {
        const created = await cms.resource('app/articles').create({
            title: '  Hello  ', body: 'RomeDB stores typed values', rating: 4.5, big: '9223372036854775807', tags: ['a', 'b'], meta: { nested: { n: 1, x: 1.5 } },
        }, { principal: alice, id: 'hello' });
        expect(created).toMatchObject({ id: 'hello', rev: 1, title: 'Hello', status: 'draft', views: 0, owner: null });
        expect(created).not.toHaveProperty('internal');
        const read = await cms.resource('app/articles').get('hello', { principal: editor });
        expect(read).toMatchObject({ id: 'hello', rev: 1, title: 'Hello', status: 'draft', views: 0, rating: 4.5, big: '9223372036854775807', tags: ['a', 'b'], meta: { nested: { n: 1, x: 1.5 } }, internal: null });
        expect(JSON.parse(JSON.stringify(read))).toEqual(read);
        expect(await cms.resource('app/articles').get('missing', { principal: editor })).toBeNull();
    });

    it('validates input before any write and reports field errors', async () => {
        const repository = cms.resource('app/articles');
        await expect(repository.create({ body: 'no title' }, { principal: alice })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { title: 'is required.' } });
        await expect(repository.create({ title: 'x', status: 'archived' }, { principal: alice })).rejects.toMatchObject({ fields: { status: expect.stringContaining('one of') } });
        await expect(repository.create({ title: 'x', unknown: 1 }, { principal: alice })).rejects.toMatchObject({ fields: { unknown: 'is not a field of this resource.' } });
        await expect(repository.create({ title: 'x', internal: 'secret' }, { principal: alice })).rejects.toMatchObject({ fields: { internal: 'cannot be changed by you.' } });
        await expect(repository.create({ title: 'buy spam' }, { principal: alice })).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: 'Titles cannot contain spam.' });
        await expect(repository.create({ title: 'x' }, { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
    });

    it('lets exactly one of two concurrent edits win, with side effects only for the winner', async () => {
        const repository = cms.resource('app/articles');
        const created = await repository.create({ title: 'Race' }, { principal: alice, id: 'race' });
        const before = await count("SELECT count(*) FROM cms_audit WHERE record_id = 'race'");
        const results = await Promise.allSettled([
            repository.update('race', { title: 'First' }, { principal: editor, expectedRevision: created.rev }),
            repository.update('race', { title: 'Second' }, { principal: editor, expectedRevision: created.rev }),
        ]);
        expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'CMS_CONFLICT' });
        const winner = (results.find(result => result.status === "fulfilled") as unknown as PromiseFulfilledResult<{ title: string }>).value;
        const stored = await repository.get('race', { principal: editor });
        expect(stored).toMatchObject({ rev: 2, title: winner.title });
        expect(await count("SELECT count(*) FROM cms_audit WHERE record_id = 'race'")).toBe(before + 1);
        expect(await count("SELECT count(*) FROM cms_revisions WHERE record_id = 'race'")).toBe(2);
        expect(await count("SELECT count(*) FROM cms_outbox WHERE payload LIKE '%\"id\":\"race\"%'")).toBe(2);
        const history = await repository.revisions('race', { principal: editor });
        expect(history.map(entry => entry.revision)).toEqual([2, 1]);
        expect(history[0]!.data.title).toBe(winner.title);
    });

    it('writes no side effects for a stale edit or delete', async () => {
        const repository = cms.resource('app/articles');
        await repository.create({ title: 'Stale' }, { principal: alice, id: 'stale' });
        const audit = await count('SELECT count(*) FROM cms_audit');
        const outbox = await count('SELECT count(*) FROM cms_outbox');
        await expect(repository.update('stale', { title: 'x' }, { principal: editor, expectedRevision: 7 })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        await expect(repository.delete('stale', { principal: editor, expectedRevision: 7 })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await count('SELECT count(*) FROM cms_audit')).toBe(audit);
        expect(await count('SELECT count(*) FROM cms_outbox')).toBe(outbox);
        await repository.delete('stale', { principal: editor, expectedRevision: 1 });
        expect(await repository.get('stale', { principal: editor })).toBeNull();
        expect(await count("SELECT count(*) FROM cms_audit WHERE record_id = 'stale' AND action = 'delete'")).toBe(1);
    });

    it('enforces ownership in queries, updates and search', async () => {
        const repository = cms.resource('app/notes');
        await repository.create({ text: 'alice secret plan' }, { principal: alice, id: 'n-alice' });
        await repository.create({ text: 'bob secret plan' }, { principal: bob, id: 'n-bob' });
        expect((await repository.list({}, { principal: alice })).records.map(record => record.id)).toEqual(['n-alice']);
        expect(await repository.get('n-bob', { principal: alice })).toBeNull();
        await expect(repository.update('n-bob', { text: 'hijack' }, { principal: alice, expectedRevision: 1 })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        expect((await repository.search('secret', {}, { principal: alice })).map(record => record.id)).toEqual(['n-alice']);
        expect((await repository.search('secret', {}, { principal: system })).map(record => record.id).sort()).toEqual(['n-alice', 'n-bob']);
        await expect(repository.list({}, { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
    });

    it('pages with stable cursors and filters on declared fields', async () => {
        const repository = cms.resource('app/articles');
        for (let i = 0; i < 5; i++) await repository.create({ title: `Page ${i}`, status: 'live' }, { principal: alice, id: `page-${i}` });
        const seen: string[] = [];
        let after: string | undefined;
        do {
            const page = await repository.list({ where: { status: 'live' }, limit: 2, ...(after ? { after } : {}) }, { principal: { kind: 'anonymous' } });
            seen.push(...page.records.map(record => record.id));
            after = page.next;
        } while (after);
        expect(seen.sort()).toEqual(['page-0', 'page-1', 'page-2', 'page-3', 'page-4']);
        await expect(repository.list({ where: { internal: 'x' } }, { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('recovers an uncertain create by exact replay without duplicates', async () => {
        let drop = true;
        const db = service.database({
            retry: { attempts: 1 },
            fetch: async (input, init) => {
                const response = await fetch(input, init);
                if (drop && String(input).endsWith('/query') && String(init?.body).includes('uncertain')) { await response.body?.cancel(); throw new TypeError('lost'); }
                return response;
            },
        });
        const flaky = createCMS({ db, resources: [articles, notes] });
        const error = await flaky.resource('app/articles').create({ title: 'Uncertain' }, { principal: alice, id: 'uncertain' }).catch(e => e);
        expect(error).toMatchObject({ code: 'CMS_UNCERTAIN', requestId: expect.any(String) });
        expect(await db.pending.list()).toHaveLength(1);
        drop = false;
        expect((await db.recoverPending()).confirmed).toEqual([error.requestId]);
        expect(await count("SELECT count(*) FROM cms_audit WHERE record_id = 'uncertain'")).toBe(1);
        expect(await flaky.resource('app/articles').get('uncertain', { principal: alice })).toMatchObject({ title: 'Uncertain', rev: 1 });
    });

    it('delivers after-commit events from the outbox and retries only failed plugins', async () => {
        const deliveries: string[] = [];
        let failing = false;
        const outboxHooks = createHookRegistry();
        outboxHooks.addAction(afterCommit, event => { deliveries.push(`search:${event.id}`); }, { plugin: 'search' });
        outboxHooks.addAction(afterCommit, event => {
            deliveries.push(`webhook:${event.id}`);
            if (failing) throw new Error('webhook down');
        }, { plugin: 'webhook' });
        const dispatcher = createCMS({ db: service.database(), resources: [articles, notes], hooks: outboxHooks, outbox: { baseDelayMs: 0 } });
        // Deliver earlier tests' events first.
        for (let round = 0; round < 10; round++) {
            const drained = await dispatcher.outbox.dispatch({ limit: 100 });
            if (!drained.delivered.length && !drained.retrying.length) break;
        }
        expect(await dispatcher.outbox.pending()).toEqual([]);
        deliveries.length = 0;
        failing = true;
        await dispatcher.resource('app/articles').create({ title: 'Event' }, { principal: alice, id: 'event' });
        const first = await dispatcher.outbox.dispatch();
        expect(first.retrying).toEqual([{ id: expect.any(String), plugins: ['webhook'] }]);
        expect(deliveries).toEqual(['search:event', 'webhook:event']);
        failing = false;
        const second = await dispatcher.outbox.dispatch();
        expect(second.delivered).toEqual([first.retrying[0]!.id]);
        expect(deliveries).toEqual(['search:event', 'webhook:event', 'webhook:event']);
    });
});
