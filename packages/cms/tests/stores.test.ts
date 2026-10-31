import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createSessionManager } from '@cossackframework/auth';
import type { StorageProvider } from '@cossackframework/core/storage';
import { beforeWrite, createCMS, createCmsAuth, FileService, HOST_STEPS, systemPrincipal, userPrincipal, type CmsHost, type PluginContext } from '../src/server/index';
import { romedbService, live } from './helpers';

const context = {} as never;

describe.skipIf(!live)('CMS stores on RomeDB', () => {
    const service = romedbService();
    let cms: CmsHost;

    beforeAll(async () => {
        cms = createCMS({ db: service.database() });
        expect((await cms.migrate()).failed).toBeUndefined();
    });

    it('rotates an auth session exactly once under concurrency and keeps its public reference', async () => {
        // The store also refuses sessions expired by wall-clock time, so start at the real time.
        let now = Date.now();
        const manager = createSessionManager({ store: cms.authSessions, ttlSeconds: 60, now: () => now });
        const issued = await manager.create('user-1', context);
        const reference = await cms.authSessions.publicReference(issued.session.id);
        const rotations = await Promise.all([manager.rotate(issued.session.id, context), manager.rotate(issued.session.id, context)]);
        const winners = rotations.filter(Boolean);
        expect(winners).toHaveLength(1);
        expect(await manager.validate(issued.session.id, context)).toBeNull();
        const rotated = winners[0]!.session;
        expect(await manager.validate(rotated.id, context)).toMatchObject({ userId: 'user-1' });
        expect(await cms.authSessions.publicReference(rotated.id)).toBe(reference);
        now += 61_000;
        expect(await manager.validate(rotated.id, context)).toBeNull();
        expect(await manager.rotate(rotated.id, context)).toBeNull();
        await manager.revoke(rotated.id, context);
        expect(await cms.authSessions.read(rotated.id)).toBeNull();
    });

    it('consumes OAuth state exactly once, for its provider, before expiry', async () => {
        const key = 'a'.repeat(64);
        const now = Date.now();
        await cms.oauthStates.create({ key, provider: 'github', createdAt: now, expiresAt: now + 60_000 });
        await expect(cms.oauthStates.create({ key, provider: 'github', createdAt: now, expiresAt: now + 60_000 })).rejects.toThrow();
        expect(await cms.oauthStates.consume(key, 'google', now)).toBe(false);
        const results = await Promise.all([cms.oauthStates.consume(key, 'github', now), cms.oauthStates.consume(key, 'github', now)]);
        expect(results.sort()).toEqual([false, true]);
        const expired = 'b'.repeat(64);
        await cms.oauthStates.create({ key: expired, provider: 'github', createdAt: now - 10, expiresAt: now - 1 });
        expect(await cms.oauthStates.consume(expired, 'github', now)).toBe(false);
    });

    it('keeps concurrent writes to different session keys', async () => {
        const store = cms.sessions;
        const id = await store.create(60_000);
        await Promise.all(Array.from({ length: 6 }, (_, index) => store.set(id, `key${index}`, { index })));
        expect(Object.keys(await store.getAll(id)).sort()).toEqual(['key0', 'key1', 'key2', 'key3', 'key4', 'key5']);
        await store.unset(id, 'key0');
        expect(await store.get(id, 'key0')).toBeUndefined();
        expect(await store.get(id, 'key1')).toEqual({ index: 1 });
        await store.bindUser(id, 'user-1');
        await store.destroy(id);
        expect(await store.has(id)).toBe(false);
        await expect(store.set(id, 'late', 1)).resolves.toBeUndefined();
        expect(await store.getAll(id)).toEqual({});
    });

    it('fences job claims with lease tokens like the D1 ledger', async () => {
        const jobs = cms.jobs();
        const key = 'c'.repeat(64);
        const claim = { now: 1000, leaseMs: 2000, job: 'send-report', attempt: 1 };
        const claims = await Promise.all([jobs.claim(key, claim), jobs.claim(key, claim)]);
        expect(claims.map(value => value.status).sort()).toEqual(['acquired', 'busy']);
        const first = claims.find(value => value.status === 'acquired')!;
        const second = await jobs.claim(key, { ...claim, now: 3001 });
        expect(second).toMatchObject({ status: 'acquired', attempt: 2 });
        if (first.status !== 'acquired' || second.status !== 'acquired') throw new Error('missing claim');
        expect(await jobs.complete(key, first.token, 3002)).toBe(false);
        expect(await jobs.complete(key, second.token, 3002)).toBe(true);
        expect(await jobs.claim(key, { ...claim, now: 9000 })).toEqual({ status: 'completed' });
        expect((await jobs.inspect({ status: 'completed' })).map(job => job.key)).toContain(key);
    });

    it('stores notifications idempotently by key and fences claims', async () => {
        const notifications = cms.notifications();
        const record = {
            id: 'n1', key: 'd'.repeat(64), channel: 'in-app' as const, status: 'queued' as const, attempt: 0, read: false, createdAt: 1, updatedAt: 1,
            recipient: { tenantId: 't', userId: 'u' }, template: 'welcome', data: {},
        };
        const created = await notifications.insert(record as never);
        expect(created.created).toBe(true);
        expect((await notifications.insert({ ...record, id: 'n2' } as never)).created).toBe(false);
        const claimed = await notifications.claim('n1', { now: 10, leaseMs: 1000 });
        expect(claimed.status).toBe('acquired');
        expect(await notifications.claim('n1', { now: 11, leaseMs: 1000 })).toEqual({ status: 'busy' });
        if (claimed.status !== 'acquired') throw new Error('missing claim');
        expect(await notifications.list({ tenantId: 't', userId: 'u' }, { limit: 10 })).toHaveLength(0);
        expect(await notifications.finish('n1', 'stale-token', { status: 'delivered', now: 12 })).toBe(false);
        expect(await notifications.finish('n1', claimed.token, { status: 'delivered', now: 12 })).toBe(true);
        expect(await notifications.list({ tenantId: 't', userId: 'u' }, { limit: 10 })).toHaveLength(1);
    });

    it('verifies credentials and resolves roles into a principal', async () => {
        await cms.users.defineRole({ id: 'editor', name: 'Editor', permissions: ['cms/posts:*', 'cms:dashboard'] });
        const user = await cms.users.create({ email: 'Editor@Example.com', name: 'Ed', password: 'correct horse', roles: ['editor'] });
        expect(user).toMatchObject({ email: 'editor@example.com', roles: ['editor'], permissions: ['cms/posts:*', 'cms:dashboard'] });
        await expect(cms.users.create({ email: 'editor@example.com', name: 'Dup', password: 'whatever1' })).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await cms.users.verifier.verify('editor@example.com', 'wrong password')).toBeNull();
        expect((await cms.users.verifier.verify('EDITOR@example.com', 'correct horse'))?.id).toBe(user.id);
        expect(await cms.users.principal(user.id)).toMatchObject({ kind: 'user', id: user.id, permissions: ['cms/posts:*', 'cms:dashboard'] });
        await cms.users.setStatus(user.id, 'disabled');
        expect(await cms.users.principal(user.id)).toBeNull();
        expect(await cms.users.verifier.verify('editor@example.com', 'correct horse')).toBeNull();
        await cms.users.setStatus(user.id, 'active');
    });

    it('signs in through the auth middleware and invalidates realtime descriptors on rotation', async () => {
        const user = await cms.users.create({ email: 'author@example.com', name: 'Author', password: 'long enough' });
        const kit = createCmsAuth(cms, { secure: false });
        const app = new Hono();
        app.use('*', kit.auth.middleware);
        app.post('/login', async c => {
            const result = await kit.signIn('author@example.com', 'long enough', c);
            if (!result) return c.text('no', 401);
            result.headers.forEach((value, name) => c.header(name, value, { append: true }));
            return c.text('ok');
        });
        app.get('/me', c => c.json({ principal: kit.principal(c) }));
        const login = await app.request('/login', { method: 'POST' });
        expect(login.status).toBe(200);
        const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
        const me = await (await app.request('/me', { headers: { cookie } })).json() as { principal: { kind: string; id?: string } };
        expect(me.principal).toMatchObject({ kind: 'user', id: user.id });
        expect((await (await app.request('/me')).json() as { principal: { kind: string } }).principal.kind).toBe('anonymous');
        // The session's start is the user's last sign-in; the upgrade step derives it from sessions.
        expect(user.lastSignInAt).toBeNull();
        const signedIn = (await cms.users.get(user.id))!.lastSignInAt;
        expect(signedIn).toBeGreaterThan(Date.now() - 60_000);
        const db = service.database();
        await db.write([{ rql: 'UPDATE cms_users SET last_sign_in_at = NULL WHERE id = $id', params: { $id: user.id } }]);
        await db.write([HOST_STEPS.find(step => step.version === 6)!.statements[1]!]);
        expect((await cms.users.get(user.id))!.lastSignInAt).toBe(signedIn);

        const token = cookie.split('=')[1]!;
        const descriptor = await kit.realtime.capture(token, user.id, context);
        expect(await kit.realtime.validate(descriptor, context)).toBe(user.id);
        const rotated = await kit.sessions.rotate(token, context);
        expect(rotated).not.toBeNull();
        expect(await kit.realtime.validate(descriptor, context)).toBeNull();
        expect(await kit.realtime.validate(await kit.realtime.capture(rotated!.session.id, user.id, context), context)).toBe(user.id);
    });

    it('finishes uploads and sweeps interrupted ones', async () => {
        const objects = new Map<string, Uint8Array>();
        const storage: StorageProvider = {
            name: 'memory',
            async put(key, body, options) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); return { key, size: options.size }; },
            async get(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! } : null; },
            async head(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length } : null; },
            async delete(key) { objects.delete(key); },
        };
        let now = 1_000;
        const files = new FileService(cms.db, storage, { now: () => now, staleMs: 100 });
        await cms.users.defineRole({ id: 'uploader', name: 'Uploader', permissions: ['cms:upload'] });
        const owner = await cms.users.create({ email: 'files@example.com', name: 'Files', roles: ['uploader'] });
        const principal = (await cms.users.principal(owner.id))!;
        const stranger = (await cms.users.principal((await cms.users.create({ email: 'stranger@example.com', name: 'Stranger', roles: ['uploader'] })).id))!;
        const body = () => new Response('hello').body!;
        const file = await files.upload({ name: 'a/../b.txt', contentType: 'text/plain', size: 5, body: body() }, { principal });
        expect(file).toMatchObject({ name: 'a_.._b.txt', size: 5, owner: owner.id });
        expect(await new Response((await files.open(file.id))!.body).text()).toBe('hello');
        // Any type is stored; a declared type with a signature must match the bytes.
        const program = await files.upload({ name: 'x.exe', contentType: 'application/x-msdownload', size: 5, body: body() }, { principal });
        expect(program).toMatchObject({ contentType: 'application/x-msdownload', size: 5 });
        await files.delete(program.id, { principal });
        await expect(files.upload({ name: 'evil.png', contentType: 'image/png', size: 5, body: body() }, { principal })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect((await files.list()).total).toBe(1);
        expect(objects.size).toBe(1);
        const limited = new FileService(cms.db, storage, { now: () => now, contentTypes: ['text/plain'] });
        await expect(limited.upload({ name: 'x.exe', contentType: 'application/x-msdownload', size: 5, body: body() }, { principal })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        // An interrupted upload: the row exists as pending and the bytes may exist.
        await cms.db.write([{ rql: "INSERT INTO cms_files (id, key, owner_id, name, content_type, size, status, created_at, updated_at) VALUES ('stuck', 'cms/files/stuck', NULL, 's', 'text/plain', 1, 'pending', 1000, 1000)" }]);
        objects.set('cms/files/stuck', new Uint8Array([1]));
        now = 2_000;
        expect(await files.sweep()).toEqual({ removed: 1 });
        expect(objects.has('cms/files/stuck')).toBe(false);
        // Uploaders edit and delete their own files only.
        await expect(files.delete(file.id, { principal: stranger })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await files.update(file.id, { alt: 'Greeting' }, { principal })).toMatchObject({ alt: 'Greeting', title: 'a_.._b' });
        await files.delete(file.id, { principal });
        expect(await files.get(file.id)).toBeNull();
        expect(objects.size).toBe(0);
    });

    it('takes uploads the browser sends itself: begin, PUT, complete', async () => {
        const objects = new Map<string, Uint8Array>();
        const storage: StorageProvider = {
            name: 'memory',
            async put(key, body, options) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); return { key, size: options.size }; },
            async get(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length, body: new Response(bytes.slice().buffer as ArrayBuffer).body! } : null; },
            async head(key) { const bytes = objects.get(key); return bytes ? { key, size: bytes.length } : null; },
            async delete(key) { objects.delete(key); },
        };
        const files = new FileService(cms.db, storage, { staleMs: 100 });
        await cms.users.defineRole({ id: 'uploader2', name: 'Direct uploader', permissions: ['cms:upload'] });
        const principal = (await cms.users.principal((await cms.users.create({ email: 'direct@example.com', name: 'Direct', roles: ['uploader2'] })).id))!;
        const stranger = (await cms.users.principal((await cms.users.create({ email: 'stranger2@example.com', name: 'Stranger', roles: ['uploader2'] })).id))!;
        const bytes = (value: string) => new Response(value).body!;
        // Without a presigning provider the bytes come through the application.
        const pending = await files.begin({ name: 'notes.txt', contentType: 'text/plain', size: 5 }, { principal });
        expect(pending).toMatchObject({ name: 'notes.txt', contentType: 'text/plain', size: 5, direct: null });
        expect(files.direct).toBe(false);
        expect(await files.get(pending.id)).toBeNull();
        await expect(files.receive(pending.id, bytes('hello'), { principal: stranger })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(files.complete(pending.id, { principal })).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: 'The upload did not finish.' });
        // The failed completion dropped the upload; a new one goes through.
        await expect(files.receive(pending.id, bytes('hello'), { principal })).rejects.toMatchObject({ code: 'CMS_NOT_FOUND' });
        const again = await files.begin({ name: 'notes.txt', contentType: 'text/plain', size: 5 }, { principal });
        await files.receive(again.id, bytes('hello'), { principal });
        const file = await files.complete(again.id, { principal });
        expect(file).toMatchObject({ id: again.id, name: 'notes.txt', size: 5, contentType: 'text/plain' });
        expect(await new Response((await files.open(file.id))!.body).text()).toBe('hello');
        // The declared size must match what arrived, and the signature the type.
        const short = await files.begin({ name: 'short.txt', contentType: 'text/plain', size: 9 }, { principal });
        await files.receive(short.id, bytes('hello'), { principal });
        await expect(files.complete(short.id, { principal })).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('5 bytes, not the 9') });
        expect(objects.has(`cms/files/${short.id}`)).toBe(false);
        const fake = await files.begin({ name: 'fake.png', contentType: 'image/png', size: 5 }, { principal });
        await files.receive(fake.id, bytes('hello'), { principal });
        await expect(files.complete(fake.id, { principal })).rejects.toMatchObject({ code: 'CMS_VALIDATION', message: expect.stringContaining('not a valid image/png') });
        // SVG is sanitized on completion, and its size follows.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><circle r="1"/></svg>';
        const drawing = await files.begin({ name: 'logo.svg', contentType: 'image/svg+xml', size: svg.length }, { principal });
        await files.receive(drawing.id, bytes(svg), { principal });
        const stored = await files.complete(drawing.id, { principal });
        const clean = await new Response((await files.open(stored.id))!.body).text();
        expect(clean).toBe('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
        expect(stored.size).toBe(clean.length);
        // A provider that presigns hands the browser the bucket's URL.
        storage.presign = async (key, options) => ({ url: `https://bucket.example/${key}?signed`, method: 'PUT', headers: { 'content-type': options.contentType!, 'content-length': String(options.size) } });
        expect(files.direct).toBe(true);
        const direct = await files.begin({ name: 'big.zip', contentType: 'application/zip', size: 3 }, { principal });
        expect(direct.direct).toEqual({ url: `https://bucket.example/cms/files/${direct.id}?signed`, method: 'PUT', headers: { 'content-type': 'application/zip', 'content-length': '3' } });
        objects.set(`cms/files/${direct.id}`, new Uint8Array([1, 2, 3]));
        expect(await files.complete(direct.id, { principal })).toMatchObject({ contentType: 'application/zip', size: 3 });
        expect((await files.list({ kind: 'archive' })).items.map(item => item.name)).toEqual(['big.zip']);
        expect((await files.list({ kind: 'document' })).items.map(item => item.name)).toEqual(['notes.txt']);
        for (const item of (await files.list()).items) await files.delete(item.id, { principal });
    });

    it('activates a plugin only when it is migrated and granted, and limits it to its grants', async () => {
        const seen: string[] = [];
        const fetched: string[] = [];
        const manifest = (version: string, resources: Record<string, string[]>) => ({
            schemaVersion: 1, name: 'support-desk', version,
            resources: [{ name: 'tickets', fields: { subject: { kind: 'string', required: true, max: 120 } }, access: { read: 'public', create: 'authenticated' } }],
            hooks: [{ point: 'cms.resource.before-write', version: 1 }],
            permissions: { resources, network: ['api.example.com'] },
            ui: { slots: { 'dashboard.nav': [{ label: 'Tickets', href: '/cms/r/support-desk/tickets' }] } },
            commands: [{ name: 'count', description: 'Count tickets.', options: { status: { type: 'string' } } }],
        });
        const plugin = (version: string, resources: Record<string, string[]>) => ({
            name: 'support-desk', version, manifest: manifest(version, resources),
            module: {
                register(context: PluginContext) {
                    context.hooks.addFilter(beforeWrite, draft => { seen.push(String(draft.subject ?? draft.title)); return draft; });
                    context.commands.add('count', async (_input, { principal }) => (await context.cms.resource('support-desk/tickets').list({}, { principal })).records.length);
                    context.commands.add('ping', async () => context.fetch('https://api.example.com/ping').then(response => response.status));
                },
            },
        });
        const { contentModule } = await import('../src/index');
        const db = service.database();
        const fetch = (async (input: RequestInfo | URL) => { fetched.push(String(input)); return new Response('pong'); }) as typeof globalThis.fetch;
        expect(() => createCMS({ db, modules: [contentModule], plugins: [plugin('1.0.0', { 'cms/posts': ['read'] })], fetch })).toThrow(/ping/);
        const v1 = { ...plugin('1.0.0', { 'cms/posts': ['read'] }), module: { register(context: PluginContext) {
            context.hooks.addFilter(beforeWrite, draft => { seen.push(String(draft.subject ?? draft.title)); return draft; });
            context.commands.add('count', async (_input, { principal }) => (await context.cms.resource('support-desk/tickets').list({}, { principal })).records.length);
            seen.push(`fetch:${typeof context.fetch}`);
            (globalThis as { __deskFetch?: typeof globalThis.fetch }).__deskFetch = context.fetch;
        } } };
        const host = createCMS({ db, modules: [contentModule], plugins: [v1], fetch });
        expect(host.resources.map(resource => resource.id).sort()).toEqual(['cms/pages', 'cms/patterns', 'cms/posts', 'support-desk/tickets']);
        expect((await host.status()).plugins[0]).toMatchObject({ active: false, reason: expect.stringContaining('migration') });
        expect((await host.migrate()).failed).toBeUndefined();
        expect((await host.status()).plugins[0]).toMatchObject({ active: false, reason: 'Not enabled.' });
        const admin = systemPrincipal('test');
        await expect(host.resource('support-desk/tickets').create({ subject: 'Too early' }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(host.runCommand('support-desk', 'count', {}, { principal: admin })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        expect(await host.slotLinks('dashboard.nav', admin)).toEqual([]);

        const status = await host.grantPlugin('support-desk', admin);
        expect(status).toMatchObject({ active: true, missing: [] });
        await host.resource('support-desk/tickets').create({ subject: 'Printer jam' }, { principal: admin });
        await host.resource('cms/posts').create({ title: 'Hello', slug: 'hello' }, { principal: admin });
        expect(seen).toEqual(['fetch:function', 'Printer jam', 'Hello']);
        expect(await host.runCommand('support-desk', 'count', {}, { principal: admin })).toBe(1);
        await expect(host.runCommand('support-desk', 'count', {}, { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_UNAUTHENTICATED' });
        expect(await host.slotLinks('dashboard.nav', admin)).toEqual([{ label: 'Tickets', href: '/cms/r/support-desk/tickets', plugin: 'support-desk' }]);
        const deskFetch = (globalThis as { __deskFetch?: typeof globalThis.fetch }).__deskFetch!;
        expect(await (await deskFetch('https://api.example.com/ping')).text()).toBe('pong');
        await expect(deskFetch('https://evil.example/steal')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(fetched).toEqual(['https://api.example.com/ping']);

        const scoped = host.pluginCms('support-desk');
        expect((await scoped.resource('cms/posts').list({}, { principal: admin })).records).toHaveLength(1);
        expect(() => scoped.resource('cms/posts').create({ title: 'x', slug: 'x' }, { principal: admin })).toThrow(/may not create/);
        expect(() => host.pluginCms('other').resource('cms/posts')).toThrow(/no grant/);

        // An upgrade that requests more access needs a new grant before it runs again.
        const v2 = { ...v1, version: '1.1.0', manifest: manifest('1.1.0', { 'cms/posts': ['read', 'update'] }) };
        const upgraded = createCMS({ db, modules: [contentModule], plugins: [v2], fetch });
        expect((await upgraded.status()).plugins[0]).toMatchObject({ active: false, missing: ['resource:cms/posts:update'], reason: expect.stringContaining('new grant') });
        seen.length = 0;
        await upgraded.resource('cms/posts').create({ title: 'Unfiltered', slug: 'unfiltered' }, { principal: admin });
        expect(seen).toEqual([]);
        await upgraded.grantPlugin('support-desk', admin);
        expect(await upgraded.pluginActive('support-desk')).toBe(true);
        await upgraded.revokePlugin('support-desk', admin);
        expect(await upgraded.pluginActive('support-desk')).toBe(false);
        await expect(upgraded.grantPlugin('support-desk', userPrincipal('u', [], ['cms:dashboard']))).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });

        const invalid = createCMS({ db, plugins: [{ name: 'bad', version: '1.0.0', manifest: { schemaVersion: 1, name: 'bad', version: '1.0.0', hooks: [{ point: 'cms.nope', version: 1 }] } }] });
        expect((await invalid.status()).plugins[0]).toMatchObject({ active: false, reason: expect.stringContaining('not a CMS extension point') });
    });

    it('runs the extension points one plugin provides for the handlers of another', async () => {
        const seen: string[] = [];
        const shop = (version: number) => ({
            name: 'shop', version: '1.0.0',
            manifest: {
                schemaVersion: 1, name: 'shop', version: '1.0.0',
                provides: [{ point: 'shop.order-placed', kind: 'action', version }, { point: 'shop.price', kind: 'filter', version: 1 }],
                commands: [{ name: 'order', description: 'Place an order.', options: { price: { type: 'number', required: true } } }],
            },
            module: {
                register(context: PluginContext) {
                    const placed = context.hooks.point<{ total: number }>('shop.order-placed', 'action');
                    const price = context.hooks.point<number, { sku: string }>('shop.price', 'filter');
                    expect(() => context.hooks.point('shop.price', 'action')).toThrow(/a filter, not an action/);
                    expect(() => context.hooks.point('cms.resource.before-write', 'filter')).toThrow(/does not declare/);
                    context.commands.add('order', async input => {
                        const total = await context.hooks.applyFilters(price, Number(input.price), { sku: 'mug' });
                        const report = await context.hooks.doAction(placed, { total });
                        return { total, handlers: report.outcomes.map(outcome => `${outcome.plugin}:${outcome.status}`) };
                    });
                },
            },
        });
        // The consumer is listed first: order never matters, the host builds every point before any register() runs.
        const loyalty = {
            name: 'loyalty', version: '1.0.0',
            manifest: { schemaVersion: 1, name: 'loyalty', version: '1.0.0', hooks: [{ point: 'shop.order-placed', version: 1 }, { point: 'shop.price', version: 1 }] },
            module: {
                register(context: PluginContext) {
                    context.hooks.addFilter(context.hooks.point<number, { sku: string }>('shop.price', 'filter'), (value, ctx) => { seen.push(`price:${ctx.input.sku}`); return value * 0.9; });
                    context.hooks.addAction(context.hooks.point<{ total: number }>('shop.order-placed', 'action'), payload => { seen.push(`placed:${payload.total}`); });
                    void expect(context.hooks.doAction(context.hooks.point<{ total: number }>('shop.order-placed', 'action'), { total: 1 })).rejects.toThrow(/does not declare in provides/);
                },
            },
        };
        const db = service.database();
        const host = createCMS({ db, plugins: [loyalty, shop(1)] });
        const admin = systemPrincipal('test');
        expect((await host.status()).plugins.map(plugin => plugin.active)).toEqual([false, false]);
        expect((await host.status()).plugins[0]).toMatchObject({ name: 'loyalty', missing: ['plugin:enabled', 'hook:shop.order-placed', 'hook:shop.price'] });
        await host.grantPlugin('shop', admin);
        // The provider runs; the consumer's handlers are registered but do nothing until its grant.
        expect(await host.runCommand('shop', 'order', { price: 10 }, { principal: admin })).toEqual({ total: 10, handlers: ['loyalty:ok'] });
        await host.grantPlugin('loyalty', admin);
        expect(await host.runCommand('shop', 'order', { price: 10 }, { principal: admin })).toEqual({ total: 9, handlers: ['loyalty:ok'] });
        expect(seen).toEqual(['price:mug', 'placed:9']);
        await host.revokePlugin('loyalty', admin);
        expect(await host.runCommand('shop', 'order', { price: 10 }, { principal: admin })).toEqual({ total: 10, handlers: ['loyalty:ok'] });

        // A point of a missing provider, or another version of it, makes the consumer invalid.
        const alone = createCMS({ db, plugins: [loyalty] });
        expect((await alone.status()).plugins[0]).toMatchObject({ name: 'loyalty', active: false, reason: expect.stringContaining('shop.order-placed is provided by no installed plugin') });
        const bumped = createCMS({ db, plugins: [shop(2), loyalty] });
        expect((await bumped.status()).plugins[1]).toMatchObject({ name: 'loyalty', active: false, reason: expect.stringContaining('shop.order-placed is version 2, not 1') });
    });
});
