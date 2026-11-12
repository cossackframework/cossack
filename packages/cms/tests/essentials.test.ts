import { beforeAll, describe, expect, it } from 'vitest';
import type { StorageProvider } from '@cossackframework/core/storage';
import { totpCode, totpStep } from '@cossackframework/auth';
import {
    ANONYMOUS, contentModule, createCMS, DEFAULT_ROLES, field, imageSrcset, MAX_FILE_VARIANTS, posts, verifyWebhookSignature,
    type CmsHost, type CmsModule, type ImageTransformer, type Principal,
} from '../src/server/index';
import { romedbService, live } from './helpers';
import { RecordId } from '@cossackframework/romedb';

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };

function memoryStorage(): StorageProvider & { objects: Map<string, Uint8Array> } {
    const objects = new Map<string, Uint8Array>();
    return {
        name: 'memory', objects,
        async put(key, body, options) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); return { key, size: options.size }; },
        async get(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! } : null; },
        async head(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length } : null; },
        async delete(key) { objects.delete(key); },
    };
}

/** A PNG header of the given size: enough for the signature check, the dimensions and the color type (truecolor, or with an alpha channel). */
function png(width: number, height: number, options: { alpha?: boolean } = {}): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0, 8, options.alpha ? 6 : 2, 0, 0, 0]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
}

describe.skipIf(!live)('scheduling, previews, revisions, redirects, tokens, webhooks, comments, languages and sign-in', () => {
    const service = romedbService();
    const storage = memoryStorage();
    const transforms: { width: number; height: number; format: string; rect: { x: number; y: number; width: number; height: number } }[] = [];
    const images: ImageTransformer = {
        async transform(input, request) {
            await new Response(input).arrayBuffer();
            transforms.push({ width: request.width, height: request.height, format: request.format, rect: request.rect });
            return new TextEncoder().encode(`${request.format}:${request.width}x${request.height}`);
        },
    };
    const sent: { url: string; headers: Headers; body: string }[] = [];
    let answer = 200;
    let clock = Date.UTC(2026, 9, 17, 9, 0);
    let cms: CmsHost;
    let editor: Principal;
    let author: Principal;
    let other: Principal;
    let authorId: string;

    beforeAll(async () => {
        cms = createCMS({
            db: service.database(), modules: [contentModule], storage, images, now: () => clock, siteUrl: 'https://essentials.example',
            fetch: async (input, init) => {
                sent.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
                return new Response('ok', { status: answer });
            },
        });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        for (const role of DEFAULT_ROLES) await cms.users.defineRole({ ...role, permissions: [...role.permissions] });
        const principal = async (email: string, role: string) => (await cms.users.principal((await cms.users.create({ email, name: email.split('@')[0]!, roles: [role] })).id))!;
        editor = await principal('editor@example.com', 'editor');
        author = await principal('author@example.com', 'author');
        other = await principal('other@example.com', 'author');
        authorId = author.kind === 'user' ? author.id : '';
    }, 30_000);

    it('keeps the field order of built-in collections and adds new fields last', async () => {
        const current = cms.collection('posts');
        clock += 1000;
        await cms.saveCollection({ ...current, fields: { ...current.fields, subtitle: field.string({ label: 'Subtitle' }) } }, admin);
        expect(Object.keys(cms.collection('posts').fields)).toEqual(['sticky', 'subtitle']);
        const reordered = ['subtitle', 'sticky'];
        await cms.saveCollection({ ...cms.collection('posts'), fields: Object.fromEntries(reordered.map(name => [name, cms.collection('posts').fields[name]!])) }, admin);
        expect(Object.keys(cms.collection('posts').fields)).toEqual(reordered);
        expect(Object.keys(cms.resourceById('cms/posts').fields).filter(name => reordered.includes(name))).toEqual(reordered);
        const other = createCMS({ db: service.database(), modules: [contentModule] });
        await other.ready();
        expect(Object.keys(other.collection('posts').fields)).toEqual(reordered);
        // Ledger IDs include the time; the clock stands still in this suite.
        clock += 1000;
        await cms.saveCollection({ ...posts, fields: { ...posts.fields } }, admin);
    });

    it('schedules entries with a future time and publishes them when it comes', async () => {
        const repository = cms.resource('cms/posts');
        const later = clock + 60 * 60_000;
        const post = await repository.create({ title: 'Launch', status: 'published', publishedAt: later }, { principal: author });
        expect(post).toMatchObject({ status: 'scheduled', publishedAt: later });
        expect(await repository.get(post.id, { principal: ANONYMOUS })).toBeNull();
        expect(await cms.runSchedule()).toEqual({ published: 0, unpublished: 0 });
        const now = await repository.create({ title: 'Now', status: 'scheduled' }, { principal: author });
        expect(now).toMatchObject({ status: 'published', publishedAt: clock });
        clock = later + 1;
        expect(await cms.runSchedule()).toEqual({ published: 1, unpublished: 0 });
        expect(await repository.get(post.id, { principal: ANONYMOUS })).toMatchObject({ status: 'published', rev: 2 });
        const pending = await repository.create({ title: 'Review me', status: 'pending' }, { principal: author });
        expect(pending.status).toBe('pending');
    });

    it('takes published entries back to draft at their unpublish time', async () => {
        const repository = cms.resource('cms/posts');
        const until = clock + 30 * 60_000;
        const offer = await repository.create({ title: 'Spring offer', status: 'published', unpublishAt: until }, { principal: author });
        expect(offer).toMatchObject({ status: 'published', unpublishAt: until });
        await expect(repository.update(offer.id, { unpublishAt: clock - 1 }, { principal: author, expectedRevision: offer.rev })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { unpublishAt: expect.any(String) } });
        await expect(repository.create({ title: 'Backwards', status: 'published', publishedAt: clock + 10_000, unpublishAt: clock + 5_000 }, { principal: author })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await cms.runSchedule()).toEqual({ published: 0, unpublished: 0 });
        clock = until;
        expect(await cms.runSchedule()).toEqual({ published: 0, unpublished: 1 });
        expect(await repository.get(offer.id, { principal: ANONYMOUS })).toBeNull();
        expect(await repository.get(offer.id, { principal: author })).toMatchObject({ status: 'draft', unpublishAt: null });
    });

    it('shares previews of drafts through revocable links', async () => {
        const draft = await cms.resource('cms/posts').create({ title: 'Secret draft' }, { principal: author });
        await expect(cms.createPreviewLink('cms/posts', draft.id, other)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        const link = await cms.createPreviewLink('cms/posts', draft.id, author);
        expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(await cms.previewByToken(link.token)).toMatchObject({ record: { id: draft.id, status: 'draft' } });
        expect(await cms.previewByToken(`${link.token.slice(0, -1)}x`)).toBeNull();
        expect(await cms.previews.count('cms/posts', draft.id)).toBe(1);
        await cms.revokePreviewLinks('cms/posts', draft.id, editor);
        expect(await cms.previewByToken(link.token)).toBeNull();
        const expiring = await cms.createPreviewLink('cms/posts', draft.id, author, 1000);
        clock += 2000;
        expect(await cms.previewByToken(expiring.token)).toBeNull();
    });

    it('keeps autosaves per user and entry', async () => {
        const draft = await cms.resource('cms/posts').create({ title: 'Autosaved' }, { principal: author });
        await cms.autosave('cms/posts', draft.id, author, { title: 'Autosaved, longer' });
        await cms.autosave('cms/posts', 'new', author, { title: 'Not saved yet' });
        expect(await cms.latestAutosave('cms/posts', draft.id, author)).toMatchObject({ data: { title: 'Autosaved, longer' }, at: clock });
        expect(await cms.latestAutosave('cms/posts', draft.id, editor)).toBeNull();
        expect(await cms.latestAutosave('cms/posts', 'new', author)).toMatchObject({ data: { title: 'Not saved yet' } });
        await expect(cms.autosave('cms/posts', draft.id, other, {})).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await expect(cms.autosave('cms/posts', draft.id, ANONYMOUS, {})).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        await cms.discardAutosave('cms/posts', draft.id, author);
        expect(await cms.latestAutosave('cms/posts', draft.id, author)).toBeNull();
    });

    it('restores a revision without unpublishing or moving the entry', async () => {
        const repository = cms.resource('cms/posts');
        const created = await repository.create({ title: 'First title', excerpt: 'First excerpt', status: 'published' }, { principal: author });
        const edited = await repository.update(created.id, { title: 'Second title', excerpt: 'Second excerpt', slug: 'second-title' }, { principal: author, expectedRevision: 1 });
        expect((await repository.revision(created.id, 1, { principal: author }))?.data).toMatchObject({ title: 'First title' });
        const restored = await repository.restore(created.id, 1, { principal: author, expectedRevision: edited.rev });
        expect(restored).toMatchObject({ title: 'First title', excerpt: 'First excerpt', slug: 'second-title', status: 'published', rev: 3 });
        await expect(repository.restore(created.id, 99, { principal: author, expectedRevision: 3 })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
    });

    it('redirects old URLs of published entries, collections and terms', async () => {
        const repository = cms.resource('cms/posts');
        const post = await repository.create({ title: 'Moving post', status: 'published' }, { principal: editor });
        const moved = await repository.update(post.id, { slug: 'moved-post' }, { principal: editor, expectedRevision: 1 });
        expect(await cms.redirects.match('/posts/moving-post')).toMatchObject({ location: '/posts/moved-post', redirect: { status: 301, kind: 'auto' } });
        const again = await repository.update(post.id, { slug: 'moved-again' }, { principal: editor, expectedRevision: moved.rev });
        // Older redirects follow, so there are no chains.
        expect(await cms.redirects.match('/posts/moving-post')).toMatchObject({ location: '/posts/moved-again' });
        await repository.update(post.id, { slug: 'moving-post' }, { principal: editor, expectedRevision: again.rev });
        expect(await cms.redirects.match('/posts/moving-post')).toBeNull();
        expect(await cms.redirects.match('/posts/moved-post')).toMatchObject({ location: '/posts/moving-post' });
        // Drafts have no public URL to keep.
        const draft = await repository.create({ title: 'Quiet draft' }, { principal: editor });
        await repository.update(draft.id, { slug: 'quiet-renamed' }, { principal: editor, expectedRevision: 1 });
        expect(await cms.redirects.match('/posts/quiet-draft')).toBeNull();

        clock += 1000;
        await cms.saveCollection({ ...cms.collection('posts'), path: 'blog' }, admin);
        // The redirects follow from the outbox job the save queued with the new path.
        expect(await cms.redirects.match('/posts/anything/else')).toBeNull();
        await cms.outbox.dispatch({ limit: 100 });
        expect(await cms.redirects.match('/posts/moving-post')).toMatchObject({ location: '/blog/moving-post' });
        expect(await cms.redirects.match('/posts/anything/else')).toMatchObject({ location: '/blog/anything/else' });
        expect(await cms.redirects.match('/posts')).toMatchObject({ location: '/blog' });
        clock += 1000;
        await cms.saveCollection({ ...cms.collection('posts'), path: 'posts' }, admin);
        await cms.outbox.dispatch({ limit: 100 });
        // Two moves before either job runs: both old paths reach the latest one.
        clock += 1000;
        await cms.saveCollection({ ...cms.collection('posts'), path: 'journal' }, admin);
        clock += 1000;
        await cms.saveCollection({ ...cms.collection('posts'), path: 'diary' }, admin);
        await cms.outbox.dispatch({ limit: 100 });
        expect(await cms.redirects.match('/posts/moving-post')).toMatchObject({ location: '/diary/moving-post' });
        expect(await cms.redirects.match('/journal/moving-post')).toMatchObject({ location: '/diary/moving-post' });
        clock += 1000;
        await cms.saveCollection({ ...cms.collection('posts'), path: 'posts' }, admin);
        await cms.outbox.dispatch({ limit: 100 });
        expect(await cms.redirects.match('/posts/moving-post')).toBeNull();

        // Category permalinks: the first category's slug before the post name; a change of category redirects.
        const [sports, culture] = (await Promise.all([cms.taxonomies.create('categories', { name: 'Sports' }, { principal: editor }), cms.taxonomies.create('categories', { name: 'Culture' }, { principal: editor })])).map(term => term.id);
        await expect(cms.saveCollection({ ...cms.collection('pages'), permalink: 'category' }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.saveCollection({ ...cms.collection('posts'), permalink: 'category' }, admin);
        const filed = await repository.update(post.id, { categories: [sports!] }, { principal: editor, expectedRevision: (await repository.get(post.id, { principal: editor }))!.rev });
        expect((await cms.entryUrls(cms.collection('posts'), [filed])).get(post.id)).toBe('/posts/sports/moving-post');
        expect(await cms.redirects.match('/posts/moving-post')).toMatchObject({ location: '/posts/sports/moving-post' });
        await repository.update(post.id, { categories: [culture!, sports!] }, { principal: editor, expectedRevision: filed.rev });
        expect(await cms.redirects.match('/posts/sports/moving-post')).toMatchObject({ location: '/posts/culture/moving-post' });
        expect((await cms.sitemapEntries('posts')).map(entry => entry.url)).toContain('/posts/culture/moving-post');
        clock += 1000;
        await cms.saveCollection({ ...cms.collection('posts'), permalink: 'slug' }, admin);

        const [news] = await cms.taxonomies.ensure('tags', ['Old news'], { principal: editor });
        await cms.taxonomies.update(news!, { slug: 'news' }, { principal: editor });
        expect(await cms.redirects.match('/tag/old-news')).toMatchObject({ location: '/tag/news' });
        // A taxonomy that moves keeps its term archives answering at the old path.
        clock += 1000;
        await cms.saveTaxonomy({ ...cms.taxonomies.declaration('tags'), path: 'topic' }, admin);
        await cms.outbox.dispatch({ limit: 100 });
        expect(await cms.redirects.match('/tag/news')).toMatchObject({ location: '/topic/news' });
        await cms.saveTaxonomy({ ...cms.taxonomies.declaration('tags'), path: 'tag' }, admin);
        await cms.outbox.dispatch({ limit: 100 });
        // Moving back serves the old path again, with no redirect loop between the two.
        expect(await cms.redirects.match('/tag/missing-term')).toBeNull();
        expect(await cms.redirects.match('/topic/news')).toMatchObject({ location: '/tag/news' });

        await expect(cms.redirects.save({ source: 'nope', target: '/x' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.redirects.save({ source: '/a', target: '/a' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const gone = await cms.redirects.save({ source: '/retired', target: '', status: 410, note: 'Old campaign' });
        expect(await cms.redirects.match('/retired/')).toMatchObject({ location: null, redirect: { id: gone.id, status: 410 } });
        await expect(cms.redirects.save({ source: '/retired', target: '/x' })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        const external = await cms.redirects.save({ source: '/shop/*', target: 'https://shop.example.com/*', status: 302 });
        expect(await cms.redirects.match('/shop/boots')).toMatchObject({ location: 'https://shop.example.com/boots' });
        // A prefix moved to the root never builds a protocol-relative location from the rest.
        await cms.redirects.save({ source: '/moved/*', target: '/*' });
        expect(await cms.redirects.match('/moved/about')).toMatchObject({ location: '/about' });
        expect(await cms.redirects.match('/moved//evil.example')).toMatchObject({ location: '/evil.example' });
        expect(await cms.redirects.match('/moved/\\evil.example')).toMatchObject({ location: '/evil.example' });
        await cms.redirects.hit(external.id);
        expect(await cms.redirects.get(external.id)).toMatchObject({ hits: 1, lastHitAt: clock });
        expect((await cms.redirects.list({ search: 'campaign' })).items.map(item => item.source)).toEqual(['/retired']);
    });

    it('authenticates application passwords and keeps read-only ones read-only', async () => {
        const { token, record } = await cms.apiTokens.create(authorId, { name: 'Mobile app', scope: 'read' });
        expect(token).toMatch(/^cms_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
        expect(await cms.tokenPrincipal(token)).toMatchObject({ scope: 'read', userId: authorId, principal: { kind: 'user', id: authorId } });
        expect(await cms.tokenPrincipal(token.replace(/.$/, character => character === 'A' ? 'B' : 'A'))).toBeNull();
        expect((await cms.apiTokens.list(authorId))[0]).toMatchObject({ id: record.id, name: 'Mobile app', lastUsedAt: clock });
        await expect(cms.apiTokens.revoke('someone-else', record.id)).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await cms.apiTokens.revoke(authorId, record.id);
        expect(await cms.tokenPrincipal(token)).toBeNull();
        await expect(cms.apiTokens.create(authorId, { name: 'Expired', expiresAt: clock - 1 })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('signs webhook deliveries and retries failures', async () => {
        await expect(cms.webhooks.save({ name: 'Plain', url: 'http://example.com/hook', events: ['entry.published'] })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const hook = await cms.webhooks.save({ name: 'Rebuild', url: 'https://build.example.com/hook', events: ['entry.published', 'entry.deleted'], collections: ['posts'] }, { collections: cms.collections().map(entry => entry.name) });
        expect(hook.secret).toMatch(/^whsec_/);
        // The listing tells webhooks apart without any of the secret's characters.
        expect((await cms.webhooks.list()).find(entry => entry.id === hook.id)?.secretHint).toBe('whsec_');
        await cms.outbox.dispatch({ limit: 100 });
        await cms.webhooks.dispatch({ limit: 50 });
        sent.length = 0;
        const repository = cms.resource('cms/posts');
        const post = await repository.create({ title: 'Hook me' }, { principal: editor });
        await repository.update(post.id, { status: 'published' }, { principal: editor, expectedRevision: 1 });
        await cms.resource('cms/pages').create({ title: 'Not a post', status: 'published' }, { principal: editor });
        await cms.outbox.dispatch({ limit: 100 });
        expect(await cms.webhooks.dispatch()).toEqual({ delivered: 1, failed: 0, retrying: 0 });
        expect(sent).toHaveLength(1);
        const delivery = sent[0]!;
        expect(JSON.parse(delivery.body)).toMatchObject({ event: 'entry.published', collection: 'posts', previousStatus: 'draft', entry: { id: post.id, title: 'Hook me', url: '/posts/hook-me' } });
        expect(delivery.headers.get('x-cossack-event')).toBe('entry.published');
        // The secret comes with the new webhook, and again only by asking for it; lists leave it out.
        expect(JSON.stringify(await cms.webhooks.list())).not.toContain(hook.secret!);
        expect(await cms.webhooks.secret(hook.id)).toBe(hook.secret);
        expect(await verifyWebhookSignature(hook.secret!, delivery.headers.get('x-cossack-timestamp')!, delivery.body, delivery.headers.get('x-cossack-signature')!)).toBe(true);
        expect(await verifyWebhookSignature(hook.secret!, delivery.headers.get('x-cossack-timestamp')!, `${delivery.body} `, delivery.headers.get('x-cossack-signature')!)).toBe(false);

        answer = 500;
        await repository.delete(post.id, { principal: editor, expectedRevision: 2 });
        await cms.outbox.dispatch({ limit: 100 });
        expect(await cms.webhooks.dispatch()).toEqual({ delivered: 0, failed: 0, retrying: 1 });
        expect(await cms.webhooks.dispatch()).toEqual({ delivered: 0, failed: 0, retrying: 0 });
        answer = 200;
        clock += 61_000;
        expect(await cms.webhooks.dispatch()).toEqual({ delivered: 1, failed: 0, retrying: 0 });
        const deliveries = await cms.webhooks.deliveries(hook.id);
        expect(deliveries.find(entry => entry.event === 'entry.deleted')).toMatchObject({ status: 'delivered', attempts: 2, responseStatus: 200 });
        expect(await cms.webhooks.ping(hook.id)).toEqual({ ok: true, status: 200, error: null });
    });

    it('moderates comments by the Discussion settings', async () => {
        const repository = cms.resource('cms/posts');
        const post = await repository.create({ title: 'Discuss', status: 'published' }, { principal: editor });
        expect(post.commentsOpen).toBe(true);
        let address = 0;
        // Each comment a second later, from its own address unless one is given.
        const comment = (input: Record<string, string>, ip = `10.0.1.${++address}`) => {
            clock += 1000;
            return cms.postComment({ collection: 'posts', entry: post.id, authorName: 'Ann', authorEmail: 'ann@example.com', content: 'Nice post', ...input }, { principal: ANONYMOUS, ip });
        };
        const first = await comment({});
        expect(first.comment).toMatchObject({ status: 'pending', authorEmail: 'ann@example.com' });
        await expect(comment({}, '10.0.0.1').then(() => comment({}, '10.0.0.1'))).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        await cms.moderateComments([first.comment.id], 'approved', editor);
        await expect(cms.moderateComments([first.comment.id], 'spam', author)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        // An anonymous commenter only claims an email, so returning under it is still held; links and blocked words are held or spam.
        expect((await comment({ content: 'Again' })).comment.status).toBe('pending');
        expect((await comment({ content: 'See https://a.example and https://b.example' })).comment.status).toBe('pending');
        await cms.settings.update('discussion', { blockedWords: 'casino' }, { principal: admin });
        expect((await comment({ content: 'Best CASINO deals' })).comment.status).toBe('spam');
        expect((await comment({ trap: 'filled' })).comment.status).toBe('spam');
        const reply = await comment({ parent: first.comment.id, content: 'A reply' });
        expect(reply.comment.parentId).toBe(first.comment.id);
        await expect(comment({ authorName: '', authorEmail: '' })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { authorName: expect.any(String), authorEmail: expect.any(String) } });
        clock += 1000;
        expect((await cms.postComment({ collection: 'posts', entry: post.id, content: 'From the editor' }, { principal: editor })).comment).toMatchObject({ status: 'approved', authorName: 'editor' });
        expect((await cms.comments.forEntry('cms/posts', post.id)).map(entry => entry.content)).toEqual(['Nice post', 'From the editor']);
        expect((await cms.comments.approvedCounts('cms/posts', [post.id])).get(post.id)).toBe(2);
        expect(await cms.comments.counts()).toEqual({ pending: 4, approved: 2, spam: 2, trash: 0 });

        await repository.update(post.id, { commentsOpen: false }, { principal: editor, expectedRevision: post.rev });
        await expect(comment({})).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.postComment({ collection: 'pages', entry: post.id, content: 'x' }, { principal: ANONYMOUS })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await cms.settings.update('discussion', { defaultOpen: false }, { principal: admin });
        expect((await repository.create({ title: 'Closed by default' }, { principal: editor })).commentsOpen).toBe(false);
        await cms.settings.update('discussion', { defaultOpen: true, blockedWords: '' }, { principal: admin });
        // Deleting the entry takes its comments along, once the outbox runs.
        const closed = (await repository.get(post.id, { principal: editor }))!;
        await repository.delete(post.id, { principal: editor, expectedRevision: closed.rev });
        await cms.outbox.dispatch({ limit: 100 });
        expect(await cms.comments.list({ resource: 'cms/posts', recordId: post.id, status: 'spam' })).toMatchObject({ items: [] });
        expect(await cms.comments.forEntry('cms/posts', post.id)).toEqual([]);
        expect((await cms.db.read([{ rql: 'SELECT count(*) FROM cms_comments WHERE record_id = $id', params: { $id: post.id } }])).results[0]!.rows[0]![0]).toBe(0n);
    });

    it('copies fields that are the same in every language to the translations', async () => {
        clock += 1000;
        await cms.saveCollection({ name: 'products', label: 'Products', singular: 'Product', icon: 'box', path: 'products', features: {},
            fields: { price: field.integer({ nullable: true, translatable: false, label: 'Price' }), tagline: field.string({ nullable: true, label: 'Tagline' }) } }, admin);
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.saveLanguages({ default: 'en', others: ['fr'] }, admin);
        const maker = (id: string): Principal => ({ kind: 'user', id, roles: [], permissions: ['cms/products:create', 'cms/products:read'] });
        const [ann, bob] = [maker('ann'), maker('bob')];
        const products = cms.resource('cms/products');
        const widget = await products.create({ title: 'Widget', price: 10, tagline: 'Handy' }, { principal: ann });
        const french = await cms.translateEntry('products', widget.id, 'fr', ann);
        expect(french).toMatchObject({ price: 10, tagline: 'Handy' });
        // Saving either copies the price to the other and moves the other's revision on.
        const cheaper = await products.update(french.id, { price: 12, tagline: 'Pratique' }, { principal: ann, expectedRevision: french.rev });
        expect(await products.get(widget.id, { principal: ann })).toMatchObject({ price: 12, tagline: 'Handy', rev: widget.rev + 1 });
        // The other translation's change is audited and announced like any update of it, from an
        // outbox job queued in the update.
        const queued = await cms.db.read([{ rql: "SELECT count() FROM cms_audit WHERE record_id = $key AND action = 'update'", params: { $key: widget.id } }]);
        expect(Number(queued.results[0]!.rows[0]![0])).toBe(0);
        await cms.outbox.dispatch({ limit: 100 });
        const rows = await cms.db.read([
            { rql: "SELECT revision, actor FROM cms_audit WHERE record_id = $key AND action = 'update'", params: { $key: widget.id } },
            { rql: "SELECT payload FROM cms_outbox WHERE topic = 'resource.updated'" },
        ]);
        expect(rows.results[0]!.rows.map(row => [Number(row[0]), row[1]])).toEqual([[widget.rev + 1, 'ann']]);
        const announced = rows.results[1]!.rows.map(row => JSON.parse(row[0] as string)).filter(event => event.id === widget.id);
        expect(announced).toEqual([expect.objectContaining({ revision: widget.rev + 1, record: expect.objectContaining({ price: 12, tagline: 'Handy' }) })]);
        await expect(products.update(widget.id, { title: 'Stale' }, { principal: ann, expectedRevision: widget.rev })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        // An unchanged value copies nothing.
        await products.update(french.id, { title: 'Bidule', price: 12 }, { principal: ann, expectedRevision: cheaper.rev });
        expect((await products.get(widget.id, { principal: ann }))!.rev).toBe(widget.rev + 1);
        // Bob owns a translation of an entry Ann owns: neither can change the shared price alone.
        const gadget = await products.create({ title: 'Gadget', price: 5 }, { principal: ann });
        const theirs = await products.create({ title: 'Gadget FR', price: 5, locale: 'fr' }, { principal: bob });
        await cms.db.write([{ rql: `UPDATE ${cms.resourceById('cms/products').storage} SET "translationGroup" = $group WHERE id = type::record('${cms.resourceById('cms/products').storage}', $key)`, params: { $group: gadget.id, $key: theirs.id } }]);
        await expect(products.update(gadget.id, { price: 6 }, { principal: ann, expectedRevision: gadget.rev })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN', fields: { price: expect.any(String) } });
        expect(await products.update(gadget.id, { title: 'Gadget 2' }, { principal: ann, expectedRevision: gadget.rev })).toMatchObject({ title: 'Gadget 2', price: 5 });
        expect((await products.get(theirs.id, { principal: bob }))!.price).toBe(5);
        expect(await products.updatable([gadget.id, theirs.id], { principal: bob })).toEqual(new Set([theirs.id]));
        // More translations than one check covers: the shared field is refused, not half copied.
        const crowded = await products.create({ title: 'Crowded', price: 1 }, { principal: admin });
        const storage = cms.resourceById('cms/products').storage;
        for (let start = 0; start < 101; start += 25) {
            await cms.db.write(Array.from({ length: Math.min(25, 101 - start) }, (_, i) => ({
                rql: `INSERT INTO ${storage} DOCUMENT $document`,
                params: { $document: { id: new RecordId(storage, `crowd-${start + i}`), title: `Crowd ${start + i}`, price: 1, locale: 'fr', translationGroup: crowded.id, _rev: 1, _op: `crowd-${start + i}`, _createdAt: clock, _updatedAt: clock, _owner: null } },
            })));
        }
        await expect(products.update(crowded.id, { price: 2 }, { principal: admin, expectedRevision: crowded.rev })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        expect((await products.get('crowd-100', { principal: admin }))!.price).toBe(1);
        await cms.saveLanguages({ default: 'en', others: [] }, admin);
    });

    it('copies a shared field to many long translations within the request limits, and refuses an entry too large to save', async () => {
        clock += 1000;
        await cms.saveCollection({ name: 'gizmos', label: 'Gizmos', singular: 'Gizmo', icon: 'box', path: 'gizmos', features: {},
            fields: { price: field.integer({ nullable: true, translatable: false, label: 'Price' }), notes: field.text({ nullable: true, label: 'Notes' }) } }, admin);
        expect((await cms.migrate()).failed).toBeUndefined();
        const languages = ['fr', 'de', 'es', 'it', 'nl', 'pt', 'pl', 'sv'];
        await cms.saveLanguages({ default: 'en', others: languages }, admin);
        const gizmos = cms.resource('cms/gizmos');
        const notes = 'A long note about the gizmo. '.repeat(250);
        const gizmo = await gizmos.create({ title: 'Gizmo', price: 10, notes }, { principal: admin });
        const translations = [];
        for (const locale of languages) translations.push(await cms.translateEntry('gizmos', gizmo.id, locale, admin));
        // Eight translations of about 7 KB each: one request could not carry their history rows.
        const saved = await gizmos.update(gizmo.id, { price: 12 }, { principal: admin, expectedRevision: gizmo.rev });
        expect(saved.price).toBe(12);
        for (const translation of translations) expect(await gizmos.get(translation.id, { principal: admin })).toMatchObject({ price: 12, rev: translation.rev + 1, notes });
        const job = await cms.db.read([{ rql: "SELECT payload FROM cms_outbox WHERE topic = 'resource.shared'" }]);
        const event = job.results[0]!.rows.map(row => JSON.parse(row[0] as string)).find(entry => entry.id === gizmo.id);
        expect(event).toMatchObject({ topic: 'resource.shared', resource: 'cms/gizmos', group: gizmo.id });
        // A translation saved again before the job runs wrote its own rows; the job leaves it alone.
        const [first] = translations;
        await gizmos.update(first!.id, { title: 'Gizmo again' }, { principal: admin, expectedRevision: first!.rev + 1 });
        await cms.outbox.dispatch({ limit: 100 });
        const updates = async () => (await cms.db.read([{ rql: "SELECT record_id, revision FROM cms_audit WHERE resource = 'cms/gizmos' AND action = 'update'" }])).results[0]!.rows.map(row => `${row[0]}:${Number(row[1])}`).sort();
        const expected = [`${gizmo.id}:${gizmo.rev + 1}`, `${first!.id}:${first!.rev + 2}`, ...translations.slice(1).map(translation => `${translation.id}:${translation.rev + 1}`)].sort();
        expect(await updates()).toEqual(expected);
        // A retried job, after a lost answer say, writes nothing twice.
        await gizmos.sharedSideEffects(event);
        expect(await updates()).toEqual(expected);
        // An entry whose save would not fit one request is refused plainly.
        await expect(gizmos.update(gizmo.id, { notes: 'x'.repeat(70_000) }, { principal: admin, expectedRevision: saved.rev })).rejects.toMatchObject({ code: 'CMS_LIMIT', message: expect.stringContaining('too large to save') });
        await cms.saveLanguages({ default: 'en', others: [] }, admin);
    });

    it('keeps passwords and protected snapshots out of revisions for readers who cannot edit', async () => {
        const posts = cms.resource('cms/posts');
        const post = await posts.create({ title: 'Behind a password', password: 'hunter2' }, { principal: editor });
        const reviewer: Principal = { kind: 'user', id: 'reviewer', roles: [], permissions: ['cms/posts:read'] };
        await expect(posts.revisions(post.id, { principal: reviewer })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        const open = await posts.update(post.id, { password: '' }, { principal: editor, expectedRevision: post.rev });
        // The open revision reads; the protected one before it does not, for the reviewer alone.
        expect((await posts.revisions(post.id, { principal: reviewer })).map(entry => entry.revision)).toEqual([open.rev]);
        expect(await posts.revision(post.id, post.rev, { principal: reviewer })).toBeNull();
        expect((await posts.revision(post.id, post.rev, { principal: editor }))!.data.password).toBe('hunter2');
    });

    it('serves translations under language prefixes', async () => {
        const pages = cms.resource('cms/pages');
        const about = await pages.create({ title: 'About', status: 'published' }, { principal: editor });
        await cms.saveLanguages({ default: 'en', others: ['fr'] }, admin);
        expect(await cms.languages()).toEqual({ default: 'en', others: ['fr'], all: ['en', 'fr'], multilingual: true, prefixDefault: false });
        expect((await pages.get(about.id, { principal: editor }))?.locale).toBe('en');
        const french = await cms.translateEntry('pages', about.id, 'fr', editor);
        // Each language has its own slugs, so the translation keeps the original's.
        expect(french).toMatchObject({ locale: 'fr', translationGroup: about.id, status: 'draft', title: 'About', slug: 'about' });
        expect((await cms.translateEntry('pages', about.id, 'fr', editor)).id).toBe(french.id);
        // Joining a group is translateEntry's: a save naming another entry's group is refused.
        await expect(pages.create({ title: 'Mine', locale: 'fr', translationGroup: about.id }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { translationGroup: expect.any(String) } });
        const loose = await pages.create({ title: 'Loose' }, { principal: editor });
        await expect(pages.update(loose.id, { translationGroup: about.id }, { principal: editor, expectedRevision: loose.rev })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // Keeping the group, or leaving it, stays open.
        expect((await pages.update(french.id, { translationGroup: about.id, title: 'About' }, { principal: editor, expectedRevision: french.rev })).rev).toBe(french.rev + 1);
        await pages.delete(loose.id, { principal: editor, expectedRevision: loose.rev });
        // A protected or members-only entry is translated only by those who may edit it.
        const reader: Principal = { kind: 'user', id: 'reader-1', roles: [], permissions: ['cms/pages:read', 'cms/pages:create'] };
        const secret = await pages.create({ title: 'Secret', password: 'open sesame', status: 'published' }, { principal: editor });
        await expect(cms.translateEntry('pages', secret.id, 'fr', reader)).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await cms.translateEntry('pages', secret.id, 'fr', editor)).toMatchObject({ password: 'open sesame', locale: 'fr' });
        const second = await pages.create({ title: 'About' }, { principal: editor });
        expect(second).toMatchObject({ locale: 'en', slug: 'about-2' });
        // Moving an entry to another language checks its slug there.
        const moved = await pages.update(second.id, { locale: 'fr' }, { principal: editor, expectedRevision: second.rev });
        expect(moved).toMatchObject({ locale: 'fr', slug: 'about-2' });
        const third = await pages.create({ title: 'About', locale: 'fr' }, { principal: editor });
        expect(third.slug).toBe('about-3');
        await pages.delete(second.id, { principal: editor, expectedRevision: moved.rev });
        await pages.delete(third.id, { principal: editor, expectedRevision: third.rev });
        const published = await pages.update(french.id, { title: 'À propos', slug: 'a-propos', status: 'published' }, { principal: editor, expectedRevision: french.rev + 1 });
        expect((await cms.entryUrls(cms.collection('pages'), [about, published]))).toEqual(new Map([[about.id, '/about'], [french.id, '/fr/a-propos']]));
        // Language in URLs → Every language: the default's pages take its code too.
        await cms.saveLanguages({ default: 'en', others: ['fr'], urls: 'all' }, admin);
        expect((await cms.languages()).prefixDefault).toBe(true);
        expect((await cms.entryUrls(cms.collection('pages'), [about, published]))).toEqual(new Map([[about.id, '/en/about'], [french.id, '/fr/a-propos']]));
        expect(await cms.archiveUrl(cms.collection('posts'), 'en')).toBe('/en/posts');
        await expect(cms.saveLanguages({ default: 'en', others: ['fr'], urls: 'some' as 'all' }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // Saving without a mode keeps it.
        await cms.saveLanguages({ default: 'en', others: ['fr'] }, admin);
        expect((await cms.languages()).prefixDefault).toBe(true);
        await cms.saveLanguages({ default: 'en', others: ['fr'], urls: 'hide-default' }, admin);
        expect([...(await cms.translations(cms.collection('pages'), about)).keys()]).toEqual(['en', 'fr']);
        expect([...(await cms.translations(cms.collection('pages'), published)).keys()]).toEqual(['fr', 'en']);
        // A page cannot take a language code as its slug.
        expect((await pages.create({ title: 'fr', status: 'published' }, { principal: editor })).slug).toBe('fr-2');
        expect(await cms.archiveUrl(cms.collection('posts'), 'fr')).toBe('/fr/posts');
        const menu = await cms.menus.create({ name: 'Main', items: [{ id: 'about', kind: 'entry', label: '', collection: 'pages', entry: about.id, children: [] }] }, { principal: admin });
        await cms.menus.place(menu.id, ['primary'], { principal: admin, known: ['primary'] });
        expect((await cms.menus.forLocation('primary', 'fr'))?.[0]).toMatchObject({ label: 'À propos', url: '/fr/a-propos' });
        expect((await cms.menus.forLocation('primary', 'en'))?.[0]).toMatchObject({ label: 'About', url: '/about' });
        await expect(cms.saveLanguages({ default: 'en', others: ['EN!'] }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.saveLanguages({ default: 'en', others: [] }, admin);
        expect((await cms.entryUrls(cms.collection('pages'), [published])).get(french.id)).toBe('/a-propos');
    });

    it('checks second factors once each and limits sign-in attempts', async () => {
        const secret = await cms.security.startTotp(authorId);
        expect(await cms.security.hasSecondFactor(authorId)).toBe(false);
        await expect(cms.security.confirmTotp(authorId, '000000')).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const step = totpStep(clock);
        const codes = await cms.security.confirmTotp(authorId, await totpCode(secret, step));
        expect(codes).toHaveLength(10);
        expect(await cms.security.status(authorId)).toMatchObject({ totp: true, recoveryCodes: 10, passkeys: [] });
        // The confirming code cannot sign in again; the next step's can, once.
        expect(await cms.security.verifyCode(authorId, await totpCode(secret, step))).toBeNull();
        clock += 30_000;
        const next = await totpCode(secret, step + 1);
        expect(await cms.security.verifyCode(authorId, next)).toBe('totp');
        expect(await cms.security.verifyCode(authorId, next)).toBeNull();
        expect(await cms.security.verifyCode(authorId, codes[0]!.toUpperCase())).toBe('recovery');
        expect(await cms.security.verifyCode(authorId, codes[0]!)).toBeNull();
        expect((await cms.security.status(authorId)).recoveryCodes).toBe(9);

        await cms.security.addPasskey(authorId, { id: 'cred-1', publicKey: 'pk', counter: 0, transports: ['internal'], deviceType: 'multiDevice', backedUp: true }, 'Laptop');
        await expect(cms.security.addPasskey(authorId, { id: 'cred-1', publicKey: 'pk', counter: 0 }, 'Again')).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect((await cms.security.status(authorId)).passkeys).toEqual([expect.objectContaining({ id: 'cred-1', name: 'Laptop', backedUp: true })]);

        const pending = await cms.security.createChallenge('signin', authorId, 'password-ok');
        for (let left = 4; left >= 0; left--) {
            expect(await cms.security.secondFactorAttempt(pending, authorId)).toEqual({ left });
            await cms.security.failChallenge(pending);
        }
        expect(await cms.security.challenge(pending, 'signin')).toBeNull();
        expect(await cms.security.secondFactorAttempt(pending, authorId)).toBe('expired');
        // Codes sent at once each take a try: no more than five are let through.
        const burst = await cms.security.createChallenge('signin', authorId, 'password-ok');
        const tries = await Promise.all(Array.from({ length: 12 }, () => cms.security.secondFactorAttempt(burst, authorId)));
        expect(tries.filter(t => typeof t === 'object')).toHaveLength(5);
        // The account has used its ten codes: a new pending sign-in after a right password gets none.
        const again = await cms.security.createChallenge('signin', authorId, 'password-ok');
        expect(await cms.security.secondFactorAttempt(again, authorId)).toBe('locked');
        await cms.security.secondFactorSucceeded(authorId);
        const fresh = await cms.security.createChallenge('signin', authorId, 'password-ok');
        const freshTries = await Promise.all(Array.from({ length: 12 }, () => cms.security.secondFactorAttempt(fresh, authorId)));
        expect(freshTries.filter(t => typeof t === 'object')).toHaveLength(5);
        clock += 16 * 60_000;
        await cms.security.purgeAttempts();
        const kept = await cms.db.read([{ rql: 'SELECT count(*) FROM cms_attempts WHERE until <= $now', params: { $now: clock } }]);
        expect(Number(kept.results[0]!.rows[0]![0] as bigint)).toBe(0);
        const once = await cms.security.createChallenge('passkey-signin', null, 'abc');
        expect(await cms.security.takeChallenge(once, 'passkey-signin')).toBe(true);
        expect(await cms.security.takeChallenge(once, 'passkey-signin')).toBe(false);
        await cms.security.reset(authorId);
        expect(await cms.security.hasSecondFactor(authorId)).toBe(false);
    });

    it('validates SEO groups and their media', async () => {
        const repository = cms.resource('cms/posts');
        await expect(repository.create({ title: 'SEO', seo: { title: 'x', unknown: 1 } }, { principal: editor })).rejects.toMatchObject({ fields: { seo: expect.stringContaining('unknown') } });
        await expect(repository.create({ title: 'SEO', seo: { image: 'missing-file' } }, { principal: editor })).rejects.toMatchObject({ fields: { seo: 'names a missing file.' } });
        await expect(repository.create({ title: 'SEO', seo: { canonical: 'javascript:alert(1)' } }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const post = await repository.create({ title: 'SEO', seo: { title: 'Better title', description: 'Summary', noindex: true, canonical: '/elsewhere', nosnippet: false, maxSnippet: 160 } }, { principal: editor });
        expect(post.seo).toEqual({ title: 'Better title', description: 'Summary', noindex: true, canonical: '/elsewhere', nosnippet: false, maxSnippet: 160 });
        await expect(repository.create({ title: 'SEO', seo: { maxSnippet: -5 } }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // Site collections carry a summary; it is a core field, so groups cannot take the name.
        expect((await repository.create({ title: 'Summed', summary: 'In short.' }, { principal: editor })).summary).toBe('In short.');
        await expect(repository.create({ title: 'Summed', summary: 'x'.repeat(601) }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(cms.resourceById('cms/patterns').fields.summary).toBeUndefined();

        // Collections choose their structured data type, robots directives and title templates; built-in ones keep them across upgrades.
        await expect(cms.saveCollection({ ...cms.collection('posts'), schema: { type: 'Product', map: { price: 'nope' } } }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.saveCollection({ ...cms.collection('posts'), schema: { type: 'NewsArticle' }, robots: { archiveNoindex: true }, seoTemplates: { title: '%title% %sep% %site% News' } }, admin);
        expect(cms.collection('posts')).toMatchObject({ schema: { type: 'NewsArticle' }, robots: { archiveNoindex: true }, seoTemplates: { title: '%title% %sep% %site% News' }, builtin: true });
        await cms.saveCollection({ ...cms.collection('posts'), robots: { noindex: true } }, admin);
        expect(await cms.sitemapEntries('posts')).toEqual([]);
        await cms.saveCollection({ ...cms.collection('posts'), schema: { type: 'BlogPosting' }, robots: {}, seoTemplates: {} }, admin);
        await cms.saveTaxonomy({ ...cms.taxonomies.declaration('tags'), noindex: true }, admin);
        expect(cms.taxonomies.declaration('tags').noindex).toBe(true);
    });

    it('pings IndexNow for published entries and retries failures', async () => {
        const repository = cms.resource('cms/posts');
        await cms.outbox.dispatch({ limit: 100 });
        sent.length = 0;
        // Off by default: nothing is sent and there is no key.
        const quiet = await repository.create({ title: 'Quiet', status: 'published' }, { principal: editor });
        await cms.outbox.dispatch({ limit: 100 });
        expect(sent.filter(call => call.url.includes('indexnow'))).toHaveLength(0);
        expect(await cms.indexnow.key()).toBeNull();
        await cms.settings.update('indexnow', { enabled: true }, { principal: admin });
        const key = await cms.indexnow.key();
        expect(key).toMatch(/^[a-f0-9]{32}$/);
        expect(await cms.settings.get('indexnow.key')).toBe(key);
        // A draft pings nothing; publishing it pings its URL with the key file's location.
        const draft = await repository.create({ title: 'Ping me' }, { principal: editor });
        await cms.outbox.dispatch({ limit: 100 });
        expect(sent.filter(call => call.url.includes('indexnow'))).toHaveLength(0);
        await repository.update(draft.id, { status: 'published' }, { principal: editor, expectedRevision: draft.rev });
        await cms.outbox.dispatch({ limit: 100 });
        const ping = sent.find(call => call.url === 'https://api.indexnow.org/indexnow');
        expect(ping).toBeDefined();
        expect(JSON.parse(ping!.body)).toEqual({ host: 'essentials.example', key, keyLocation: `https://essentials.example/indexnow/${key}.txt`, urlList: ['https://essentials.example/posts/ping-me'] });
        expect(ping!.headers.get('content-type')).toContain('application/json');
        // A server error is retried by the outbox; a client error is not.
        sent.length = 0;
        answer = 503;
        await repository.update(quiet.id, { title: 'Quiet, changed' }, { principal: editor, expectedRevision: quiet.rev });
        expect((await cms.outbox.dispatch({ limit: 100 })).retrying).toHaveLength(1);
        answer = 200;
        clock += 61_000;
        expect((await cms.outbox.dispatch({ limit: 100 })).delivered).toHaveLength(1);
        expect(sent.filter(call => call.url.includes('indexnow'))).toHaveLength(2);
        expect(cms.indexnow.recent[0]).toMatchObject({ status: 200, urls: ['https://essentials.example/posts/quiet'] });
        await cms.settings.update('indexnow', { enabled: false }, { principal: admin });
        // Sitemap entries carry what the news and hreflang sitemaps need.
        expect((await cms.sitemapEntries('posts')).find(entry => entry.url === '/posts/ping-me')).toMatchObject({ id: draft.id, title: 'Ping me', translationGroup: null, publishedAt: expect.any(Number) });
        // Search engines can't open protected or members-only entries, so their URLs stay out.
        await cms.resource('cms/posts').create({ title: 'Locked', slug: 'locked-story', status: 'published', password: 'secret' }, { principal: admin });
        await cms.resource('cms/posts').create({ title: 'Members', slug: 'members-story', status: 'published', membersOnly: true }, { principal: admin });
        const listed = (await cms.sitemapEntries('posts')).map(entry => entry.url);
        expect(listed).toContain('/posts/ping-me');
        expect(listed.filter(url => url.endsWith('locked-story') || url.endsWith('members-story'))).toEqual([]);
    });

    it('counts crawler visits and missing pages', async () => {
        const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
        expect(await cms.traffic.recordVisit(chrome, 'entry')).toBe(false);
        expect(await cms.traffic.recordVisit('Mozilla/5.0 (compatible; GPTBot/1.2)', 'entry')).toBe(true);
        await cms.traffic.recordVisit('Mozilla/5.0 (compatible; GPTBot/1.2)', 'entry');
        await cms.traffic.recordVisit('OAI-SearchBot/1.0', 'llms');
        clock += 86_400_000;
        await cms.traffic.recordVisit('Mozilla/5.0 (compatible; GPTBot/1.2)', 'sitemap');
        const visits = await cms.traffic.visits(14);
        expect(visits.map(visit => [visit.agent, visit.group, visit.total])).toEqual([['GPTBot', 'aiTraining', 3], ['OAI-SearchBot', 'aiSearch', 1]]);
        expect(visits[0]!.byKind).toEqual({ entry: 2, sitemap: 1 });
        expect(visits[0]!.lastDay).toBe(new Date(clock).toISOString().slice(0, 10));
        // Missing pages: counted by path, probes for other software skipped, forgotten once redirected.
        expect(await cms.traffic.recordNotFound('/old-page?utm=1', 'https://referrer.example/list')).toBe(true);
        await cms.traffic.recordNotFound('/old-page/', null);
        expect(await cms.traffic.recordNotFound('/wp-login.php')).toBe(false);
        expect(await cms.traffic.recordNotFound('/assets/app.js')).toBe(false);
        expect(await cms.traffic.notFound()).toEqual([expect.objectContaining({ path: '/old-page', hits: 2, referrer: 'https://referrer.example/list' })]);
        await cms.traffic.forgetNotFound('/old-page');
        expect(await cms.traffic.notFound()).toEqual([]);
        await cms.traffic.prune();
    });

    it('gives authors slugs and a public profile', async () => {
        const ada = await cms.users.create({ email: 'ada@example.com', name: 'Ada Lovelace', roles: ['author'] });
        expect(ada.slug).toBe('ada-lovelace');
        const twin = await cms.users.create({ email: 'ada2@example.com', name: 'Ada Lovelace', roles: ['author'] });
        expect(twin.slug).toBe('ada-lovelace-2');
        expect((await cms.users.bySlug('ada-lovelace'))?.id).toBe(ada.id);
        expect(await cms.users.bySlug('Ada Lovelace')).toBeNull();
        // Renaming keeps the slug; a slug given is checked and made unique.
        await cms.users.update(ada.id, { name: 'Augusta Ada King' });
        expect((await cms.users.get(ada.id))?.slug).toBe('ada-lovelace');
        await cms.users.update(twin.id, { slug: 'ada-lovelace' });
        expect((await cms.users.get(twin.id))?.slug).toBe('ada-lovelace-2');
        await cms.users.update(twin.id, { slug: 'countess' });
        expect((await cms.users.get(twin.id))?.slug).toBe('countess');
        // The profile is validated like a field group's meta; unknown keys are refused.
        await expect(cms.users.update(ada.id, { meta: { bio: 'x'.repeat(1001) } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.users.update(ada.id, { meta: { website: 'javascript:alert(1)' } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.users.update(ada.id, { meta: { favouriteColor: 'blue' } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.users.update(ada.id, { meta: { bio: 'First programmer.', jobTitle: 'Analyst', website: 'https://ada.example', profiles: 'https://x.com/ada\nnot a url' } });
        expect((await cms.users.get(ada.id))?.meta).toMatchObject({ bio: 'First programmer.', jobTitle: 'Analyst', website: 'https://ada.example' });
        // Users from before author pages get a slug the first time the site needs one.
        await cms.db.write([{ rql: 'UPDATE cms_users SET slug = NULL WHERE id = $id', params: { $id: ada.id } }], { kind: 'cms.users' });
        expect((await cms.users.get(ada.id))?.slug).toBeNull();
        const withSlugs = await cms.users.withSlugs(await cms.users.getMany([ada.id]));
        expect(withSlugs.get(ada.id)?.slug).toBe('augusta-ada-king');
        expect((await cms.users.authors()).map(user => user.slug)).toEqual(expect.arrayContaining(['augusta-ada-king', 'countess']));
    });

    it('keeps Custom HTML blocks to people allowed to post HTML', async () => {
        const posts = cms.resource('cms/posts');
        const html = (text: string) => [{ _id: 'raw', type: 'core/html', data: { html: text } }, { _id: 'p', type: 'core/paragraph', data: { text: 'Hi' } }];
        await expect(posts.create({ title: 'Sneaky', content: html('<script>alert(1)</script>') }, { principal: editor }))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { content: expect.stringContaining('Custom HTML') } });
        const post = await posts.create({ title: 'Embed', content: html('<iframe src="https://maps.example"></iframe>') }, { principal: admin });
        // Others keep it as it is and change the rest; changing or copying the HTML is refused, removing it is not.
        const kept = await posts.update(post.id, { title: 'Embed and text', content: post.content }, { principal: editor, expectedRevision: post.rev });
        await expect(posts.update(post.id, { content: html('<script>alert(1)</script>') }, { principal: editor, expectedRevision: kept.rev })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(posts.update(post.id, { content: [...(kept.content as unknown[]), { _id: 'copy', type: 'core/html', data: { html: '<iframe src="https://maps.example"></iframe>' } }] }, { principal: editor, expectedRevision: kept.rev }))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect((await posts.update(post.id, { content: [{ _id: 'p', type: 'core/paragraph', data: { text: 'Hi' } }] }, { principal: editor, expectedRevision: kept.rev })).content).toHaveLength(1);
        // Widgets take the same rule.
        const designer: Principal = { kind: 'user', id: 'designer-1', roles: [], permissions: ['cms:appearance'] };
        const known = ['html-test'];
        await expect(cms.areas.save('html-test', html('<b>x</b>'), { principal: designer, expectedRevision: 0, known })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect((await cms.areas.save('html-test', html('<b>x</b>'), { principal: admin, expectedRevision: 0, known })).revision).toBe(1);
        expect((await cms.areas.save('html-test', html('<b>x</b>').slice(0, 1), { principal: designer, expectedRevision: 1, known })).revision).toBe(2);
    });

    it('lets co-authors edit an entry and lists it under each of them', async () => {
        const posts = cms.resource('cms/posts');
        const otherId = other.kind === 'user' ? other.id : '';
        const post = await posts.create({ title: 'Together' }, { principal: author });
        expect(post.authors).toEqual([authorId]);
        // Only people who edit others' entries choose authors; the list as it is may be sent back.
        await expect(posts.update(post.id, { authors: [authorId, otherId] }, { principal: author, expectedRevision: post.rev })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { authors: expect.stringContaining('others') } });
        const same = await posts.update(post.id, { title: 'Together again', authors: [authorId] }, { principal: author, expectedRevision: post.rev });
        await expect(posts.update(post.id, { title: 'Taken' }, { principal: other, expectedRevision: same.rev })).rejects.toBeTruthy();
        const shared = await posts.update(post.id, { authors: [otherId, authorId] }, { principal: editor, expectedRevision: same.rev });
        expect(shared.authors).toEqual([otherId, authorId]);
        // A co-author edits it now, and finds it among their own.
        const edited = await posts.update(post.id, { title: 'Together, edited' }, { principal: other, expectedRevision: shared.rev });
        expect(edited.title).toBe('Together, edited');
        expect((await posts.list({ owner: otherId, limit: 50 }, { principal: other })).records.map(record => record.id)).toContain(post.id);
        expect((await posts.list({ limit: 50 }, { principal: other })).records.map(record => record.id)).toContain(post.id);
    });

    it('keeps system meta such as recent blocks beside the profile fields', async () => {
        const user = await cms.users.create({ email: 'recent@example.com', name: 'Recent' });
        expect(await cms.users.setSystemMeta(user.id, '_recent_blocks', ['core/heading', 'core/image'])).toBe(true);
        // Saving profile fields keeps it, and field checks leave it alone.
        await cms.users.update(user.id, { meta: { bio: 'Writes.' } });
        expect((await cms.users.get(user.id))?.meta).toMatchObject({ bio: 'Writes.', _recent_blocks: ['core/heading', 'core/image'] });
        await expect(cms.users.setSystemMeta(user.id, 'recent', [])).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.users.setSystemMeta(user.id, '_recent_blocks', null);
        expect((await cms.users.get(user.id))?.meta).not.toHaveProperty('_recent_blocks');
    });

    it('finds users whose profile picture or fields name a file', async () => {
        const file = 'file-avatar-1';
        const pictured = await cms.users.create({ email: 'pictured@example.com', name: 'Pictured', avatar: `/media/${file}/me.png` });
        await cms.users.create({ email: 'elsewhere@example.com', name: 'Elsewhere', avatar: `/media/${file}x/me.png` });
        expect((await cms.users.usingFile(file)).map(user => user.id)).toEqual([pictured.id]);
        expect(await cms.users.usingFile('a%')).toEqual([]);
    });

    it('crops images and keeps their variants', async () => {
        const bytes = png(3000, 2000);
        const file = await cms.files!.upload({ name: 'photo.png', contentType: 'image/png', size: bytes.length, body: new Response(bytes).body! }, { principal: editor });
        expect(imageSrcset({ ...file, version: file.updatedAt }).split(', ').map(entry => entry.split(' ')[1])).toEqual(['320w', '640w', '960w', '1280w', '1920w', '2560w']);
        // The upload made a blurred placeholder: the image 16 pixels wide, as WebP.
        expect(file.placeholder).toBe(`data:image/webp;base64,${btoa('webp:16x11')}`);
        expect(transforms).toEqual([{ width: 16, height: 11, format: 'webp', rect: { x: 0, y: 0, width: 3000, height: 2000 } }]);
        const variant = await cms.files!.variant(file.id, { width: 700, accept: 'image/avif,image/webp,*/*' });
        expect(variant).toMatchObject({ contentType: 'image/avif' });
        expect(new TextDecoder().decode(new Uint8Array(await new Response(variant!.body).arrayBuffer()))).toBe('avif:960x640');
        await cms.files!.variant(file.id, { width: 700, accept: 'image/avif' });
        expect(transforms).toHaveLength(2);
        await expect(cms.files!.setEdits(file.id, { crop: { x: 2900, y: 0, width: 200, height: 100 } }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const cropped = await cms.files!.setEdits(file.id, { crop: { x: 1000, y: 0, width: 2000, height: 2000 }, focus: { x: 1, y: 0.5 } }, { principal: editor });
        expect(cropped.edits).toEqual({ crop: { x: 1000, y: 0, width: 2000, height: 2000 }, focus: { x: 1, y: 0.5 } });
        // The placeholder follows the crop.
        expect(cropped.placeholder).toBe(`data:image/webp;base64,${btoa('webp:16x16')}`);
        expect(transforms.at(-1)).toEqual({ width: 16, height: 16, format: 'webp', rect: { x: 1000, y: 0, width: 2000, height: 2000 } });
        expect([...storage.objects.keys()].filter(key => key.startsWith('cms/variants/'))).toEqual([]);
        await cms.files!.variant(file.id, { width: 640, height: 360, accept: 'image/jpeg' });
        expect(transforms.at(-1)).toEqual({ width: 640, height: 360, format: 'png', rect: { x: 1000, y: 438, width: 2000, height: 1125 } });
        await cms.files!.variant(file.id, { width: 4000 });
        expect(transforms.at(-1)).toMatchObject({ width: 2000, height: 2000 });
        await expect(cms.files!.setEdits(file.id, null, { principal: other })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        // An image with an alpha channel gets no placeholder: the blur would show through its transparent pixels.
        const made = transforms.length;
        const logo = png(500, 500, { alpha: true });
        const clear = await cms.files!.upload({ name: 'logo.png', contentType: 'image/png', size: logo.length, body: new Response(logo).body! }, { principal: editor });
        expect(clear.placeholder).toBeNull();
        expect(transforms).toHaveLength(made);
        expect((await cms.files!.setEdits(clear.id, { focus: { x: 0.2, y: 0.8 } }, { principal: editor })).placeholder).toBeNull();
    });

    it('keeps a bounded set of variants per image, made once, and removes every one with the file', async () => {
        const bytes = png(2000, 1000);
        const file = await cms.files!.upload({ name: 'bounded.png', contentType: 'image/png', size: bytes.length, body: new Response(bytes).body! }, { principal: editor });
        const keys = () => [...storage.objects.keys()].filter(key => key.startsWith(`cms/variants/${file.id}/`));
        // Concurrent first requests share one transform.
        const before = transforms.length;
        await Promise.all([1, 2, 3].map(() => cms.files!.variant(file.id, { width: 640, accept: 'image/webp' })));
        expect(transforms.length - before).toBe(1);
        // A new title or alt text makes no new variants.
        await cms.files!.update(file.id, { title: 'Renamed', alt: 'New alt' }, { principal: editor });
        await cms.files!.variant(file.id, { width: 640, accept: 'image/webp' });
        expect(transforms.length - before).toBe(1);
        expect(keys()).toHaveLength(1);
        // Past the cap, a new variant replaces the oldest: storage stays bounded, and sizes asked for later are still made.
        for (let height = 1; keys().length < MAX_FILE_VARIANTS && height < 2000; height += 7) await cms.files!.variant(file.id, { width: 320, height, accept: 'image/png' });
        expect(keys()).toHaveLength(MAX_FILE_VARIANTS);
        const full = keys();
        const made = transforms.length;
        expect(await cms.files!.variant(file.id, { width: 1280, height: 77, accept: 'image/png' })).not.toBeNull();
        expect(transforms).toHaveLength(made + 1);
        expect(keys()).toHaveLength(MAX_FILE_VARIANTS);
        expect(full.filter(key => !keys().includes(key))).toHaveLength(1);
        // A variant row naming another file's object (as an edited export could) never deletes it.
        const foreign = 'cms/variants/someone-else/x/1x1.png';
        storage.objects.set(foreign, new Uint8Array([1]));
        await cms.db.write([{ rql: 'INSERT INTO cms_file_variants (key, file_id, created_at, size) VALUES ($key, $id, 0, 1)', params: { $key: foreign, $id: file.id } }]);
        // Rows past one page (500) are removed with their objects too.
        const extra = Array.from({ length: 520 }, (_, i) => `cms/variants/${file.id}/legacy/${i}.webp`);
        for (const key of extra) storage.objects.set(key, new Uint8Array([1]));
        for (let i = 0; i < extra.length; i += 32) {
            await cms.db.write(extra.slice(i, i + 32).map(key => ({ rql: 'INSERT INTO cms_file_variants (key, file_id, created_at, size) VALUES ($key, $id, 0, 1)', params: { $key: key, $id: file.id } })));
        }
        await cms.files!.delete(file.id, { principal: editor });
        expect(keys()).toEqual([]);
        expect((await cms.db.read([{ rql: 'SELECT count(*) FROM cms_file_variants WHERE file_id = $id', params: { $id: file.id } }])).results[0]!.rows[0]![0]).toBe(0n);
        expect(storage.objects.has(foreign)).toBe(true);
        storage.objects.delete(foreign);
    });

    it('deletes only a file\'s own stored object, whatever key its row names', async () => {
        const bytes = png(10, 10);
        const forged = await cms.files!.upload({ name: 'forged.png', contentType: 'image/png', size: bytes.length, body: new Response(bytes).body! }, { principal: editor });
        // A row from an imported export that names an object the file does not own.
        const other = 'cms/variants/someone-else/o/320x320.webp';
        storage.objects.set(other, new Uint8Array([1]));
        await cms.db.write([{ rql: "UPDATE cms_files SET key = $key, status = 'deleting', updated_at = 0 WHERE id = $id", params: { $key: other, $id: forged.id } }]);
        await cms.files!.sweep();
        expect(storage.objects.has(other)).toBe(true);
        expect(storage.objects.has(`cms/files/${forged.id}`)).toBe(false);
        storage.objects.delete(other);
    });

    it('scales down large uploads, resizes in the widths of Settings → Files and counts the library', async () => {
        await cms.settings.update('media', { maxImageWidth: 1000, imageWidths: '800, 400, 400', imageQuality: 60 }, { principal: admin });
        const bytes = png(3000, 1500);
        const file = await cms.files!.upload({ name: 'wide.png', contentType: 'image/png', size: bytes.length, body: new Response(bytes).body! }, { principal: editor });
        expect(file).toMatchObject({ width: 1000, height: 500 });
        expect(transforms).toContainEqual({ width: 1000, height: 500, format: 'png', rect: { x: 0, y: 0, width: 3000, height: 1500 } });
        expect(imageSrcset({ ...file, version: file.updatedAt }, { widths: [400, 800] }).split(', ').map(entry => entry.split(' ')[1])).toEqual(['400w', '800w']);
        const variant = await cms.files!.variant(file.id, { width: 500, accept: 'image/webp' });
        expect(new TextDecoder().decode(new Uint8Array(await new Response(variant!.body).arrayBuffer()))).toBe('webp:800x400');
        const summary = await cms.files!.summary();
        expect(summary.kinds.find(entry => entry.kind === 'image')?.files).toBeGreaterThan(0);
        expect(summary.files).toBe(summary.kinds.reduce((sum, entry) => sum + entry.files, 0));
        expect(summary.variants.bytes).toBeGreaterThanOrEqual('webp:800x400'.length);
        await cms.settings.update('media', { maxImageWidth: 0, imageWidths: '320, 640, 960, 1280, 1920, 2560', imageQuality: 78 }, { principal: admin });
    });

    it('caches values in RomeDB with an expiry', async () => {
        await cms.cache.set('test:a', { n: 1 }, 1000);
        expect(await cms.cache.get('test:a')).toEqual({ n: 1 });
        expect(await cms.cache.getMany(['test:a', 'test:none'])).toEqual([{ n: 1 }, undefined]);
        clock += 1001;
        expect(await cms.cache.get('test:a')).toBeUndefined();
        let runs = 0;
        const compute = async () => ++runs;
        expect((await cms.cache.remember('test:b', 1000, compute)).value).toBe(1);
        expect(await cms.cache.remember('test:b', 1000, compute)).toEqual({ value: 1, at: clock });
        expect((await cms.cache.remember('test:b', 1000, compute, { fresh: true })).value).toBe(2);
        await cms.cache.set('test:b', undefined);
        expect(await cms.cache.has('test:b')).toBe(false);
        await expect(cms.cache.set('has space', 1)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
    });

    it('applies changed built-in collections and new host tables on the next request', async () => {
        const extended: CmsModule = { ...contentModule, collections: contentModule.collections!.map(entry => entry.name === 'pages' ? { ...entry, fields: { ...entry.fields, summary2: field.string({ label: 'Teaser' }) } } : entry) };
        // As if a new build of the package added host step 5.
        await service.database().write([
            { rql: "DELETE FROM cms_migrations WHERE id = 'cms#host-5'" },
            ...['cms_drafts', 'cms_notes', 'cms_note_mentions', 'cms_schedules', 'cms_automations', 'cms_crawler_visits', 'cms_not_found'].map(table => ({ rql: `DROP TABLE ${table}` })),
        ]);
        const upgraded = createCMS({ db: service.database(), modules: [extended] });
        await upgraded.ready();
        expect(await upgraded.installed()).toBe(true);
        const page = await upgraded.resource('cms/pages').create({ title: 'Upgraded', summary2: 'Teaser text' }, { principal: editor });
        expect(page.summary2).toBe('Teaser text');
    });
});
