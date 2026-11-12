import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from '@cossackframework/romedb';
import { FILE_EXPORT_EMPTIED_TABLES, type CmsHost } from '@cossackframework/cms/server';
import { fileExportResponse } from '../src/cms/site-export';

const host = (exportFile: (options: { emptyTables: string[] }) => Promise<unknown>) => ({ now: () => Date.UTC(2026, 10, 4), db: { exportFile } }) as unknown as CmsHost;
const site = { id: 'blog' };
const open = () => new AbortController().signal;

describe('a database file download', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sends the file, with the tables a copy leaves empty', async () => {
        let emptied: string[] = [];
        const response = await fileExportResponse(host(async options => {
            emptied = options.emptyTables;
            return { sequence: 1, size: 4, body: new Response('file').body };
        }), site, open());
        expect(emptied).toEqual([...FILE_EXPORT_EMPTIED_TABLES]);
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

describe('the site export route', () => {
    it('gives both formats only to those who may manage every account', async () => {
        vi.stubGlobal('__', (text: string) => text);
        const { Hono } = await import('hono');
        const { userPrincipal } = await import('@cossackframework/cms');
        const { GET } = await import('../src/pages/api/cms/site-export');
        const cms = { users: { roles: async () => [{ id: 'admin', permissions: ['*'] }, { id: 'manager', permissions: ['cms:settings'] }] }, settings: { get: async () => 'Site' } };
        const call = async (principal: unknown, query = '') => {
            const app = new Hono();
            app.use('*', async (c, next) => {
                c.set('principal' as never, principal as never);
                c.set('cms' as never, cms as never);
                c.set('site' as never, { id: 'blog', name: 'Blog' } as never);
                c.set('network' as never, { exportAccess: async () => ({ allowed: true }) } as never);
                await next();
            });
            app.get('/', GET as never);
            return app.request(`/${query}`);
        };
        // Settings alone holds no accounts, submissions or drafts: neither the JSON nor the file.
        const settingsOnly = userPrincipal('sam', ['manager'], ['cms:settings']);
        expect((await call(settingsOnly)).status).toBe(403);
        expect((await call(settingsOnly, '?format=romedb')).status).toBe(403);
        const usersToo = userPrincipal('uma', ['manager'], ['cms:settings', 'cms:users']);
        expect((await call(usersToo)).status).toBe(403);
    });
});
