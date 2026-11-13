/**
 * The live limits suite (specs/cms-invariants.md, Testing): long rich text, many translations,
 * many collections, concurrent saves and bulk reads against a local RomeDB service, with every
 * request the CMS sends recorded and held to the binding's budgets.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_STATEMENTS, statementBytes, type BatchResult, type RomeDB, type Statement } from '@cossackframework/romedb';
import { contentModule, createCMS, field, readCatalog, saveBytes, type CmsHost, type Principal } from '../src/server/index';
import { live, romedbService } from './helpers';

interface Recorded { readonly kind: 'read' | 'write'; readonly statements: number; readonly requestBytes: number; readonly resultBytes: number }

const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item) ?? '';

/** The binding, with every completed request's size noted. */
function recording(db: RomeDB): { db: RomeDB; log: Recorded[] } {
    const log: Recorded[] = [];
    const note = (kind: Recorded['kind'], statements: Statement[], result: BatchResult) => {
        log.push({ kind, statements: statements.length, requestBytes: statementBytes(statements), resultBytes: new TextEncoder().encode(json(result.results)).length });
        return result;
    };
    const wrapped = new Proxy(db, {
        get(target, property) {
            if (property === 'read') return async (statements: Statement[], options?: unknown) => note('read', statements, await target.read(statements, options as never));
            if (property === 'write') return async (statements: Statement[], options?: unknown) => note('write', statements, await target.write(statements, options as never));
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
    });
    return { db: wrapped, log };
}

const admin: Principal = { kind: 'user', id: 'admin-1', roles: ['admin'], permissions: ['*'] };

/** Rich text with headings, marks, links and lists: `n` sections of each. */
function richContent(n: number, salt = '') {
    const section = (i: number) => [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${i}${salt}` }] },
        { type: 'paragraph', content: [
            { type: 'text', text: `Lorem "ipsum" dolor sit amet ${i}, ` },
            { type: 'text', marks: [{ type: 'bold' }], text: 'bold words' },
            { type: 'text', text: ' and ' },
            { type: 'text', marks: [{ type: 'italic' }], text: 'italic ones' },
            { type: 'text', text: ' with a ' },
            { type: 'text', marks: [{ type: 'link', attrs: { href: `https://example.com/page-${i}` } }], text: 'link' },
            { type: 'text', text: '.' },
        ] },
        { type: 'bulletList', content: ['One item', 'Another item'].map(text => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) },
    ];
    return [{ _id: 'r', type: 'core/richtext', data: { text: { type: 'doc', content: Array.from({ length: n }, (_, i) => section(i)).flat() } } }];
}

describe.skipIf(!live)('RomeDB limits', () => {
    const service = romedbService();
    let clock = Date.UTC(2026, 10, 11, 9, 0);
    let cms: CmsHost;
    let log: Recorded[];
    let requestLimit = 0;
    let resultLimit = 0;

    beforeAll(async () => {
        const recorded = recording(service.database());
        log = recorded.log;
        cms = createCMS({ db: recorded.db, modules: [contentModule], now: () => clock });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready({ force: true });
        requestLimit = await cms.db.maxRequestBytes();
        resultLimit = await cms.db.maxResultBytes();
    }, 60_000);

    // Every request the CMS sent fit the binding's budgets.
    afterEach(() => {
        const over = log.filter(entry => entry.statements > MAX_STATEMENTS || entry.requestBytes > requestLimit || entry.resultBytes > resultLimit);
        log.length = 0;
        expect(over).toEqual([]);
    });

    it('saves the largest rich text the draft cap takes, and refuses one section more plainly', async () => {
        const posts = cms.resource('cms/posts');
        const fits = async (n: number) => cms.drafts.save('cms/posts', 'long', { baseRev: 1, values: { title: 'Long', content: richContent(n) }, versions: {}, editors: [] }).then(() => true, error => {
            expect(error).toMatchObject({ code: 'CMS_LIMIT', message: expect.stringContaining('too large') });
            return false;
        });
        let n = 1;
        while (await fits(n + 1)) n++;
        expect(n).toBeGreaterThan(5);
        // The largest draft the cap takes: created, edited and published as an entry.
        const post = await posts.create({ title: 'Long', content: richContent(n) }, { principal: admin });
        const edited = await posts.update(post.id, { title: 'Long, edited', content: richContent(n, '!') }, { principal: admin, expectedRevision: post.rev });
        const published = await posts.update(post.id, { status: 'published' }, { principal: admin, expectedRevision: edited.rev });
        expect(published).toMatchObject({ status: 'published', title: 'Long, edited' });
        // Far past the cap, the save is refused with a message, never a raw RomeDB error.
        await expect(posts.update(post.id, { content: richContent(n * 2) }, { principal: admin, expectedRevision: published.rev }))
            .rejects.toMatchObject({ code: 'CMS_LIMIT', message: expect.stringContaining('too large to save') });
        // One section more is refused by the cap; the save of it either fits or is refused as plainly.
        expect(await fits(n + 1)).toBe(false);
        await posts.update(post.id, { content: richContent(n + 1) }, { principal: admin, expectedRevision: published.rev }).then(
            saved => expect(saved.rev).toBe(published.rev + 1),
            error => expect(error).toMatchObject({ code: 'CMS_LIMIT', message: expect.stringContaining('too large to save') }));
    }, 120_000);

    it('gives eight translations a changed shared field with their own revision, audit, search and event rows', async () => {
        clock += 1000;
        await cms.saveCollection({ name: 'manuals', label: 'Manuals', singular: 'Manual', icon: 'book', path: 'manuals', features: {},
            fields: { specs: field.string({ nullable: true, max: 8000, translatable: false, search: true, label: 'Specifications' }), notes: field.text({ nullable: true, search: true, label: 'Notes' }) } }, admin);
        const languages = ['fr', 'de', 'es', 'it', 'nl', 'pt', 'pl', 'sv'];
        await cms.saveLanguages({ default: 'en', others: languages }, admin);
        const manuals = cms.resource('cms/manuals');
        const specs = 'Steel frame, 240 V, 3 kg. '.repeat(160);
        const original = await manuals.create({ title: 'Manual', specs, notes: 'English notes. '.repeat(100), status: 'published' }, { principal: admin });
        const translations = [];
        for (const locale of languages) {
            const draft = await cms.translateEntry('manuals', original.id, locale, admin);
            translations.push(await manuals.update(draft.id, { notes: `${locale} notes. `.repeat(100), status: 'published' }, { principal: admin, expectedRevision: draft.rev }));
        }
        await cms.outbox.dispatch({ limit: 100 });
        const changed = `Aluminium frame, 110 V, 2 kg. ${'Lighter. '.repeat(200)}`;
        const saved = await manuals.update(original.id, { specs: changed }, { principal: admin, expectedRevision: (await manuals.get(original.id, { principal: admin }))!.rev });
        for (let round = 0; round < 5; round++) await cms.outbox.dispatch({ limit: 100 });
        const ids = translations.map(translation => translation.id);
        const list = ids.map((_, i) => `$i${i}`).join(', ');
        const params = Object.fromEntries(ids.map((id, i) => [`$i${i}`, id]));
        const [revisions, audits, search, events] = (await cms.db.read([
            { rql: `SELECT record_id, revision FROM cms_revisions WHERE resource = 'cms/manuals' AND record_id IN (${list})`, params },
            { rql: `SELECT record_id, revision FROM cms_audit WHERE resource = 'cms/manuals' AND action = 'update' AND record_id IN (${list})`, params },
            { rql: `SELECT entry, text FROM cms_search WHERE collection = 'manuals' AND entry IN (${list})`, params },
            { rql: "SELECT payload FROM cms_outbox WHERE topic = 'resource.updated'" },
        ])).results;
        for (const translation of translations) {
            const next = translation.rev + 1;
            expect(await manuals.get(translation.id, { principal: admin })).toMatchObject({ specs: changed, rev: next });
            expect(revisions!.rows.some(row => row[0] === translation.id && Number(row[1]) === next)).toBe(true);
            expect(audits!.rows.some(row => row[0] === translation.id && Number(row[1]) === next)).toBe(true);
            expect(String(search!.rows.find(row => row[0] === translation.id)?.[1] ?? '')).toContain('Aluminium frame');
            const event = events!.rows.map(row => JSON.parse(row[0] as string) as { id: string; revision: number; record: { specs?: string } })
                .find(entry => entry.id === translation.id && entry.revision === next);
            expect(event?.record.specs).toBe(changed);
        }
        expect(saved.specs).toBe(changed);
        await cms.saveLanguages({ default: 'en', others: [] }, admin);
    }, 180_000);

    it('caps a draft of a shared field at what still saves to every translation', async () => {
        clock += 1000;
        await cms.saveCollection({ name: 'kits', label: 'Kits', singular: 'Kit', icon: 'box', path: 'kits', features: {},
            fields: { parts: field.json({ nullable: true, translatable: false, label: 'Parts' }) } }, admin);
        await cms.saveLanguages({ default: 'en', others: ['fr'] }, admin);
        const kits = cms.resource('cms/kits');
        const original = await kits.create({ title: 'Kit' }, { principal: admin });
        await cms.translateEntry('kits', original.id, 'fr', admin);
        const parts = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ id: i, name: `Part "${i}"`, size: [i, i + 1, i + 2] })) });
        const limit = await cms.db.maxRequestBytes();
        let n = 1;
        while (saveBytes({ parts: parts(n + 1) }, ['parts']) <= limit && n < 10_000) n++;
        // Counting the shared copy refuses what the plain count still takes.
        expect(saveBytes({ parts: parts(n + 1) })).toBeLessThanOrEqual(limit);
        await expect(cms.drafts.save('cms/kits', original.id, { baseRev: 1, values: { parts: parts(n + 1) }, versions: {}, editors: [] })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        await expect(cms.autosaves.save('cms/kits', original.id, 'admin-1', { parts: parts(n + 1) })).rejects.toMatchObject({ code: 'CMS_LIMIT' });
        // The largest draft the cap takes saves, to the entry and its translation.
        await cms.drafts.save('cms/kits', original.id, { baseRev: 1, values: { parts: parts(n) }, versions: {}, editors: [] });
        const current = (await kits.get(original.id, { principal: admin }))!;
        const saved = await kits.update(original.id, { parts: parts(n) }, { principal: admin, expectedRevision: current.rev });
        expect((saved.parts as { items: unknown[] }).items).toHaveLength(n);
        await cms.saveLanguages({ default: 'en', others: [] }, admin);
    }, 120_000);

    it('reads an entry\'s revisions, notes and comments past the result budget in pages', async () => {
        clock += 1000;
        const post = await cms.resource('cms/posts').create({ title: 'Discussed' }, { principal: admin });
        // Rows of about a twentieth of the result budget, half again as many as one read can carry.
        const size = Math.floor(resultLimit / 20);
        const count = 30;
        const text = (i: number) => `${i} `.padEnd(size, 'x');
        const insert = async (statement: (i: number) => { rql: string; params: Record<string, string | number> }) => {
            const perWrite = Math.max(1, Math.floor(requestLimit / (2 * size)));
            for (let i = 0; i < count; i += perWrite) await cms.db.write(Array.from({ length: Math.min(perWrite, count - i) }, (_, j) => statement(i + j)) as never);
        };
        await insert(i => ({ rql: "INSERT INTO cms_revisions (id, resource, record_id, revision, data, actor, at) VALUES ($id, 'cms/posts', $record, $revision, $data, NULL, $at)",
            params: { $id: `cms/posts:${post.id}:${100 + i}`, $record: post.id, $revision: 100 + i, $data: JSON.stringify({ title: 'Discussed', excerpt: text(i) }), $at: clock + i } }));
        await insert(i => ({ rql: "INSERT INTO cms_notes (id, resource, record_id, parent_id, user_id, target, text_range, quoted, body, status, created_at, updated_at) VALUES ($id, 'cms/posts', $record, NULL, 'admin-1', 'entry', NULL, '', $body, 'open', $at, $at)",
            params: { $id: `note-${i}`, $record: post.id, $body: text(i), $at: clock + i } }));
        await insert(i => ({ rql: "INSERT INTO cms_comments (id, resource, record_id, parent_id, user_id, author_name, author_email, author_url, content, status, created_at, updated_at) VALUES ($id, 'cms/posts', $record, NULL, NULL, 'Reader', 'reader@example.com', '', $content, 'approved', $at, $at)",
            params: { $id: `comment-${i}`, $record: post.id, $content: text(i), $at: clock + i } }));
        expect((await cms.resource('cms/posts').revisions(post.id, { principal: admin }, { limit: 50 })).length).toBeGreaterThanOrEqual(count);
        expect(await cms.notes.forEntry('cms/posts', post.id)).toHaveLength(count);
        expect(await cms.comments.forEntry('cms/posts', post.id)).toHaveLength(count);
    }, 120_000);

    it('reads lists of large rows past the result budget in pages: search, records, users, comments, menus, areas, terms', async () => {
        clock += 1000;
        const posts = cms.resource('cms/posts');
        // Rows of about a twentieth of the result budget, half again as many as one read can carry.
        const size = Math.floor(resultLimit / 20);
        const count = 30;
        const text = (i: number) => `${i} `.padEnd(size, 'x');
        const perWrite = Math.max(1, Math.floor(requestLimit / (2 * size)));
        const insert = async (statement: (i: number) => { rql: string; params: Record<string, string | number> }) => {
            for (let i = 0; i < count; i += perWrite) await cms.db.write(Array.from({ length: Math.min(perWrite, count - i) }, (_, j) => statement(i + j)) as never);
        };
        // Posts must each fit one save request, so they are half as large and twice as many.
        let sections = 1;
        while (JSON.stringify(richContent(sections + 1)).length < size / 2) sections++;
        const ids: string[] = [];
        for (let i = 0; i < 2 * count; i++) ids.push((await posts.create({ title: `Budgetword ${i}`, content: richContent(sections), status: 'published' }, { principal: admin })).id);
        expect(await posts.search('Budgetword', { limit: 2 * count }, { principal: admin })).toHaveLength(2 * count);
        expect((await posts.getMany(ids, { principal: admin })).size).toBe(2 * count);
        await insert(i => ({ rql: "INSERT INTO cms_users (id, email, name, avatar, status, created_at, updated_at, last_sign_in_at, meta, slug) VALUES ($id, $email, 'Wide', NULL, 'active', $at, $at, NULL, $meta, NULL)",
            params: { $id: `wide-user-${i}`, $email: `wide${i}@example.com`, $meta: JSON.stringify({ bio: text(i) }), $at: clock + i } }));
        expect((await cms.users.getMany(Array.from({ length: count }, (_, i) => `wide-user-${i}`))).size).toBe(count);
        // Roles with long permission lists: every user holding one reads it once, and the roles list pages.
        const permissions = (i: number) => JSON.stringify(Array.from({ length: Math.ceil(size / 40) }, (_, j) => `cms/wide-${i}-${String(j).padStart(4, '0')}:read`));
        await insert(i => ({ rql: 'INSERT INTO cms_roles (id, name, permissions, created_at) VALUES ($id, $name, $permissions, $at)',
            params: { $id: `wide-role-${i}`, $name: `Wide role ${i}`, $permissions: permissions(i), $at: clock + i } }));
        await insert(i => ({ rql: 'INSERT INTO cms_user_roles (user_id, role_id) VALUES ($user, $role)', params: { $user: `wide-user-${i}`, $role: 'wide-role-0' } }));
        const holders = await cms.users.getMany(Array.from({ length: count }, (_, i) => `wide-user-${i}`));
        expect([...holders.values()].every(user => user.assignments.some(role => role.id === 'wide-role-0'))).toBe(true);
        expect((await cms.users.roles({ limit: 200 })).filter(role => role.id.startsWith('wide-role-'))).toHaveLength(count);
        await insert(i => ({ rql: "INSERT INTO cms_comments (id, resource, record_id, parent_id, user_id, author_name, author_email, author_url, content, status, created_at, updated_at) VALUES ($id, 'cms/posts', $record, NULL, NULL, 'Spammer', 'spam@example.com', '', $content, 'pending', $at, $at)",
            params: { $id: `pending-${i}`, $record: ids[0]!, $content: text(i), $at: clock + i } }));
        expect((await cms.comments.list({ status: 'pending', limit: count })).items).toHaveLength(count);
        const item = (i: number) => ({ id: `m${i}`, kind: 'custom', label: text(i).slice(0, 200), url: '/', children: [] });
        await insert(i => ({ rql: 'INSERT INTO cms_menus (id, name, items, revision, created_at, updated_at) VALUES ($id, $name, $items, 1, $at, $at)',
            params: { $id: `wide-menu-${i}`, $name: `Wide ${i}`, $items: JSON.stringify(Array.from({ length: Math.ceil(size / 260) }, (_, j) => item(j))), $at: clock + i } }));
        expect((await cms.menus.list()).filter(menu => menu.name.startsWith('Wide '))).toHaveLength(count);
        await insert(i => ({ rql: 'INSERT INTO cms_areas (name, blocks, revision, updated_at) VALUES ($name, $blocks, 1, $at)',
            params: { $name: `wide-area-${i}`, $blocks: JSON.stringify([{ _id: `p${i}`, type: 'core/paragraph', data: { text: text(i) } }]), $at: clock + i } }));
        expect((await cms.areas.get('wide-area-0')).blocks).toHaveLength(1);
        await insert(i => ({ rql: "INSERT INTO cms_terms (id, taxonomy, name, slug, description, parent_id, path, depth, created_at, updated_at, icon, meta) VALUES ($id, 'categories', $name, $slug, $description, NULL, $path, 0, $at, $at, '', '{}')",
            params: { $id: `wide-term-${i}`, $name: `Wide ${i}`, $slug: `wide-${i}`, $description: text(i), $path: `/wide-term-${i}`, $at: clock + i } }));
        expect((await cms.taxonomies.list('categories', { search: 'Wide', limit: count })).items).toHaveLength(count);
        expect((await cms.taxonomies.getMany(Array.from({ length: count }, (_, i) => `wide-term-${i}`))).size).toBe(count);
    }, 180_000);

    it('saves and reads forty collections while other writes land, and plans nothing more after', async () => {
        await cms.db.write([{ rql: 'CREATE TABLE limits_noise (id INTEGER PRIMARY KEY, at INTEGER NOT NULL)' }]);
        let done = false;
        let next = 0;
        // Two writers, as sessions, drafts and the outbox write on a busy site: about 80 writes a
        // second. (Back to back with no pause, they hold off a migration's DDL for RomeDB's whole
        // 15-second deadline: the service lock lets writers pass a waiting schema change.)
        const noise = Promise.all([0, 1].map(async () => {
            while (!done) {
                await cms.db.write([{ rql: 'INSERT INTO limits_noise (id, at) VALUES ($id, $at)', params: { $id: ++next, $at: Date.now() } }]);
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }));
        try {
            for (let i = 0; i < 40; i++) {
                clock += 1000;
                await cms.saveCollection({ name: `catalog${i}`, label: `Catalog ${i}`, singular: `Item ${i}`, icon: 'box', path: `catalog-${i}`, features: { excerpt: true },
                    fields: { price: field.integer({ nullable: true, label: 'Price' }), sku: field.string({ nullable: true, label: 'SKU' }), notes: field.text({ nullable: true, label: 'Notes' }), weight: field.number({ nullable: true, label: 'Weight' }) } }, admin);
            }
            const catalog = await readCatalog(cms.db, Array.from({ length: 40 }, (_, i) => cms.resourceById(`cms/catalog${i}`).storage));
            expect(catalog.tables.size).toBeGreaterThanOrEqual(40);
            // Another server starting under the same writes finds the schema as planned.
            const other = createCMS({ db: service.database(), modules: [contentModule], now: () => clock });
            const report = await other.migrate();
            expect(report.failed).toBeUndefined();
            expect(report.applied).toEqual([]);
        } finally {
            done = true;
            await noise;
        }
        expect(next).toBeGreaterThan(40);
    }, 300_000);

    it('lets one of two saves from the same revision through, with one set of side rows', async () => {
        const posts = cms.resource('cms/posts');
        const post = await posts.create({ title: 'Contested', status: 'published' }, { principal: admin });
        const results = await Promise.allSettled([
            posts.update(post.id, { title: 'First' }, { principal: admin, expectedRevision: post.rev }),
            posts.update(post.id, { title: 'Second' }, { principal: admin, expectedRevision: post.rev }),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason)).toEqual([expect.objectContaining({ code: 'CMS_CONFLICT' })]);
        const [audits, revisions, events] = (await cms.db.read([
            { rql: "SELECT count(*) FROM cms_audit WHERE resource = 'cms/posts' AND action = 'update' AND record_id = $id", params: { $id: post.id } },
            { rql: "SELECT count(*) FROM cms_revisions WHERE resource = 'cms/posts' AND record_id = $id", params: { $id: post.id } },
            { rql: "SELECT payload FROM cms_outbox WHERE topic = 'resource.updated'" },
        ])).results;
        expect(Number(audits!.rows[0]![0])).toBe(1);
        expect(Number(revisions!.rows[0]![0])).toBe(2);
        expect(events!.rows.map(row => JSON.parse(row[0] as string) as { id: string }).filter(event => event.id === post.id)).toHaveLength(1);
        const winner = String((results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<{ title?: unknown }>).value.title);
        expect((await posts.get(post.id, { principal: admin }))!.title).toBe(winner);
    }, 60_000);

    it('lists and maps a hundred long entries within the result budget', async () => {
        const posts = cms.resource('cms/posts');
        const content = richContent(12);
        for (let i = 0; i < 100; i++) {
            clock += 1000;
            await posts.create({ title: `Bulk ${i}`, content, status: 'published' }, { principal: admin });
        }
        const seen = new Set<string>();
        for (let offset = 0; offset < 200; offset += 100) {
            const page = await posts.list({ limit: 100, offset }, { principal: admin });
            for (const record of page.records) seen.add(record.id);
            if (!page.more) break;
        }
        expect([...seen].length).toBeGreaterThanOrEqual(100);
        const mapped = await cms.sitemapEntries('posts', { limit: 1000 });
        expect(mapped.filter(entry => entry.title.startsWith('Bulk ')).length).toBe(100);
        // The pages were read in parts: no read came close to returning them all at once.
        expect(log.filter(entry => entry.kind === 'read').every(entry => entry.resultBytes <= resultLimit)).toBe(true);
    }, 300_000);
});
