import { describe, expect, it } from 'vitest';
import { createCMS, defineResource, field, HOST_STEPS, planSchema, readCatalog, resolveResource, type ResourceDeclaration } from '../src/server/index';
import { createRomeDB, MemoryPendingWriteStore } from '@cossackframework/romedb';
import { romedbService, live } from './helpers';

const tickets = defineResource({
    name: 'tickets',
    ownership: true,
    fields: {
        subject: field.string({ required: true, max: 120, search: true }),
        body: field.text({ search: true }),
        status: field.enum(['open', 'closed'], { required: true, default: 'open', index: true }),
        priority: field.integer({ min: 1, max: 5, default: 3 }),
        score: field.number({ nullable: true }),
        meta: field.json(),
        labels: field.list('string'),
    },
    indexes: [{ name: 'status_priority', fields: ['status', 'priority'] }],
});

describe.skipIf(!live)('schema planner and migration ledger', () => {
    const service = romedbService();

    it('reports resources as waiting for setup on a fresh database', async () => {
        const fresh = await service.fresh();
        try {
            const cms = createCMS({ db: fresh.db, resources: [tickets] });
            expect(await cms.installed()).toBe(false);
            expect((await cms.status()).resources).toEqual([{ id: 'app/tickets', active: false }]);
            await expect(cms.resource('app/tickets').list({}, { principal: { kind: 'anonymous' } })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        } finally {
            await fresh.stop();
        }
    });

    it('creates host tables and resources, then reports them current', async () => {
        const db = service.database();
        const cms = createCMS({ db, resources: [tickets] });
        const plan = await cms.plan();
        expect(plan.steps.map(step => step.kind)).toEqual([...HOST_STEPS.map(() => 'host'), 'additive']);
        expect(plan.steps.every(step => step.statements.length <= 30)).toBe(true);
        expect(plan.blocked).toEqual([]);
        const create = plan.steps.find(step => step.kind === 'additive')!.statements.map(statement => statement.rql);
        expect(create[0]).toBe('CREATE TABLE r__app__tickets');
        expect(create).toContain('DEFINE FIELD "subject" ON r__app__tickets TYPE string REQUIRED CHECK(length("subject") <= 120)');
        expect(create).toContain(`DEFINE FIELD "status" ON r__app__tickets TYPE string REQUIRED DEFAULT 'open' CHECK("status" IN ('open', 'closed'))`);
        expect(create).toContain('DEFINE FIELD "meta" ON r__app__tickets TYPE object FLEXIBLE');
        expect(create).toContain('DEFINE SCHEMA ON r__app__tickets STRICT');
        expect(create).toContain('CREATE SEARCH INDEX r__app__tickets__text ON r__app__tickets("subject", "body") USING FULLTEXT');
        const report = await cms.migrate();
        expect(report.failed).toBeUndefined();
        expect(report.applied).toHaveLength(HOST_STEPS.length + 1);
        const again = await cms.plan();
        expect(again.steps).toEqual([]);
        expect(again.current).toEqual(['app/tickets']);
        expect((await cms.status()).resources).toEqual([{ id: 'app/tickets', active: true }]);
        const ledger = await db.read([{ rql: 'SELECT kind, resource, engine_version, rql FROM cms_migrations ORDER BY applied_at, id' }]);
        expect(ledger.results[0]!.rows.map(row => row[0])).toEqual([...HOST_STEPS.map(() => 'host'), 'additive']);
        expect(ledger.results[0]!.rows[HOST_STEPS.length]![2]).toMatch(/^0\./);
        expect(ledger.results[0]!.rows[HOST_STEPS.length]![3]).toContain('CREATE TABLE r__app__tickets');
    });

    it('refuses a database made by another build, whose ledger has host steps this build lacks', async () => {
        const fresh = await service.fresh();
        try {
            expect((await createCMS({ db: fresh.db }).migrate()).failed).toBeUndefined();
            await fresh.db.write([{ rql: `INSERT INTO cms_migrations (id, kind, owner, resource, version, declaration_hash, rql, engine_version, applied_at)
                VALUES ('cms#host-99', 'host', 'cms', NULL, 99, NULL, 'SELECT 1', '0', 1)` }], { kind: 'test' });
            const other = createCMS({ db: fresh.db });
            await expect(other.migrate()).rejects.toMatchObject({ code: 'CMS_SCHEMA_MISMATCH', message: expect.stringContaining('host steps 99') });
            await expect(other.status()).rejects.toMatchObject({ code: 'CMS_SCHEMA_MISMATCH' });
        } finally {
            await fresh.stop();
        }
    });

    it('produces identical DDL for one declaration on two databases', async () => {
        const a = await service.fresh();
        const b = await service.fresh();
        try {
            const plans = await Promise.all([a, b].map(async ({ db }) => planSchema([resolveResource(tickets)], await readCatalog(db, ['r__app__tickets']))));
            expect(plans[0]!.steps.map(step => step.statements)).toEqual(plans[1]!.steps.map(step => step.statements));
        } finally { await a.stop(); await b.stop(); }
    }, 30_000);

    it('reads the catalog while other rows are written between its reads, and starts over for a schema change', async () => {
        const fresh = await service.fresh();
        try {
            expect((await createCMS({ db: fresh.db, resources: [tickets] }).migrate()).failed).toBeUndefined();
            const writer = fresh.db;
            let noise = 0;
            let ledgerChanges = 0;
            const reading = (change: 'rows' | 'table-once') => createRomeDB({
                url: fresh.url, token: fresh.token, pending: new MemoryPendingWriteStore(),
                fetch: async (input, init) => {
                    if (String(input).endsWith('/read') && String(init?.body).includes('INFO FOR TABLE')) {
                        if (change === 'rows') {
                            noise++;
                            await writer.write([{ rql: `INSERT INTO cms_audit (id, actor, action, resource, record_id, at) VALUES ('noise-${noise}', 'x', 'noise', 'x', 'x', 0)` }]);
                        } else if (ledgerChanges++ === 0) {
                            await writer.write([{ rql: 'CREATE TABLE noise_table (id TEXT PRIMARY KEY)' }]);
                        }
                    }
                    return fetch(input, init);
                },
            });
            // A write before every table read: the old check started over each time and gave up.
            const busy = await readCatalog(reading('rows'), ['r__app__tickets']);
            expect(busy.tables.get('r__app__tickets')).toBeDefined();
            expect(noise).toBeGreaterThan(0);
            // A new table between reads is a schema change: the catalog is read again and holds it.
            const changed = await readCatalog(reading('table-once'), ['r__app__tickets']);
            expect(ledgerChanges).toBeGreaterThan(1);
            expect(changed.tables.has('noise_table')).toBe(true);
        } finally {
            await fresh.stop();
        }
    }, 60_000);

    it('requires one sequence across reads on a database without the generation table', async () => {
        const fresh = await service.fresh();
        try {
            expect((await createCMS({ db: fresh.db, resources: [tickets] }).migrate()).failed).toBeUndefined();
            // A database before host step 11 guards migrations on the global sequence alone.
            await fresh.db.write([{ rql: 'DROP TABLE cms_schema_generations' }]);
            const writer = fresh.db;
            let noise = 0;
            let written = 0;
            const reading = (times: number) => createRomeDB({
                url: fresh.url, token: fresh.token, pending: new MemoryPendingWriteStore(),
                fetch: async (input, init) => {
                    if (String(input).endsWith('/read') && String(init?.body).includes('INFO FOR TABLE') && noise < times) {
                        noise++;
                        await writer.write([{ rql: `INSERT INTO cms_audit (id, actor, action, resource, record_id, at) VALUES ('old-${++written}', 'x', 'noise', 'x', 'x', 0)` }]);
                    }
                    return fetch(input, init);
                },
            });
            await expect(readCatalog(reading(Infinity), ['r__app__tickets'])).rejects.toThrow(/kept changing/);
            noise = 0;
            const once = await readCatalog(reading(1), ['r__app__tickets']);
            expect(once.generation).toBeNull();
            const settled = await fresh.db.read([{ rql: 'SELECT 1' }]);
            expect(once.sequence).toBe(settled.sequence);
            // A busy site's writes during ten reads still let a later attempt through.
            noise = 0;
            expect((await readCatalog(reading(10), ['r__app__tickets'])).generation).toBeNull();
        } finally {
            await fresh.stop();
        }
    }, 60_000);

    it('applies through writes to other rows, and re-plans when another schema change lands between planning and applying', async () => {
        const other = service.database();
        let interfered = false;
        let noise = 0;
        const notes = defineResource({ name: 'notes', fields: { text: field.string() } });
        const comments = defineResource({ name: 'remarks', fields: { text: field.string() } });
        const interfering = (change: 'rows' | 'schema') => service.database({
            fetch: async (input, init) => {
                const body = String(init?.body);
                if (String(input).endsWith('/query') && (body.includes('r__app__notes') || body.includes('r__app__remarks'))) {
                    if (change === 'rows') {
                        // Before every migration write: a busy site.
                        noise++;
                        await other.write([{ rql: `INSERT INTO cms_audit (id, actor, action, resource, record_id, at) VALUES ('noise-${noise}', 'x', 'noise', 'x', 'x', 0)` }]);
                    } else if (!interfered) {
                        interfered = true;
                        await other.write([{ rql: 'CREATE TABLE schema_noise (id TEXT PRIMARY KEY)' }, { rql: 'INSERT INTO cms_schema_generations (id, at) SELECT coalesce(max(id), 0) + 1, 0 FROM cms_schema_generations' }]);
                    }
                }
                return fetch(input, init);
            },
        });
        const busy = await createCMS({ db: interfering('rows'), resources: [tickets, notes] }).migrate();
        expect(noise).toBeGreaterThan(0);
        expect(busy.replans).toBe(0);
        expect(busy.failed).toBeUndefined();
        expect(busy.applied.map(step => step.resource)).toEqual(['app/notes']);

        const report = await createCMS({ db: interfering('schema'), resources: [tickets, notes, comments] }).migrate();
        expect(interfered).toBe(true);
        expect(report.replans).toBe(1);
        expect(report.failed).toBeUndefined();
        expect(report.applied.map(step => step.resource)).toEqual(['app/remarks']);
    });

    it('adds optional fields additively and blocks changes that need explicit steps', async () => {
        const db = service.database();
        const extended: ResourceDeclaration = { ...tickets, fields: { ...tickets.fields, assignee: field.string({ nullable: true }) } };
        const plan = await createCMS({ db, resources: [extended] }).plan();
        expect(plan.steps.map(step => step.statements.map(statement => statement.rql))).toEqual([['DEFINE FIELD "assignee" ON r__app__tickets TYPE string NULLABLE CHECK(length("assignee") <= 255)']]);

        const changedType: ResourceDeclaration = { ...tickets, fields: { ...tickets.fields, priority: field.string() } };
        const blocked = await createCMS({ db, resources: [changedType] }).plan();
        expect(blocked.steps).toEqual([]);
        expect(blocked.blocked).toEqual([expect.objectContaining({ resource: 'app/tickets', field: 'priority', message: expect.stringContaining('type') })]);

        const required: ResourceDeclaration = { ...tickets, fields: { ...tickets.fields, team: field.string({ required: true }) } };
        const needsStep = await createCMS({ db, resources: [required] }).plan();
        expect(needsStep.blocked[0]).toMatchObject({ field: 'team', message: expect.stringContaining('tighten') });
    });

    it('runs backfill, tighten, rename and drop steps once, in version order', async () => {
        const db = service.database();
        const v1 = defineResource({ name: 'contacts', fields: { name: field.string(), email: field.string() } });
        await createCMS({ db, resources: [v1] }).migrate();
        const cms1 = createCMS({ db, resources: [v1] });
        await cms1.resource('app/contacts').create({ name: 'Ada', email: 'ada@example.com' }, { principal: { kind: 'system', reason: 'test' } });
        await cms1.resource('app/contacts').create({ email: 'nameless@example.com' }, { principal: { kind: 'system', reason: 'test' } });

        const v2 = defineResource({
            name: 'contacts',
            fields: { name: field.string({ required: true }), email: field.string(), fullName: field.string() },
            migrations: [
                { version: 1, kind: 'backfill', field: 'name', value: 'Unknown' },
                { version: 2, kind: 'tighten', field: 'name' },
                { version: 3, kind: 'rename', from: 'name', to: 'fullName' },
            ],
        });
        const report = await createCMS({ db, resources: [v2] }).migrate();
        expect(report.failed).toBeUndefined();
        expect(report.applied.map(step => step.kind)).toEqual(['additive', 'explicit', 'explicit', 'explicit']);
        const rows = await db.read([{ rql: 'SELECT "name", "fullName" FROM r__app__contacts ORDER BY "email"' }]);
        expect(rows.results[0]!.rows).toEqual([['Ada', 'Ada'], ['Unknown', 'Unknown']]);
        expect((await createCMS({ db, resources: [v2] }).plan()).steps).toEqual([]);

        const v3 = defineResource({
            name: 'contacts',
            fields: { email: field.string(), fullName: field.string() },
            migrations: [...v2.migrations!, { version: 4, kind: 'drop', field: 'name' }],
        });
        const dropped = await createCMS({ db, resources: [v3] }).migrate();
        expect(dropped.applied.map(step => step.description), JSON.stringify(dropped)).toEqual(['drop name on app/contacts']);
        const info = await db.read([{ rql: 'INFO FOR TABLE r__app__contacts' }]);
        expect((info.results[0]!.rows[0]![0] as { fields: { path: string[] }[] }).fields.map(entry => entry.path[0])).not.toContain('name');
    });

    it('rolls back a failed step together and does not activate the resource', async () => {
        const db = service.database();
        const v1 = defineResource({ name: 'codes', fields: { code: field.string() } });
        const cms = createCMS({ db, resources: [v1] });
        await cms.migrate();
        await cms.resource('app/codes').create({ code: 'same' }, { principal: { kind: 'system', reason: 'test' } });
        await cms.resource('app/codes').create({ code: 'same' }, { principal: { kind: 'system', reason: 'test' } });
        const v2 = defineResource({ name: 'codes', fields: { code: field.string({ unique: true }), label: field.string() } });
        const next = createCMS({ db, resources: [v2] });
        const report = await next.migrate();
        expect(report.failed).toMatchObject({ code: 'RDB_CONSTRAINT', step: expect.objectContaining({ resource: 'app/codes' }) });
        const info = await db.read([{ rql: 'INFO FOR TABLE r__app__codes' }]);
        expect((info.results[0]!.rows[0]![0] as { fields: { path: string[] }[] }).fields.map(entry => entry.path[0])).not.toContain('label');
        expect((await next.status()).resources).toEqual([{ id: 'app/codes', active: false }]);
        await expect(next.resource('app/codes').list({}, { principal: { kind: 'system', reason: 'test' } })).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
    });
});
