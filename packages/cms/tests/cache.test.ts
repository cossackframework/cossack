import { beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@cossackframework/core/hooks';
import { cachePurge, contentModule, createCMS, PurgeError, type CachePurgeEvent, type CachePurger, type CmsHost, type Principal } from '../src/server/index';
import { romedbService, live } from './helpers';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };

describe.skipIf(!live)('cache purges', () => {
    const service = romedbService();
    const received: CachePurgeEvent[] = [];
    const seenByPlugin: string[] = [];
    let failure: 'retry' | 'refuse' | null = null;
    const purger: CachePurger = {
        name: 'fake',
        async purge(event) {
            if (failure === 'retry') throw new Error('down');
            if (failure === 'refuse') throw new PurgeError('bad token', { retry: false, status: 403 });
            received.push(event);
        },
    };
    let cms: CmsHost;

    beforeAll(async () => {
        const hooks = createHookRegistry();
        cms = createCMS({ db: service.database(), modules: [contentModule], hooks, siteUrl: 'https://cache.example', purgers: [purger] });
        // A plugin's handler for another CDN sees the same events.
        hooks.addAction(cachePurge, event => { seenByPlugin.push(event.reason); }, { plugin: 'acme' });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
    });

    const dispatch = () => cms.outbox.dispatch({ limit: 100 });
    const last = () => received.at(-1)!;

    it('is configured by its purgers and tags the site', () => {
        expect(cms.purge.configured).toBe(true);
        expect(cms.purge.purgers.map(entry => entry.name)).toEqual(['fake']);
        expect(cms.purge.tag.site()).toBe('cms:main');
        expect(cms.purge.tag.entry('posts', 'p1')).toBe('cms:main:e:posts:p1');
    });

    it('purges a published entry\'s page and the lists of its collection, with its addresses; a draft purges nothing', async () => {
        const posts = cms.resource('cms/posts');
        await posts.create({ title: 'Just a draft' }, { principal: admin });
        await dispatch();
        expect(received).toEqual([]);
        const post = await posts.create({ title: 'Cached', status: 'published' }, { principal: admin });
        await dispatch();
        expect(last()).toMatchObject({ topic: 'cache.purge', site: 'main', reason: 'entry:posts', tags: [`cms:main:e:posts:${post.id}`, 'cms:main:c:posts'] });
        expect(last().urls).toEqual(['https://cache.example/posts/cached', 'https://cache.example/posts/cached?format=md']);
        expect(seenByPlugin).toContain('entry:posts');
        received.length = 0;
        await posts.update(post.id, { status: 'draft' }, { principal: admin, expectedRevision: post.rev });
        await dispatch();
        expect(last().tags).toEqual([`cms:main:e:posts:${post.id}`, 'cms:main:c:posts']);
    });

    it('purges every page after a setting, a menu, a redirect or a term changes', async () => {
        received.length = 0;
        await cms.settings.update('general', { siteTitle: 'Cached site' }, { principal: admin });
        await dispatch();
        expect(last()).toMatchObject({ reason: 'settings', tags: ['cms:main'], urls: [] });
        await cms.menus.create({ name: 'Cache menu', items: [] }, { principal: admin });
        await dispatch();
        expect(last().reason).toBe('menus');
        await cms.redirects.save({ source: '/old-cache', target: '/new-cache' });
        await dispatch();
        expect(last().reason).toBe('redirects');
        await cms.taxonomies.create('categories', { name: 'Cache' }, { principal: admin });
        await dispatch();
        expect(last().reason).toBe('terms');
    });

    it('purges every page when a menu names the entry, and an entry\'s page when its comments change', async () => {
        const pages = cms.resource('cms/pages');
        const about = await pages.create({ title: 'About cache', status: 'published' }, { principal: admin });
        await cms.menus.create({ name: 'Main cache', items: [{ id: 'about', kind: 'entry', label: '', collection: 'pages', entry: about.id, children: [] }] }, { principal: admin });
        await dispatch();
        received.length = 0;
        await pages.update(about.id, { title: 'About caches' }, { principal: admin, expectedRevision: about.rev });
        await dispatch();
        expect(last()).toMatchObject({ reason: 'entry:pages', tags: ['cms:main'] });
        received.length = 0;
        const comment = await cms.comments.create({ id: 'cache-comment-1', resource: 'cms/pages', recordId: about.id, parentId: null, userId: null, authorName: 'Ada', authorEmail: 'ada@example.com', authorUrl: '', content: 'Fresh', status: 'pending', ipHash: null, userAgent: null });
        await dispatch();
        expect(received).toEqual([]);
        await cms.comments.setStatus([comment.id], 'approved');
        await dispatch();
        expect(last()).toMatchObject({ reason: 'comments', tags: [`cms:main:e:pages:${about.id}`] });
    });

    it('queues what the Cache tool asks, records each purger\'s result, retries a failure and drops a refusal', async () => {
        received.length = 0;
        const narrow = await cms.purge.queue('manual', { tags: ['cms:main:c:posts'], urls: ['https://cache.example/', 'not a url'] });
        expect(narrow.tags).toEqual(['cms:main:c:posts']);
        expect(narrow.urls).toEqual(['https://cache.example/']);
        await dispatch();
        expect(last()).toMatchObject({ eventId: narrow.eventId, reason: 'manual' });
        expect(cms.purge.recent[0]).toMatchObject({ eventId: narrow.eventId, purger: 'fake', ok: true, message: '' });

        failure = 'retry';
        const down = await cms.purge.everything('manual');
        const report = await dispatch();
        expect(report.retrying).toEqual([{ id: down.eventId, plugins: ['cms-purge-fake'] }]);
        expect(cms.purge.recent[0]).toMatchObject({ eventId: down.eventId, ok: false, message: 'down Retrying.' });

        failure = 'refuse';
        const refused = await cms.purge.queue('manual', { tags: ['cms:main:c:pages'] });
        const second = await dispatch();
        expect(second.delivered).toContain(refused.eventId);
        expect(cms.purge.recent[0]).toMatchObject({ eventId: refused.eventId, ok: false, message: 'bad token' });
        failure = null;
    });
});
