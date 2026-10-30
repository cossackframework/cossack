import { beforeAll, describe, expect, it } from 'vitest';
import type { StorageProvider } from '@cossackframework/core/storage';
import { totpCode, totpStep } from '@cossackframework/auth';
import {
    ANONYMOUS, contentModule, createCMS, DEFAULT_ROLES, field, imageSrcset, posts, verifyWebhookSignature,
    type CmsHost, type CmsModule, type ImageTransformer, type Principal,
} from '../src/server/index';
import { romedbService, live } from './helpers';

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

/** A PNG header of the given size: enough for the signature check and dimensions. */
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 0, 0]);
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
        expect(await cms.publishDue()).toBe(0);
        const now = await repository.create({ title: 'Now', status: 'scheduled' }, { principal: author });
        expect(now).toMatchObject({ status: 'published', publishedAt: clock });
        clock = later + 1;
        expect(await cms.publishDue()).toBe(1);
        expect(await repository.get(post.id, { principal: ANONYMOUS })).toMatchObject({ status: 'published', rev: 2 });
        const pending = await repository.create({ title: 'Review me', status: 'pending' }, { principal: author });
        expect(pending.status).toBe('pending');
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
        expect(await cms.redirects.match('/posts/moving-post')).toMatchObject({ location: '/blog/moving-post' });
        expect(await cms.redirects.match('/posts/anything/else')).toMatchObject({ location: '/blog/anything/else' });
        expect(await cms.redirects.match('/posts')).toMatchObject({ location: '/blog' });
        clock += 1000;
        await cms.saveCollection({ ...cms.collection('posts'), path: 'posts' }, admin);

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

        await expect(cms.redirects.save({ source: 'nope', target: '/x' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await expect(cms.redirects.save({ source: '/a', target: '/a' })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        const gone = await cms.redirects.save({ source: '/retired', target: '', status: 410, note: 'Old campaign' });
        expect(await cms.redirects.match('/retired/')).toMatchObject({ location: null, redirect: { id: gone.id, status: 410 } });
        await expect(cms.redirects.save({ source: '/retired', target: '/x' })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        const external = await cms.redirects.save({ source: '/shop/*', target: 'https://shop.example.com/*', status: 302 });
        expect(await cms.redirects.match('/shop/boots')).toMatchObject({ location: 'https://shop.example.com/boots' });
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
        expect(await verifyWebhookSignature(hook.secret, delivery.headers.get('x-cossack-timestamp')!, delivery.body, delivery.headers.get('x-cossack-signature')!)).toBe(true);
        expect(await verifyWebhookSignature(hook.secret, delivery.headers.get('x-cossack-timestamp')!, `${delivery.body} `, delivery.headers.get('x-cossack-signature')!)).toBe(false);

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
        // A returning commenter is approved; links and blocked words are held or spam.
        expect((await comment({ content: 'Again' })).comment.status).toBe('approved');
        expect((await comment({ content: 'See https://a.example and https://b.example' })).comment.status).toBe('pending');
        await cms.settings.update('discussion', { blockedWords: 'casino' }, { principal: admin });
        expect((await comment({ content: 'Best CASINO deals' })).comment.status).toBe('spam');
        expect((await comment({ trap: 'filled' })).comment.status).toBe('spam');
        const reply = await comment({ parent: first.comment.id, content: 'A reply' });
        expect(reply.comment.parentId).toBe(first.comment.id);
        await expect(comment({ authorName: '', authorEmail: '' })).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { authorName: expect.any(String), authorEmail: expect.any(String) } });
        clock += 1000;
        expect((await cms.postComment({ collection: 'posts', entry: post.id, content: 'From the editor' }, { principal: editor })).comment).toMatchObject({ status: 'approved', authorName: 'editor' });
        expect((await cms.comments.forEntry('cms/posts', post.id)).map(entry => entry.content)).toEqual(['Nice post', 'Again', 'A reply', 'From the editor']);
        expect((await cms.comments.approvedCounts('cms/posts', [post.id])).get(post.id)).toBe(4);
        expect(await cms.comments.counts()).toEqual({ pending: 2, approved: 4, spam: 2, trash: 0 });

        await repository.update(post.id, { commentsOpen: false }, { principal: editor, expectedRevision: post.rev });
        await expect(comment({})).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.postComment({ collection: 'pages', entry: post.id, content: 'x' }, { principal: ANONYMOUS })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        await cms.settings.update('discussion', { defaultOpen: false }, { principal: admin });
        expect((await repository.create({ title: 'Closed by default' }, { principal: editor })).commentsOpen).toBe(false);
        await cms.settings.update('discussion', { defaultOpen: true, blockedWords: '' }, { principal: admin });
    });

    it('serves translations under language prefixes', async () => {
        const pages = cms.resource('cms/pages');
        const about = await pages.create({ title: 'About', status: 'published' }, { principal: editor });
        await cms.saveLanguages({ default: 'en', others: ['fr'] }, admin);
        expect(await cms.languages()).toEqual({ default: 'en', others: ['fr'], all: ['en', 'fr'], multilingual: true });
        expect((await pages.get(about.id, { principal: editor }))?.locale).toBe('en');
        const french = await cms.translateEntry('pages', about.id, 'fr', editor);
        expect(french).toMatchObject({ locale: 'fr', translationGroup: about.id, status: 'draft', title: 'About', slug: 'about-2' });
        expect((await cms.translateEntry('pages', about.id, 'fr', editor)).id).toBe(french.id);
        const published = await pages.update(french.id, { title: 'À propos', slug: 'a-propos', status: 'published' }, { principal: editor, expectedRevision: french.rev });
        expect((await cms.entryUrls(cms.collection('pages'), [about, published]))).toEqual(new Map([[about.id, '/about'], [french.id, '/fr/a-propos']]));
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
        for (let left = 4; left > 0; left--) expect(await cms.security.failChallenge(pending)).toBe(left);
        expect(await cms.security.failChallenge(pending)).toBe(0);
        expect(await cms.security.challenge(pending, 'signin')).toBeNull();
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
        await expect(cms.users.update(ada.id, { meta: { favouriteColour: 'blue' } })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        await cms.users.update(ada.id, { meta: { bio: 'First programmer.', jobTitle: 'Analyst', website: 'https://ada.example', profiles: 'https://x.com/ada\nnot a url' } });
        expect((await cms.users.get(ada.id))?.meta).toMatchObject({ bio: 'First programmer.', jobTitle: 'Analyst', website: 'https://ada.example' });
        // Users from before author pages get a slug the first time the site needs one.
        await cms.db.write([{ rql: 'UPDATE cms_users SET slug = NULL WHERE id = $id', params: { $id: ada.id } }], { kind: 'cms.users' });
        expect((await cms.users.get(ada.id))?.slug).toBeNull();
        const withSlugs = await cms.users.withSlugs(await cms.users.getMany([ada.id]));
        expect(withSlugs.get(ada.id)?.slug).toBe('augusta-ada-king');
        expect((await cms.users.authors()).map(user => user.slug)).toEqual(expect.arrayContaining(['augusta-ada-king', 'countess']));
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
    });

    it('applies changed built-in collections and new host tables on the next request', async () => {
        const extended: CmsModule = { ...contentModule, collections: contentModule.collections!.map(entry => entry.name === 'pages' ? { ...entry, fields: { ...entry.fields, summary2: field.string({ label: 'Teaser' }) } } : entry) };
        // As if the package was upgraded from before host step 5.
        await service.database().write([
            { rql: "DELETE FROM cms_migrations WHERE id = 'cms#host-5'" },
            ...['cms_comments', 'cms_user_security', 'cms_passkeys', 'cms_auth_challenges'].map(table => ({ rql: `DROP TABLE ${table}` })),
        ]);
        const upgraded = createCMS({ db: service.database(), modules: [extended] });
        await upgraded.ready();
        expect(await upgraded.installed()).toBe(true);
        const page = await upgraded.resource('cms/pages').create({ title: 'Upgraded', summary2: 'Teaser text' }, { principal: editor });
        expect(page.summary2).toBe('Teaser text');
    });
});
