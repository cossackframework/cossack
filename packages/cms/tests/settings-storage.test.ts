import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RomeDB, Statement } from '@cossackframework/romedb';
import { CmsSettings, createCMS, field, parseSettingsDocument, type SettingsGroup } from '../src/server/index';
import { live, romedbService } from './helpers';

describe.skipIf(!live)('atomic settings storage', () => {
    const service = romedbService();

    it('upserts more than 32 settings in one statement and rolls the entire batch back on failure', async () => {
        const db = service.database();
        await db.write([{ rql: 'CREATE TABLE settings_proof (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK (value != \'invalid\'))' }]);
        const statement = (prefix: string): Statement => {
            const params: Record<string, string> = {};
            const rows = Array.from({ length: 80 }, (_, i) => {
                params[`$k${i}`] = `setting${i}`;
                params[`$v${i}`] = `${prefix}${i}`;
                return `($k${i}, $v${i})`;
            });
            return { rql: `INSERT INTO settings_proof (key, value) VALUES ${rows.join(', ')} ON CONFLICT (key) DO UPDATE SET value = excluded.value`, params };
        };
        await db.write([statement('first')]);
        await db.write([statement('second')]);
        const read = async () => (await db.read([{ rql: 'SELECT key, value FROM settings_proof ORDER BY key' }])).results[0]!.rows;
        const saved = await read();
        expect(saved).toHaveLength(80);
        expect(saved.every(row => String(row[1]).startsWith('second'))).toBe(true);
        await expect(db.write([statement('partial'), { rql: "INSERT INTO settings_proof (key, value) VALUES ('bad', 'invalid')" }])).rejects.toBeDefined();
        expect(await read()).toEqual(saved);
        await db.write([{
            rql: `INSERT INTO settings_proof (key, value) SELECT json_extract(value, '$.key'), json_extract(value, '$.value') FROM json_each($rows) WHERE true ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
            params: { $rows: JSON.stringify([{ key: 'setting0', value: 'json' }, { key: 'new', value: 'json' }]) },
        }]);
        expect((await read()).find(row => row[0] === 'setting0')?.[1]).toBe('json');
    });
});

describe.skipIf(!live)('portable settings on RomeDB', () => {
    const service = romedbService();
    const admin = { principal: { kind: 'system', reason: 'test' } } as const;
    const fields = Object.fromEntries(Array.from({ length: 1105 }, (_, i) => [`value${i}`, field.integer({ default: 0 })]));
    const groups: SettingsGroup[] = [
        { id: 'bulk', label: 'Bulk', fields, json: true },
        { id: 'nullable', label: 'Nullable', fields: { name: field.string({ nullable: true, default: null }), enabled: field.boolean({ default: false }) }, json: true },
        { id: 'custom', label: 'Custom', fields: { private: field.string({ default: 'secret' }) } },
        { id: 'restricted', label: 'Restricted', permission: 'example:settings', fields: { value: field.string({ default: 'private' }) }, json: true },
    ];
    let db: RomeDB;
    let settings: CmsSettings;

    beforeAll(async () => {
        db = service.database();
        await createCMS({ db }).migrate();
        settings = new CmsSettings(db, groups);
    });

    it('saves and exports every row beyond the old 1000-row cutoff', async () => {
        const values = Object.fromEntries(Object.keys(fields).map((key, i) => [key, i + 1]));
        const result = await settings.applyDocument({ bulk: values }, admin);
        expect(result.bulk).toEqual(values);
        expect((await new CmsSettings(service.database(), groups).snapshot(admin)).bulk).toEqual(values);
        expect(parseSettingsDocument(await settings.exportDocument(admin)).bulk).toEqual(values);
        expect((await settings.all())['bulk.value999']).toBe(1000);
        const audit = (await db.read([{ rql: "SELECT updated_at, updated_by FROM cms_settings WHERE key = 'bulk.value999'" }])).results[0]!.rows[0]!;
        expect(Number(audit[0])).toBeGreaterThan(0);
    });

    it('refuses a bad field in a multi-group patch before changing any values', async () => {
        const before = await settings.snapshot(admin);
        const write = vi.spyOn(db, 'write');
        await expect(settings.applyDocument({ bulk: { value0: 2000 }, nullable: { enabled: 'true' } }, admin))
            .rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { 'nullable.enabled': expect.any(String) } });
        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
        expect(await settings.snapshot(admin)).toEqual(before);
    });

    it('rolls back all fields and groups if the database fails during the write', async () => {
        await db.write([{ rql: 'CREATE TABLE settings_failure_guard (value INTEGER CHECK (value > 0))' }]);
        const before = await settings.snapshot(admin);
        const failing = new CmsSettings({
            read: db.read.bind(db),
            write: (statements: Statement[]) => db.write([...statements, { rql: 'INSERT INTO settings_failure_guard (value) VALUES (-1)' }]),
        } as RomeDB, groups);
        const patch = { bulk: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`value${i}`, 9000 + i])), nullable: { name: 'Failed save' } };
        await expect(failing.applyDocument(patch, admin)).rejects.toBeDefined();
        expect(await settings.snapshot(admin)).toEqual(before);
    });

    it('keeps omitted fields, writes null, and pins explicitly imported defaults', async () => {
        await settings.applyDocument({ nullable: { name: 'Newsletter', enabled: true } }, admin);
        await settings.applyDocument({ nullable: { name: null } }, admin);
        expect((await settings.snapshot(admin)).nullable).toEqual({ name: null, enabled: true });
        await settings.applyDocument({ nullable: { enabled: false } }, admin);
        const upgraded = new CmsSettings(db, [{ ...groups[1]!, fields: { ...groups[1]!.fields, enabled: field.boolean({ default: true }) } }]);
        expect((await upgraded.snapshot(admin)).nullable!.enabled).toBe(false);
        const write = vi.spyOn(db, 'write');
        await settings.applyDocument({}, admin);
        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
    });

    it('filters reads and declarations, and rejects writes to excluded or unauthorized groups', async () => {
        const user = { principal: { kind: 'user', id: 'editor', roles: [], permissions: ['cms:settings'] } } as const;
        expect(settings.catalog(user).map(group => group.id)).toEqual(['bulk', 'nullable']);
        expect(await settings.snapshot(user)).not.toHaveProperty('restricted');
        expect(await settings.snapshot(user)).not.toHaveProperty('custom');
        expect(settings.validateDocument({}, user)).toEqual({});
        expect(() => settings.validateDocument({ restricted: { value: 'leak' } }, user)).toThrow(expect.objectContaining({ code: 'CMS_FORBIDDEN' }));
        expect(() => settings.validateDocument({ custom: { private: 'overwrite' } }, admin)).toThrow(expect.objectContaining({ code: 'CMS_VALIDATION' }));
        expect(() => settings.validateDocument({ nullable: { enabled: true } }, { principal: { kind: 'anonymous' } })).toThrow(expect.objectContaining({ code: 'CMS_UNAUTHENTICATED' }));
        expect(() => settings.validateDocument(JSON.parse('{"nullable":{"constructor":true}}'), admin)).toThrow();
    });

    it('reports invalid stored values and requires a valid complete repair before committing', async () => {
        await db.write([{ rql: 'UPDATE cms_settings SET value = $value WHERE key = $key', params: { $key: 'nullable.enabled', $value: '"invalid"' } }]);
        settings.refresh();
        expect((await settings.all())['nullable.enabled']).toBe(false);
        await expect(settings.exportDocument(admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { 'nullable.enabled': expect.any(String) } });
        const write = vi.spyOn(db, 'write');
        await expect(settings.applyDocument({ nullable: { name: 'Do not commit' } }, admin)).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
        const repaired = await settings.applyDocument({ nullable: { enabled: true } }, admin);
        expect(repaired.nullable).toEqual({ name: null, enabled: true });
    });

    it('rejects oversized encoded operations before dispatch and leaves cached values alone', async () => {
        const large = new CmsSettings(db, [{ id: 'large', label: 'Large', json: true, fields: { value: field.text({ max: 100_000 }) } }]);
        const write = vi.spyOn(db, 'write');
        // The raw document fits, but JSON and database string escaping exceed the atomic request limit.
        expect(() => large.validateDocument({ large: { value: '\\'.repeat(20_000) } }, admin)).toThrow(expect.objectContaining({ code: 'CMS_LIMIT' }));
        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
    });

    it('recovers a lost write response with the exact request and refreshes the cache', async () => {
        const bodies: string[] = [];
        let loseResponse = true;
        const recovering = service.database({
            sleep: async () => {},
            fetch: async (input, init) => {
                const body = typeof init?.body === 'string' ? init.body : '';
                const settingsWrite = body.includes('INSERT INTO cms_settings');
                if (settingsWrite) bodies.push(body);
                const response = await fetch(input, init);
                if (settingsWrite && loseResponse) {
                    loseResponse = false;
                    await response.body?.cancel();
                    throw new TypeError('Response lost after commit');
                }
                return response;
            },
        });
        const current = new CmsSettings(recovering, groups);
        expect((await current.all())['nullable.name']).toBe(null);
        await current.update('nullable', { name: 'Recovered' }, admin);
        expect(bodies).toHaveLength(2);
        expect(bodies[1]).toBe(bodies[0]);
        expect((await current.all())['nullable.name']).toBe('Recovered');
        expect((await recovering.pending.list()).length).toBe(0);
    });
});
