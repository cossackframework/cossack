import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, systemPrincipal, type CmsHost } from '../src/server/index';
import { live, romedbService } from './helpers';

const admin = systemPrincipal('tools tests');

describe.skipIf(!live)('audit trail and the outbox admin', () => {
    const service = romedbService();
    let clock = Date.parse('2026-11-07T09:00:00Z');
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('lists writes newest first with their facets, and prunes old rows', async () => {
        const posts = cms.resource('cms/posts');
        const first = await posts.create({ title: 'First', status: 'draft' }, { principal: admin });
        clock += 1_000;
        await posts.update(first.id, { title: 'First, edited' }, { principal: admin, expectedRevision: first.rev });
        clock += 1_000;
        const page = await cms.audit.list({ limit: 10 });
        expect(page.total).toBeGreaterThanOrEqual(2);
        expect(page.items[0]).toMatchObject({ actor: 'system:tools tests', action: 'update', resource: 'cms/posts', recordId: first.id, revision: 2 });
        expect(page.items[1]).toMatchObject({ action: 'create', recordId: first.id });
        expect((await cms.audit.list({ action: 'create' })).items.every(entry => entry.action === 'create')).toBe(true);
        const facets = await cms.audit.facets();
        expect(facets.actions).toEqual(expect.arrayContaining(['create', 'update']));
        expect(facets.resources).toContain('cms/posts');
        clock += 400 * 24 * 60 * 60_000;
        await cms.audit.prune();
        expect((await cms.audit.list()).total).toBe(0);
    });

    it('retries and drops waiting events', async () => {
        const at = clock;
        expect(await cms.outbox.enqueue('cache.purge', { eventId: 'later-1', at, topic: 'cache.purge', site: 'main', reason: 'test', tags: [], urls: [] } as never, { availableAt: at + 60 * 60_000 })).toBe(true);
        expect((await cms.outbox.pending()).map(row => row.id)).toContain('later-1');
        expect((await cms.outbox.dispatch()).delivered).not.toContain('later-1');
        expect(await cms.outbox.retry('later-1')).toBe(true);
        expect((await cms.outbox.dispatch()).delivered).toContain('later-1');
        expect(await cms.outbox.retry('later-1')).toBe(false);
        expect(await cms.outbox.enqueue('cache.purge', { eventId: 'later-2', at, topic: 'cache.purge', site: 'main', reason: 'test', tags: [], urls: [] } as never, { availableAt: at + 60 * 60_000 })).toBe(true);
        expect(await cms.outbox.remove('later-2')).toBe(true);
        expect((await cms.outbox.pending()).map(row => row.id)).not.toContain('later-2');
        expect(await cms.outbox.deadLettered()).toEqual([]);
    });
});
