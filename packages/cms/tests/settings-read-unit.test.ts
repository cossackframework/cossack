import { describe, expect, it, vi } from 'vitest';
import { ClientError, type RomeDB } from '@cossackframework/romedb';
import { CmsSettings } from '../src/server/site-settings';
import { field, systemPrincipal, type SettingsGroup } from '../src/index';

const context = { principal: systemPrincipal('settings read tests') };
const groups: SettingsGroup[] = [{ id: 'data', label: 'Data', json: true, fields: {
    a: field.string({ default: 'default-a' }), z: field.string({ default: 'default-z' }),
} }];
const result = (sequence: number, rows: (readonly [string, unknown])[]) => ({ sequence, results: [{ rows }] });
const page = (first: string): (readonly [string, unknown])[] => [
    ['data.a', JSON.stringify(first)], ...Array.from({ length: 99 }, (_, index) => [`data.b${String(index + 1).padStart(3, '0')}`, 'null'] as const),
];
const database = (read: ReturnType<typeof vi.fn>, write = vi.fn()) => ({ read, write }) as unknown as RomeDB;

describe('settings read consistency', () => {
    it('restarts a paginated read when the sequence changes and returns only the new snapshot', async () => {
        const read = vi.fn()
            .mockResolvedValueOnce(result(1, page('old-a')))
            .mockResolvedValueOnce(result(2, [['data.z', '"new-z"']]))
            .mockResolvedValueOnce(result(2, page('new-a')))
            .mockResolvedValueOnce(result(2, [['data.z', '"new-z"']]));
        const settings = new CmsSettings(database(read), groups);
        expect(await settings.snapshot(context)).toEqual({ data: { a: 'new-a', z: 'new-z' } });
        expect(read).toHaveBeenCalledTimes(4);
        expect(read.mock.calls.map(([statements]) => statements[0].params.$after)).toEqual(['', 'data.b099', '', 'data.b099']);
    });

    it('fails explicitly after repeated snapshot changes instead of mixing pages', async () => {
        let sequence = 0;
        const read = vi.fn(async () => result(++sequence, sequence % 2 ? page('unstable') : [['data.z', '"unstable-z"']]));
        const settings = new CmsSettings(database(read), groups);
        await expect(settings.snapshot(context)).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(read).toHaveBeenCalledTimes(6);
    });

    it('propagates read failures even when their message mentions settings', async () => {
        const failure = new Error('cms_settings is unavailable because the connection failed');
        const read = vi.fn().mockRejectedValue(failure);
        const settings = new CmsSettings(database(read), groups);
        await expect(settings.all()).rejects.toBe(failure);
        // A failed promise must not remain cached.
        read.mockResolvedValue(result(1, [['data.a', '"recovered"']]));
        expect(await settings.get('data.a')).toBe('recovered');
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('uses defaults only for an explicit missing settings table', async () => {
        const read = vi.fn().mockRejectedValue(new ClientError('FDB_QUERY', 'no such table: cms_settings', 'read-failed'));
        expect(await new CmsSettings(database(read), groups).snapshot(context)).toEqual({ data: { a: 'default-a', z: 'default-z' } });
        const otherTable = new ClientError('FDB_QUERY', 'no such table: unrelated', 'read-failed');
        read.mockRejectedValue(otherTable);
        await expect(new CmsSettings(database(read), groups).snapshot(context)).rejects.toBe(otherTable);
    });

    it('reduces oversized result pages while keeping the same read cursor', async () => {
        const read = vi.fn()
            .mockRejectedValueOnce(new ClientError('FDB_RESULT_TOO_LARGE', 'Response exceeds the result limit', 'read-failed'))
            .mockResolvedValueOnce(result(1, [['data.a', '"smaller-page"']]));
        expect(await new CmsSettings(database(read), groups).get('data.a')).toBe('smaller-page');
        expect(read.mock.calls.map(([statements]) => statements[0].params)).toEqual([{ $after: '', $limit: 100 }, { $after: '', $limit: 50 }]);
    });

    it('refuses stores exceeding the complete-read bound rather than truncating exports', async () => {
        let offset = 0;
        const read = vi.fn(async () => {
            const rows = Array.from({ length: 100 }, () => [`retained.${String(offset++).padStart(6, '0')}`, 'null'] as const);
            return result(1, rows);
        });
        await expect(new CmsSettings(database(read), groups).exportDocument(context)).rejects.toMatchObject({ code: 'CMS_LIMIT', message: expect.stringContaining('20000-row') });
        expect(read).toHaveBeenCalledTimes(201);
    });
});

describe('settings cache and invalid overrides', () => {
    it('keeps internal reads cached but invalidates them after a successful update', async () => {
        let current = 'old';
        const read = vi.fn(async () => result(1, [['data.a', JSON.stringify(current)]]));
        const write = vi.fn(async () => { current = 'saved'; return result(2, []); });
        const settings = new CmsSettings(database(read, write), groups);
        expect(await settings.get('data.a')).toBe('old');
        current = 'external';
        expect(await settings.get('data.a')).toBe('old');
        expect(read).toHaveBeenCalledTimes(1);
        expect((await settings.update('data', { a: 'saved' }, context))['data.a']).toBe('saved');
        expect(await settings.get('data.a')).toBe('saved');
        expect(read).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenCalledTimes(1);
    });

    it('takes fresh snapshots even when ordinary server reads are cached', async () => {
        let current = 'old';
        const read = vi.fn(async () => result(1, [['data.a', JSON.stringify(current)]]));
        const settings = new CmsSettings(database(read), groups);
        expect(await settings.get('data.a')).toBe('old');
        current = 'fresh';
        expect(await settings.snapshot(context)).toEqual({ data: { a: 'fresh', z: 'default-z' } });
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('reports incompatible overrides in snapshots and exports instead of substituting defaults', async () => {
        const read = vi.fn(async () => result(1, [['data.a', '12'], ['data.z', '{invalid JSON']]));
        const settings = new CmsSettings(database(read), groups);
        expect(await settings.all()).toMatchObject({ 'data.a': 'default-a', 'data.z': 'default-z' });
        const failure = { code: 'CMS_VALIDATION', fields: { 'data.a': expect.stringContaining('text'), 'data.z': 'contains invalid stored JSON.' } };
        await expect(settings.snapshot(context)).rejects.toMatchObject(failure);
        await expect(settings.exportDocument(context)).rejects.toMatchObject(failure);
    });

    it('still reports invalid stored values for optional fields without defaults', async () => {
        const read = vi.fn(async () => result(1, [['optional.value', '{}']]));
        const settings = new CmsSettings(database(read), [{ id: 'optional', label: 'Optional', json: true, fields: { value: field.string() } }]);
        await expect(settings.snapshot(context)).rejects.toMatchObject({ code: 'CMS_VALIDATION', fields: { 'optional.value': expect.any(String) } });
    });
});
