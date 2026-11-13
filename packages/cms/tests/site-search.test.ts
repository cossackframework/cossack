import { beforeAll, describe, expect, it } from 'vitest';
import { contentModule, createCMS, DEFAULT_ROLES, SITE_SEARCH, type CmsHost, type Principal } from '../src/server/index';
import type { RomeDB } from '@cossackframework/romedb';
import { romedbService, live } from './helpers';

describe.skipIf(!live)('site search index', () => {
    const service = romedbService();
    let cms: CmsHost;
    let editor: Principal;
    let db: RomeDB;

    /** Run the outbox until nothing is due, rebuild rounds included, within a deadline. */
    async function settle() {
        const deadline = Date.now() + 60_000;
        while ((await cms.outbox.dispatch({ limit: 100 })).delivered.length && Date.now() < deadline) { /* next */ }
        expect((await cms.siteSearch.status()).rebuilding).toBe(false);
    }
    /** Entry content: one heading block with this text. */
    const content = (text: string) => [{ _id: 'h', type: 'core/heading', data: { text } }];
    const found = async (text: string, options: Parameters<CmsHost['siteSearch']['search']>[1] = {}) => (await cms.siteSearch.search(text, options)).hits.map(hit => `${hit.collection}:${hit.id}`);

    beforeAll(async () => {
        db = service.database();
        cms = createCMS({ db, modules: [contentModule] });
        expect((await cms.migrate()).failed).toBeUndefined();
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
        editor = (await cms.users.principal((await cms.users.create({ email: 'editor@example.com', name: 'Editor', roles: ['editor'] })).id))!;
        // Host step 7 queued the first build; on a new site it finds nothing.
        await settle();
        expect((await cms.siteSearch.status()).entries).toBe(0);
    }, 60_000);

    it('holds only what visitors may read, in step with every write', async () => {
        const posts = cms.resource('cms/posts');
        const context = { principal: editor };
        let post = await posts.create({ title: 'Zebra crossing', content: content('Stripes on the road') }, context);
        expect(await found('zebra')).toEqual([]);
        post = await posts.update(post.id, { status: 'published' }, { ...context, expectedRevision: post.rev });
        expect(await found('zebra')).toEqual([`posts:${post.id}`]);
        expect(await found('stripes road')).toEqual([`posts:${post.id}`]);
        post = await posts.update(post.id, { password: 'secret' }, { ...context, expectedRevision: post.rev });
        expect(await found('zebra')).toEqual([]);
        post = await posts.update(post.id, { password: '' }, { ...context, expectedRevision: post.rev });
        expect(await found('zebra')).toEqual([`posts:${post.id}`]);
        post = await posts.update(post.id, { membersOnly: true }, { ...context, expectedRevision: post.rev });
        expect(await found('zebra')).toEqual([]);
        post = await posts.update(post.id, { membersOnly: false, status: 'draft' }, { ...context, expectedRevision: post.rev });
        expect(await found('zebra')).toEqual([]);
        post = await posts.update(post.id, { status: 'published' }, { ...context, expectedRevision: post.rev });
        expect(await found('zebra')).toEqual([`posts:${post.id}`]);
        // A stale revision writes nothing, the index included.
        await expect(posts.update(post.id, { title: 'Quokka' }, { ...context, expectedRevision: post.rev - 1 })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await found('quokka')).toEqual([]);
        await posts.delete(post.id, { ...context, expectedRevision: post.rev });
        expect(await found('zebra')).toEqual([]);
    });

    it('ranks every collection together, titles first, pages, marks snippets and falls back to any word', async () => {
        const context = { principal: editor };
        const page = await cms.resource('cms/pages').create({ title: 'Walrus facts', status: 'published' }, context);
        const posts = [];
        for (let index = 0; index < 23; index++) posts.push(await cms.resource('cms/posts').create({ title: `Walrus note ${index}`, content: content(`The walrus number ${index} lives near ice`), status: 'published' }, context));
        const first = await cms.siteSearch.search('walrus', { perPage: 10 });
        expect(first.hits).toHaveLength(10);
        expect(first.next).toBe(true);
        const third = await cms.siteSearch.search('walrus', { perPage: 10, page: 3 });
        expect(third.hits).toHaveLength(4);
        expect(third.next).toBe(false);
        const all = [...first.hits, ...(await cms.siteSearch.search('walrus', { perPage: 10, page: 2 })).hits, ...third.hits].map(hit => `${hit.collection}:${hit.id}`);
        expect(new Set(all).size).toBe(24);
        expect(all).toContain(`pages:${page.id}`);
        expect(await found('walrus', { collections: ['pages'] })).toEqual([`pages:${page.id}`]);
        // A title match outranks a mention in the text (the index weighs titles 3), and the last word typed is a prefix.
        const mention = await cms.resource('cms/posts').create({ title: 'Ice field', content: content('Snow and wind for miles, then a walrus, then more snow and wind for miles'), status: 'published' }, context);
        const ranked = (await cms.siteSearch.search('walrus', { perPage: 50 })).hits;
        expect(ranked).toHaveLength(25);
        expect(ranked.at(-1)!.id).toBe(mention.id);
        expect((await cms.siteSearch.search('walr', { perPage: 50 })).hits.map(hit => hit.id)).toEqual(ranked.map(hit => hit.id));
        expect((await cms.siteSearch.search('w', { perPage: 50 })).hits).toEqual([]);
        // RomeDB cuts the snippet from the text and marks what matched, a prefix's word included.
        for (const typed of ['ice number', 'ice numb']) {
            const snippet = (await cms.siteSearch.search(typed, { perPage: 1 })).hits[0]!.snippet;
            expect(snippet.filter(part => part.match).map(part => part.text), typed).toEqual(['number', 'ice']);
            expect(snippet.map(part => part.text).join(''), typed).toMatch(/^The walrus number \d+ lives near ice$/);
        }
        expect(ranked.find(hit => hit.id === page.id)!.snippet).toEqual([]);
        const loose = await cms.siteSearch.search('walrus pelican');
        expect(loose.loose).toBe(true);
        expect(loose.hits.length).toBeGreaterThan(0);
        expect((await cms.siteSearch.search('pelican')).hits).toEqual([]);
        // What a visitor types never reaches RomeDB as syntax.
        for (const typed of ['NOT walrus', 'title:walrus', 'walrus^2', '"walrus', 'walrus*', 'AND']) await expect(cms.siteSearch.search(typed)).resolves.toBeDefined();
        expect(await found('-walrus')).toEqual([]);
    });

    it('rebuilds in rounds, and again for a collection whose path changes', async () => {
        const context = { principal: editor };
        for (let index = 0; index < 190; index++) await cms.resource('cms/posts').create({ title: `Heron ${index}`, status: 'published' }, context);
        await settle();
        const before = (await cms.siteSearch.status()).entries;
        expect(before).toBeGreaterThan(210);
        await db.write([{ rql: `DELETE FROM ${SITE_SEARCH.collection}` }]);
        expect((await cms.siteSearch.status()).entries).toBe(0);
        await cms.siteSearch.rebuild();
        await settle();
        expect((await cms.siteSearch.status()).entries).toBe(before);
        const rounds = await db.read([{ rql: 'SELECT count(*) FROM cms_outbox WHERE topic = $topic', params: { $topic: SITE_SEARCH.topic } }]);
        expect(Number(rounds.results[0]!.rows[0]![0])).toBeGreaterThanOrEqual(3);

        const definition = cms.collection('posts');
        await cms.saveCollection({ ...definition, path: null }, { kind: 'system', reason: 'test' });
        await settle();
        expect(await found('heron')).toEqual([]);
        expect((await found('walrus')).every(hit => hit.startsWith('pages:'))).toBe(true);
        await cms.saveCollection({ ...cms.collection('posts'), path: 'posts' }, { kind: 'system', reason: 'test' });
        await settle();
        expect((await cms.siteSearch.search('heron', { perPage: 50 })).hits).toHaveLength(50);
    }, 120_000);
});
