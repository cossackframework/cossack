import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('installs bare translation and config helpers for standalone SSG lifecycle and rendering', async () => {
    vi.resetModules();
    for (const name of ['__', 'setLocale', 'getLocale', 'isLocale', 'config', 'env', 'binding']) {
        vi.stubGlobal(name, undefined);
    }
    const { renderSsgPage } = await import('../src/ssg-renderer');
    const { Cossack, Page, State } = await import('@cossackframework/core');
    const { html } = await import('@cossackframework/renderer');

    @Page({ transport: 'http' })
    class App extends Cossack { render() { return html`${this.children}`; } }

    @Page({ ssg: true, transport: 'http' })
    class TranslatedPage extends Cossack {
        @State() message = '';
        async init() { this.message = __('Ready'); }
        render() { return html`<p>${this.message}:${__('Rendered')}:${getLocale()}:${config('app.name')}:${env('APP_URL')}</p>`; }
    }

    const output = await renderSsgPage(TranslatedPage, '/translated', undefined, {}, 'https://ssg.example.test',
        App, undefined, '/src/pages/translated/index.ts', 'translated', { app: () => ({ name: 'Static App', locale: 'en' }) },
        { defaultLocale: 'en', catalogs: { en: { Ready: 'Prepared', Rendered: 'Built' } } });
    expect(output.replace(/<!--[\s\S]*?-->/g, '')).toContain('<p>Prepared:Built:en:Static App:https://ssg.example.test</p>');
    expect(output).toContain('"message":"Prepared"');
}, 60_000); // Fresh module graph after resetModules: cold imports are slow under load.
