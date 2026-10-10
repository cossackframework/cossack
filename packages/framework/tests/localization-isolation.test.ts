import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { Cossack, Page, __, getLocale, getDefaultLocale, getSupportedLocales } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { prepareConfigStore, runWithConfig, type EnvFunction } from '../src/config';
import { createLocaleMiddleware } from '../src/middlewares/locale';
import { renderSsgPage } from '../src/ssg-renderer';

vi.mock('virtual:cossack-lang', () => ({
    supportedLocales: ['en', 'es', 'fr'], defaultLocale: 'en',
    loadCatalog: async (locale: string) => ({
        en: { hello: 'Hello', fallback: 'English fallback' },
        es: { hello: 'Hola', fallback: 'Spanish fallback' },
        fr: { hello: 'Bonjour' },
    } as Record<string, Record<string, string>>)[locale],
}));

function barrier(count: number) {
    let arrived = 0;
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return async () => { if (++arrived === count) release(); await promise; };
}
const snapshot = () => ({ locale: getLocale(), fallback: getDefaultLocale(),
    greeting: __('hello'), message: __('fallback'), supported: getSupportedLocales() });

it('parallel SSR uses each environment default and fallback before and after awaits', async () => {
    const app = new Hono<{ Bindings: { APP_LOCALE: string } }>();
    const gate = barrier(2);
    app.use('*', async (c, next) => runWithConfig(prepareConfigStore({
        app: ({ env }: { env: EnvFunction }) => ({ locale: env('APP_LOCALE') }),
    }, c.env), next));
    app.use('*', createLocaleMiddleware());
    app.get('/', async c => { const before = snapshot(); await gate(); return c.json({ before, after: snapshot() }); });
    const reports = await Promise.all(['en', 'es'].map(async locale => {
        const response = await app.request('https://locale.test/', { headers: { cookie: 'cossack_locale=fr' } }, { APP_LOCALE: locale });
        expect(response.status).toBe(200); return response.json() as Promise<{ before: ReturnType<typeof snapshot>; after: ReturnType<typeof snapshot> }>;
    }));
    for (const [index, locale] of ['en', 'es'].entries()) {
        expect(reports[index].before).toEqual(reports[index].after);
        expect(reports[index].after).toMatchObject({ locale: 'fr', fallback: locale, greeting: 'Bonjour',
            message: locale === 'en' ? 'English fallback' : 'Spanish fallback' });
        expect([...reports[index].after.supported].sort()).toEqual(['en', 'es', 'fr']);
    }
});

it.each(['xx', 'bad%ZZ'])('invalid cookie %s follows the request default without poisoning later requests', async cookie => {
    const app = new Hono<{ Bindings: { APP_LOCALE: string } }>();
    app.use('*', async (c, next) => runWithConfig(prepareConfigStore({ app: ({ env }: { env: EnvFunction }) => ({ locale: env('APP_LOCALE') }) }, c.env), next));
    app.use('*', createLocaleMiddleware()); app.get('/', c => c.json(snapshot()));
    const response = await app.request('https://locale.test/', { headers: { cookie: `cossack_locale=${cookie}` } }, { APP_LOCALE: 'es' });
    expect(await response.json()).toMatchObject({ locale: 'es', fallback: 'es', greeting: 'Hola' });
});

@Page({ transport: 'http' })
class App extends Cossack { render() { return html`${this.children}`; } }

it.each(['en', 'es'])('parallel SSG isolates catalog values even when its second locale is %s', async secondLocale => {
    const outside = snapshot(); const gate = barrier(2);
    @Page({ ssg: true, transport: 'http' })
    class PageComponent extends Cossack {
        before = '';
        async init() { this.before = `${getLocale()}:${__('hello')}`; await gate(); }
        render() { return html`<main>${this.before}/${getLocale()}:${__('hello')}:${getDefaultLocale()}</main>`; }
    }
    const output = await Promise.all(['en', secondLocale].map((locale, index) => renderSsgPage(PageComponent,
        `/locale-${index}`, undefined, {}, `https://site-${index}.test`, App, undefined, undefined, undefined,
        { app: () => ({ locale }) }, { defaultLocale: locale, catalogs: {
            [locale]: { hello: index === 0 ? 'First catalog' : 'Second catalog' },
        } })));
    for (const [index, locale] of ['en', secondLocale].entries()) {
        const text = index === 0 ? 'First catalog' : 'Second catalog';
        expect(output[index].replace(/<!--[\s\S]*?-->/g, '')).toContain(`<main>${locale}:${text}/${locale}:${text}:${locale}</main>`);
        expect(output[index]).toMatch(new RegExp(`<html[^>]*lang=["']?${locale}(?:["']|[ >])`));
        expect(output[index]).not.toContain(index === 0 ? 'Second catalog' : 'First catalog');
    }
    expect(snapshot()).toEqual(outside);
});


it('authored content locale overrides visitor cookies and stays isolated across concurrent paths', async () => {
    const app = new Hono(); const gate = barrier(2);
    app.use('*', createLocaleMiddleware({ resolveLocale: context => context.req.path.slice(1) }));
    app.get('/:locale', async c => { const before = snapshot(); await gate(); return c.json({ before, after: snapshot() }); });
    const reports = await Promise.all(['en', 'fr'].map(async locale => {
        const response = await app.request('https://content.test/' + locale, { headers: { cookie: 'cossack_locale=es' } });
        expect(response.status).toBe(200); return response.json() as Promise<{ before: ReturnType<typeof snapshot>; after: ReturnType<typeof snapshot> }>;
    }));
    for (const [index, locale] of ['en', 'fr'].entries()) {
        expect(reports[index].before).toEqual(reports[index].after);
        expect(reports[index].after.locale).toBe(locale);
    }
});
