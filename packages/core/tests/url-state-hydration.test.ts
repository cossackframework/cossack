// @vitest-environment jsdom
import 'reflect-metadata';
import { beforeEach, expect, it } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { Page } from '../src/shared/decorators';
import { defineUrlState, url } from '../src/shared/url-state';
const filters = defineUrlState({ search: url.string(), page: url.integer({ default: 1, min: 1 }) });
@Page({ transport: 'http' }) class List extends Cossack {
    get filters() { return this.urlState(filters); }
    get request() { return this.c.req; }
}
beforeEach(() => window.history.replaceState({}, '', '/old?search=previous&page=9'));
it('reads the destination query before browser history commits and caches immutable values', async () => {
    const page = new List();
    await page.bootstrap({ initialState: { public: {}, metadata: { pathname: '/list', url: '/list?search=%E9%9B%AA&page=2' } }, deferMount: true });
    expect(page.filters).toEqual({ search: '雪', page: 2 }); expect(page.filters).toBe(page.filters);
    expect(page.request.url).toBe(new URL('/list?search=%E9%9B%AA&page=2', window.location.href).href);
    expect(page.request.query('search')).toBe('雪'); expect(window.location.pathname).toBe('/old');
    expect(page.getInitialState().metadata?.url).toBe('/list?search=%E9%9B%AA&page=2'); page.destroy();
});
it('updates a retained component context when the framework supplies a new destination', async () => {
    const page = new List();
    await page.bootstrap({ initialState: { public: {}, metadata: { pathname: '/list', url: '/list?page=2' } }, deferMount: true });
    const previous = page.filters; page.updatePath('/list', '/list?search=next&page=3');
    expect(page.filters).toEqual({ search: 'next', page: 3 }); expect(page.filters).not.toBe(previous);
    expect(page.request.query('page')).toBe('3'); expect(page.request.path).toBe('/list'); page.destroy();
});
it('uses the active browser URL for legacy hydration and rejects constructor-time reads', async () => {
    const page = new List(); expect(() => page.filters).toThrow('bootstrap');
    await page.bootstrap({ initialState: { public: {} }, deferMount: true });
    expect(page.filters).toEqual({ search: 'previous', page: 9 }); page.destroy();
});
