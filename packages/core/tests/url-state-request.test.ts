// @vitest-environment node
import 'reflect-metadata';
import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { Cossack } from '../src/shared/cossack';
import { Page } from '../src/shared/decorators';
import { defineUrlState, url } from '../src/shared/url-state';
const filters = defineUrlState({ search: url.string(), page: url.integer({ default: 1, min: 1 }) });
@Page({ transport: 'http' }) class List extends Cossack { get filters() { return this.urlState(filters); } }
it('uses the live server request and emits public path/query metadata for hydration', async () => {
    const app = new Hono();
    app.get('/list', async c => {
        const page = new List();
        try { await page.bootstrap({ context: c }); return c.json({ filters: page.filters, metadata: page.getInitialState().metadata }); }
        finally { page.destroy(); }
    });
    const response = await app.request('https://internal-host.test/list?search=%E9%9B%AA&page=2');
    expect(await response.json()).toMatchObject({ filters: { search: '雪', page: 2 }, metadata: { url: '/list?search=%E9%9B%AA&page=2' } });
});
