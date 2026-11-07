import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from '@cossackframework/romedb';
import type { CmsHost } from '@cossackframework/cms/server';
import { fileExportResponse } from '../src/cms/site-export';

const INFO = { results: [{ rows: [[{ tables: [{ name: 'cms_cache' }, { name: 'cms_posts' }] }]] }] };
const host = (exportFile: (options: { emptyTables: string[] }) => Promise<unknown>) => ({ now: () => Date.UTC(2026, 10, 4), db: { read: async () => INFO, exportFile } }) as unknown as CmsHost;
const site = { id: 'blog' };
const open = () => new AbortController().signal;

describe('a database file download', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sends the file, with the tables this site has left empty', async () => {
        let emptied: string[] = [];
        const response = await fileExportResponse(host(async options => {
            emptied = options.emptyTables;
            return { sequence: 1, size: 4, body: new Response('file').body };
        }), site, open());
        expect(emptied).toEqual(['cms_cache']);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="blog-2026-11-04.romedb"');
        expect(response.headers.get('content-length')).toBe('4');
        expect(await response.text()).toBe('file');
    });

    it('tells Workers how long the file is, or they drop content-length', async () => {
        const lengths: number[] = [];
        vi.stubGlobal('FixedLengthStream', class extends TransformStream<Uint8Array, Uint8Array> {
            constructor(length: number) { super(); lengths.push(length); }
        });
        const response = await fileExportResponse(host(async () => ({ sequence: 1, size: 4, body: new Response('file').body })), site, open());
        expect(lengths).toEqual([4]);
        expect(await response.text()).toBe('file');
    });

    it('asks to try again while another copy is being made, as long as RomeDB says', async () => {
        const busy = (retryAfterMs?: number) => host(async () => { throw new ClientError('RDB_BUSY', 'busy', 'read-failed', retryAfterMs === undefined ? {} : { retryAfterMs }); });
        const response = await fileExportResponse(busy(4_500), site, open());
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('5');
        expect(await response.json()).toMatchObject({ code: 'CMS_UNAVAILABLE' });
        expect((await fileExportResponse(busy(), site, open())).headers.get('retry-after')).toBe('30');
    });

    it('points to the JSON export when the copy takes too long, not when the visitor leaves', async () => {
        const late = host(async () => { throw new ClientError('RDB_CANCELLED', 'deadline', 'read-failed'); });
        const response = await fileExportResponse(late, site, open());
        expect(response.status).toBe(504);
        expect((await response.json() as { error: string }).error).toContain('JSON export');
        await expect(fileExportResponse(late, site, AbortSignal.abort())).rejects.toBeInstanceOf(ClientError);
    });

    it('leaves other failures to the error handler', async () => {
        await expect(fileExportResponse(host(async () => { throw new ClientError('RDB_VALIDATION', 'no such table', 'read-failed'); }), site, open())).rejects.toThrow('no such table');
        await expect(fileExportResponse(host(async () => { throw new Error('broken'); }), site, open())).rejects.toThrow('broken');
    });
});
