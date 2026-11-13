import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('env', (_name: string, fallback: string) => fallback);
vi.stubGlobal('__', (text: string) => text);
import { Hono } from 'hono';
import { totpCode, totpStep } from '@cossackframework/auth';
import { ANONYMOUS, contentModule, createCMS, defineResource, field, systemPrincipal, userPrincipal, type CmsHost } from '../../src/server/index';
import { live, romedbService } from '../../tests/helpers';
import { editorView, entryValues, saveEntry } from '../src/cms/content';
import { draftEntry, draftMedia } from '../src/cms/site-editing';
import { entryUpdate } from '../src/cms/manage';
import { ACCESS_BACKOFF, ACCESS_GRACE, EntryRoom, clearRoomAccess, requireEntryEditor } from '../src/cms/collab/room';
import { CmsError } from '../../src/errors';
import { GET as readNotes } from '../src/pages/api/cms/content/[collection]/[entry]/notes';
import { GET as readComments } from '../src/pages/api/cms/comments/index';

const system = systemPrincipal('test');
const editor = userPrincipal('editor', ['editor'], ['cms/*', 'cms:dashboard']);
const alice = userPrincipal('alice', ['editor'], ['cms:dashboard']);
const article = defineResource({ name: 'articles', titleField: 'title', fields: {
    title: field.string(), internal: field.string({ access: { read: 'staff', write: 'staff' } }),
}, access: { read: 'authenticated', create: 'authenticated', update: 'authenticated', delete: 'authenticated' } });

describe.skipIf(!live)('editorial access', () => {
    const service = romedbService();
    let clock = Date.now();
    let cms: CmsHost;
    beforeAll(async () => {
        cms = createCMS({ db: service.database(), modules: [contentModule], resources: [article], now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        await cms.resource('app/articles').create({ title: 'Visible', internal: 'STAFF-SECRET' }, { id: 'one', principal: system });
    });

    const as = (principal: unknown) => {
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); await next(); });
        return app;
    };

    it('keeps notes to the entry\'s editors once it is published', async () => {
        await cms.resource('cms/posts').create({ title: 'Public story', status: 'published' }, { principal: system, id: 'noted' });
        await cms.notes.create({ resource: 'cms/posts', recordId: 'noted', userId: 'editor', target: 'entry', range: null, quote: 'REMOVED TEXT', body: 'INTERNAL REVIEW' });
        for (const [principal, status] of [[ANONYMOUS, 403], [userPrincipal('reader', ['subscriber'], []), 403], [editor, 200]] as const) {
            const app = as(principal);
            app.get('/:collection/:entry/notes', readNotes as never);
            const response = await app.request('/posts/noted/notes');
            expect(response.status).toBe(status);
            expect((await response.text()).includes('INTERNAL REVIEW')).toBe(status === 200);
        }
    });

    it('holds scheduling, like publishing, while notes are open', async () => {
        await cms.settings.update('writing', { requireResolvedNotes: true }, { principal: system });
        const record = await cms.resource('cms/posts').create({ title: 'Needs review' }, { principal: editor, id: 'pending' });
        await cms.notes.create({ resource: 'cms/posts', recordId: record.id, userId: 'editor', body: 'Do not publish yet' });
        const values = await entryValues(cms, await editorView(cms, 'posts'), record);
        await expect(saveEntry(cms, 'posts', record.id, { ...values, status: 'scheduled', publishedAt: new Date(clock + 60_000).toISOString().slice(0, 16) }, 'update', 1, editor)).rejects.toMatchObject({ fields: { status: 'Open notes hold publishing.' } });
        const app = as(editor);
        app.get('/', async c => { await entryUpdate(c, 'posts', record.id, { status: 'scheduled', publishedAt: clock + 60_000 }, 1); return c.text('scheduled'); });
        app.onError((error, c) => c.text((error as Error).message, 422));
        expect((await app.request('/')).status).toBe(422);
        // Any writer, not only the editor and the API: a plugin or automation writing as the system.
        await expect(cms.resource('cms/posts').update(record.id, { status: 'published' }, { principal: system, expectedRevision: 1 })).rejects.toMatchObject({ fields: { status: 'Open notes hold publishing.' } });
        clock += 61_000; await cms.runSchedule();
        expect(await cms.resource('cms/posts').get(record.id, { principal: system })).toMatchObject({ status: 'draft' });
        await cms.settings.update('writing', { requireResolvedNotes: false }, { principal: system });
    });

    it('shows a members-only entry\'s content to its editor in Live Edit', async () => {
        const record = await cms.resource('cms/posts').create({ title: 'Member story', status: 'published', membersOnly: true, content: [{ _id: 'paragraph', type: 'core/paragraph', data: { text: 'Members body' } }] }, { principal: system, id: 'member' });
        const values = await entryValues(cms, await editorView(cms, 'posts'), record);
        const preview = await draftEntry(cms, cms.collection('posts'), record, values);
        expect(preview.locked).toBeNull();
        expect(JSON.stringify(preview.content)).toContain('Members body');
    });

    it('opens the Live Edit media chooser only to the entry\'s editor, or to an appearance manager without an entry', async () => {
        const reader = userPrincipal('reader', ['subscriber'], []);
        const designer = userPrincipal('designer', ['designer'], ['cms:appearance']);
        // A draft the client forged without a collection is not a pass to the library.
        expect(await draftMedia(cms, { collection: '', id: '' }, '', reader)).toBeNull();
        expect(await draftMedia(cms, { collection: '', id: '' }, '', designer)).toEqual([]);
        expect(await draftMedia(cms, { collection: 'posts', id: 'member' }, '', reader)).toBeNull();
        expect(await draftMedia(cms, { collection: 'posts', id: 'member' }, '', editor)).toEqual([]);
        expect(await draftMedia(cms, { collection: '', id: '' }, '', ANONYMOUS)).toBeNull();
    });

    it('keeps a confirmed authenticator when another setup starts', async () => {
        const secret = await cms.security.startTotp('factor-user');
        await cms.security.confirmTotp('factor-user', await totpCode(secret, totpStep(clock)));
        await expect(cms.security.startTotp('factor-user')).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(await cms.security.requiresCode('factor-user')).toBe(true);
        expect(await cms.security.verifyCode('factor-user', await totpCode(secret, totpStep(clock) + 1))).toBe('totp');
    });

    it('keeps fields with their own access rule out of the editing room', async () => {
        const room = new EntryRoom() as unknown as { c: unknown; broadcastEvent: () => void; join: EntryRoom['join']; set: EntryRoom['set']; editorsTimer?: ReturnType<typeof setInterval>; persistTimer?: ReturnType<typeof setTimeout> };
        room.broadcastEvent = () => {};
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, alice as never); room.c = c; await next(); });
        app.get('/:collection/:id', requireEntryEditor, async c => c.json(await room.join('peer_alice', {})));
        app.get('/:collection/:id/set', requireEntryEditor, async c => c.json(await room.set('peer_alice', 'internal', 'UNAUTHORIZED CHANGE')));
        try {
            const response = await app.request('/app.articles/one');
            expect(response.status).toBe(200);
            const snapshot = await response.json() as { values: Record<string, unknown> };
            expect(snapshot.values.title).toBe('Visible');
            expect(snapshot.values).not.toHaveProperty('internal');
            expect(await (await app.request('/app.articles/one/set')).json()).toEqual({ applied: false });
        } finally { clearInterval(room.editorsTimer); clearTimeout(room.persistTimer); }
    });

    it('refuses room calls that name another user\'s peer', async () => {
        const room = new EntryRoom() as unknown as { c: unknown; broadcastEvent: (...args: unknown[]) => void; join: EntryRoom['join']; set: EntryRoom['set']; leave: EntryRoom['leave']; presence: EntryRoom['presence']; draft: EntryRoom['draft']; editorsTimer?: ReturnType<typeof setInterval>; persistTimer?: ReturnType<typeof setTimeout> };
        const told: unknown[][] = [];
        room.broadcastEvent = (...args: unknown[]) => { told.push(args); };
        let principal = alice;
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); room.c = c; await next(); });
        app.get('/:collection/:id/join/:peer', requireEntryEditor, async c => c.json(await room.join(c.req.param('peer'), {})));
        app.get('/:collection/:id/set/:peer', requireEntryEditor, async c => c.json(await room.set(c.req.param('peer'), 'title', c.req.query('title'))));
        app.get('/:collection/:id/leave/:peer', requireEntryEditor, async c => { await room.leave(c.req.param('peer')); return c.json(null); });
        app.get('/:collection/:id/peers', requireEntryEditor, async c => c.json((await room.draft()).peers.map(peer => peer.peer)));
        try {
            expect((await app.request('/app.articles/one/join/peer_alice')).status).toBe(200);
            principal = editor;
            expect((await app.request('/app.articles/one/join/peer_editor')).status).toBe(200);
            // The editor learned Alice's peer ID from her presence; changes in her name are refused.
            told.length = 0;
            expect(await (await app.request('/app.articles/one/set/peer_alice?title=Forged')).json()).toEqual({ applied: false });
            await app.request('/app.articles/one/leave/peer_alice');
            expect(told).toEqual([]);
            expect(await (await app.request('/app.articles/one/peers')).json()).toEqual(expect.arrayContaining(['peer_alice', 'peer_editor']));
            // Joining under her ID is refused too; their own peer works.
            expect((await app.request('/app.articles/one/join/peer_alice')).status).toBe(500);
            expect(await (await app.request('/app.articles/one/set/peer_editor?title=Own')).json()).toEqual({ applied: true });
            principal = alice;
            expect(await (await app.request('/app.articles/one/set/peer_alice?title=Hers')).json()).toEqual({ applied: true });
        } finally { clearInterval(room.editorsTimer); clearTimeout(room.persistTimer); }
    });

    it('keeps a live peer its ID however many fresh IDs another user claims', async () => {
        const room = new EntryRoom() as unknown as { c: unknown; broadcastEvent: (...args: unknown[]) => void; join: EntryRoom['join']; set: EntryRoom['set']; leave: EntryRoom['leave']; presence: EntryRoom['presence']; editorsTimer?: ReturnType<typeof setInterval>; persistTimer?: ReturnType<typeof setTimeout> };
        room.broadcastEvent = () => {};
        let principal = alice;
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); room.c = c; await next(); });
        app.get('/:collection/:id/join/:peer', requireEntryEditor, async c => c.json(await room.join(c.req.param('peer'), {}).then(() => true, () => false)));
        app.get('/:collection/:id/presence/:peer', requireEntryEditor, async c => { await room.presence(c.req.param('peer'), {}); return c.json(null); });
        app.get('/:collection/:id/set/:peer', requireEntryEditor, async c => c.json(await room.set(c.req.param('peer'), 'title', c.req.query('title'))));
        try {
            expect(await (await app.request('/app.articles/one/join/peer_victim')).json()).toBe(true);
            principal = editor;
            for (let i = 0; i < 10_000; i++) await app.request(`/app.articles/one/presence/flood_${String(i).padStart(5, '0')}`);
            // Past a user's share, fresh IDs are refused, and the live peer keeps its ID.
            expect(await (await app.request('/app.articles/one/join/flood_extra_1')).json()).toBe(false);
            expect(await (await app.request('/app.articles/one/set/peer_victim?title=Forged')).json()).toEqual({ applied: false });
            principal = alice;
            expect(await (await app.request('/app.articles/one/set/peer_victim?title=Hers')).json()).toEqual({ applied: true });
        } finally { clearInterval(room.editorsTimer); clearTimeout(room.persistTimer); }
    }, 120_000);

    it('keeps a timed-out tab its ID, so nobody who heard it can take it over', async () => {
        const room = new EntryRoom() as unknown as { c: unknown; broadcastEvent: () => void; join: EntryRoom['join']; set: EntryRoom['set']; presence: EntryRoom['presence']; roomPeers: Map<string, { at: number }>; presenceChanged: () => void; editorsTimer?: ReturnType<typeof setInterval>; persistTimer?: ReturnType<typeof setTimeout> };
        room.broadcastEvent = () => {};
        let principal = alice;
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); room.c = c; await next(); });
        app.get('/:collection/:id/join/:peer', requireEntryEditor, async c => c.json(await room.join(c.req.param('peer'), {}).then(() => true, () => false)));
        app.get('/:collection/:id/presence/:peer', requireEntryEditor, async c => { await room.presence(c.req.param('peer'), {}); return c.json(null); });
        app.get('/:collection/:id/set/:peer', requireEntryEditor, async c => c.json(await room.set(c.req.param('peer'), 'title', c.req.query('title'))));
        try {
            expect(await (await app.request('/app.articles/one/join/peer_sleepy')).json()).toBe(true);
            // Her background tab falls silent and times out of the room.
            room.roomPeers.get('peer_sleepy')!.at = 0;
            room.presenceChanged();
            expect(room.roomPeers.has('peer_sleepy')).toBe(false);
            principal = editor;
            await app.request('/app.articles/one/presence/peer_sleepy');
            expect(await (await app.request('/app.articles/one/join/peer_sleepy')).json()).toBe(false);
            expect(await (await app.request('/app.articles/one/set/peer_sleepy?title=Forged')).json()).toEqual({ applied: false });
            // Her tab wakes up and takes its place again.
            principal = alice;
            expect(await (await app.request('/app.articles/one/join/peer_sleepy')).json()).toBe(true);
            expect(await (await app.request('/app.articles/one/set/peer_sleepy?title=Back')).json()).toEqual({ applied: true });
        } finally { clearInterval(room.editorsTimer); clearTimeout(room.persistTimer); }
    });

    it('lets a tab that left free its ID, and a user reuse their share', async () => {
        const room = new EntryRoom() as unknown as { c: unknown; broadcastEvent: () => void; join: EntryRoom['join']; leave: EntryRoom['leave']; editorsTimer?: ReturnType<typeof setInterval>; persistTimer?: ReturnType<typeof setTimeout> };
        room.broadcastEvent = () => {};
        let principal = alice;
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); room.c = c; await next(); });
        app.get('/:collection/:id/join/:peer', requireEntryEditor, async c => c.json(await room.join(c.req.param('peer'), {}).then(() => true, () => false)));
        app.get('/:collection/:id/leave/:peer', requireEntryEditor, async c => { await room.leave(c.req.param('peer')); return c.json(null); });
        try {
            // Tabs that join and leave never use up the user's share.
            for (let i = 0; i < 60; i++) {
                expect(await (await app.request(`/app.articles/one/join/tab_${String(i).padStart(4, '0')}`)).json()).toBe(true);
                await app.request(`/app.articles/one/leave/tab_${String(i).padStart(4, '0')}`);
            }
            // An ID given up is free for anyone.
            principal = editor;
            expect(await (await app.request('/app.articles/one/join/tab_0000')).json()).toBe(true);
        } finally { clearInterval(room.editorsTimer); clearTimeout(room.persistTimer); }
    });

    it('refuses Custom HTML from a room editor who may not post HTML', async () => {
        await cms.resource('cms/pages').create({ title: 'Shared page', content: [{ _id: 'h1', type: 'core/html', data: { html: '<p>ok</p>' } }] }, { principal: system, id: 'shared' });
        const room = new EntryRoom() as unknown as { c: unknown; broadcastEvent: () => void; tree: EntryRoom['tree']; editorsTimer?: ReturnType<typeof setInterval>; persistTimer?: ReturnType<typeof setTimeout> };
        room.broadcastEvent = () => {};
        let principal = editor;
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); room.c = c; await next(); });
        app.post('/:collection/:id', requireEntryEditor, async c => c.json(await room.tree(`peer_${principal.id}`, await c.req.json())));
        const op = (body: unknown) => app.request('/pages/shared', { method: 'POST', body: JSON.stringify(body) }).then(response => response.json() as Promise<{ applied: boolean }>);
        const script = { _id: 'h2', type: 'core/html', data: { html: '<script>x</script>' } };
        try {
            expect(await op({ kind: 'insert', field: 'content', block: script, parent: null, after: null })).toMatchObject({ applied: false });
            expect(await op({ kind: 'patch', field: 'content', id: 'h1', path: 'data.html', value: '<script>x</script>' })).toMatchObject({ applied: false });
            expect(await op({ kind: 'insert', field: 'content', block: { _id: 'p1', type: 'core/paragraph', data: { text: 'Fine' } }, parent: null, after: 'h1' })).toMatchObject({ applied: true });
            principal = userPrincipal('admin', ['admin'], ['*']);
            expect(await op({ kind: 'insert', field: 'content', block: script, parent: null, after: null })).toMatchObject({ applied: true });
        } finally { clearInterval(room.editorsTimer); clearTimeout(room.persistTimer); }
    });

    it('leaves out of an editor the fields they may not read or change, and names them for the room', async () => {
        const staff = userPrincipal('sam', ['staff'], ['cms:dashboard', 'staff']);
        const names = async (principal?: typeof alice) => (await editorView(cms, 'app.articles', principal)).fields.map(field => field.name);
        expect(await names(alice)).not.toContain('internal');
        expect(await names(staff)).toContain('internal');
        expect((await editorView(cms, 'app.articles', alice)).restricted).toEqual(['internal']);
    });

    it('saves an editor\'s visible changes without the fields they may not write', async () => {
        const record = await cms.resource('app/articles').get('one', { principal: alice });
        const values = await entryValues(cms, await editorView(cms, 'app.articles'), record);
        const saved = await saveEntry(cms, 'app.articles', 'one', { ...values, title: 'A harmless title edit' }, 'update', record!.rev, alice);
        expect(saved.title).toBe('A harmless title edit');
        expect(await cms.resource('app/articles').get('one', { principal: system })).toMatchObject({ title: 'A harmless title edit', internal: 'STAFF-SECRET' });
    });

    it('keeps a locked entry\'s comments as locked as its content', async () => {
        await cms.resource('cms/posts').create({ title: 'Members talk', status: 'published', membersOnly: true }, { principal: system, id: 'talk' });
        await cms.comments.create({ id: '0190f0e0-0000-7000-8000-000000000001', resource: 'cms/posts', recordId: 'talk', parentId: null, userId: null, content: 'MEMBERS ONLY WORDS', authorName: 'Ann', authorEmail: 'ann@example.com', authorUrl: '', status: 'approved', ipHash: null, userAgent: null });
        for (const [principal, status] of [[ANONYMOUS, 404], [userPrincipal('member', ['subscriber'], []), 200]] as const) {
            const app = as(principal);
            app.get('/comments', readComments as never);
            const response = await app.request('/comments?collection=posts&entry=talk');
            expect(response.status).toBe(status);
            if (status === 200) expect(response.headers.get('cache-control')).toBe('private, no-store');
        }
        await expect(cms.postComment({ collection: 'posts', entry: 'noted', content: 'Hello', authorName: 'A', authorEmail: 'a@example.com' }, { principal: ANONYMOUS })).resolves.toBeDefined();
    });

    it('holds anonymous comments that only claim an approved email, and lets one through per address at once', async () => {
        await cms.settings.update('discussion', { moderation: 'first', requireNameEmail: true }, { principal: system });
        const posted = await cms.postComment({ collection: 'posts', entry: 'noted', content: 'Spam claiming to be Ann', authorName: 'Ann', authorEmail: 'ann@example.com' }, { principal: ANONYMOUS, ip: '203.0.113.9' });
        expect(posted.comment.status).toBe('pending');
        const burst = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => cms.postComment({ collection: 'posts', entry: 'noted', content: `Burst ${i}`, authorName: 'B', authorEmail: 'b@example.com' }, { principal: ANONYMOUS, ip: '203.0.113.10' })));
        expect(burst.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    });
    it('keeps an editor in the room through a failed access check, and closes it on a definite refusal', async () => {
        const app = new Hono();
        let principal = alice;
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, principal as never); await next(); });
        app.get('/:collection/:id', requireEntryEditor, c => c.text('ok'));
        const resource = cms.resource('app/articles');
        const now = vi.spyOn(Date, 'now');
        let clock = Date.UTC(2031, 0, 1);
        now.mockImplementation(() => clock);
        try {
            expect((await app.request('/app.articles/one')).status).toBe(200);
            // Past the cached answer, the entry read fails once: the earlier answer stands.
            clock += 10_000;
            const get = vi.spyOn(resource, 'get').mockRejectedValueOnce(new Error('connection reset'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect((await app.request('/app.articles/one')).status).toBe(200);
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
            // Frames during the outage do not read again until the backoff passes; then it reads and still allows.
            expect((await app.request('/app.articles/one')).status).toBe(200);
            expect(get).toHaveBeenCalledTimes(1);
            clock += ACCESS_BACKOFF + 1;
            expect((await app.request('/app.articles/one')).status).toBe(200);
            expect(get).toHaveBeenCalledTimes(2);
            get.mockRestore();
            // A user without a cached answer is refused when the check fails.
            principal = userPrincipal('room-newcomer', ['editor'], ['cms:dashboard', 'cms/*']);
            vi.spyOn(resource, 'get').mockRejectedValueOnce(new Error('connection reset'));
            expect((await app.request('/app.articles/one')).status).not.toBe(200);
            // A missing entry is a definite refusal, even with an earlier answer.
            principal = alice;
            clock += 10_000;
            expect((await app.request('/app.articles/missing-entry')).status).not.toBe(200);
        } finally { now.mockRestore(); vi.restoreAllMocks(); }
    });

    it('keeps an earlier yes through an outage only for a while, and refuses an inactive plugin or pending migration', async () => {
        clearRoomAccess();
        const app = new Hono();
        app.use('*', async (c, next) => { c.set('cms' as never, cms as never); c.set('principal' as never, alice as never); await next(); });
        app.get('/:collection/:id', requireEntryEditor, c => c.text('ok'));
        const resource = cms.resource('app/articles');
        const now = vi.spyOn(Date, 'now');
        let clock = Date.UTC(2031, 6, 1);
        now.mockImplementation(() => clock);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect((await app.request('/app.articles/one')).status).toBe(200);
            // The database stays down: one read per backoff, and the earlier yes holds until the grace runs out.
            const get = vi.spyOn(resource, 'get').mockRejectedValue(new CmsError('CMS_UNAVAILABLE', 'database down'));
            let reads = 0;
            for (let elapsed = 6000; elapsed <= ACCESS_GRACE; elapsed += 250) {
                clock = Date.UTC(2031, 6, 1) + elapsed;
                expect((await app.request('/app.articles/one')).status).toBe(200);
            }
            reads = get.mock.calls.length;
            expect(reads).toBeLessThanOrEqual(Math.ceil((ACCESS_GRACE - 6000) / ACCESS_BACKOFF) + 1);
            clock = Date.UTC(2031, 6, 1) + ACCESS_GRACE + ACCESS_BACKOFF + 1;
            expect((await app.request('/app.articles/one')).status).toBe(403);
            get.mockRestore();
            // A plugin turned off (or a migration pending) is a lasting answer: refused at once, whatever was allowed before.
            clearRoomAccess();
            clock += 60_000;
            expect((await app.request('/app.articles/one')).status).toBe(200);
            clock += 10_000;
            vi.spyOn(resource, 'get').mockRejectedValueOnce(new CmsError('CMS_UNAVAILABLE', 'Plugin shop is not active.', { lasting: true }));
            expect((await app.request('/app.articles/one')).status).toBe(403);
        } finally { now.mockRestore(); vi.restoreAllMocks(); clearRoomAccess(); }
    });
});
