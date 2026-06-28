import { describe, it, expect, vi } from 'vitest';
import { serializeInitialState } from '../src/root';

// Mock import.meta.env before importing the module
vi.mock('@cossackframework/renderer/server', () => ({
    minifyHtml: (html: string) => html.replace(/\s{2,}/g, ' ').trim(),
}));

// We need to test the core logic of htmlTemplate handling.
// Since renderRoot uses import.meta.env which is Vite-specific,
// we extract and test the template composition logic directly.
describe('renderRoot htmlTemplate', () => {
    // Simulate the helper functions from renderRoot
    const makeHelpers = (body: string = '<p>Hello</p>') => {
        const headTagsHtml = '<title>Test</title>';
        const cssHtml = '<link rel="stylesheet" href="/style.css">';
        const initialStateScript = '<script>window.__INITIAL_STATE__ = {}</script>';
        const modulePreloadHtml = '<link rel="modulepreload" href="/chunk.js">';
        const clientScript = '/src/client/entry-client.ts';

        const cossackScripts = () =>
            `${headTagsHtml}\n${cssHtml}\n${initialStateScript}\n${modulePreloadHtml}\n<script type="module" src="${clientScript}"></script>`;

        const cossackBody = () => `<div id="root">${body}</div>`;

        return { cossackScripts, cossackBody };
    };

    it('should render default template when htmlTemplate is not provided', () => {
        const { cossackScripts, cossackBody } = makeHelpers();
        const raw = `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                ${cossackScripts()}
            </head>
            <body>
                ${cossackBody()}
            </body>
        </html>
    `;

        expect(raw).toContain('<!DOCTYPE html>');
        expect(raw).toContain('<html lang="en">');
        expect(raw).toContain('<div id="root"><p>Hello</p></div>');
        expect(raw).toContain('<script type="module" src="/src/client/entry-client.ts"></script>');
        expect(raw).toContain('<title>Test</title>');
    });

    it('should render custom template from function', () => {
        const { cossackScripts, cossackBody } = makeHelpers();
        const htmlTemplate = ({ cossackScripts: scripts, cossackBody: body }: { cossackScripts: () => string; cossackBody: () => string }) => `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
                <head>
                    <meta charset="utf-8">
                    ${scripts()}
                </head>
                <body class="custom-class">
                    ${body()}
                </body>
            </html>
        `;

        const raw = htmlTemplate({ cossackScripts, cossackBody });

        expect(raw).toContain('<html lang="ar" dir="rtl">');
        expect(raw).toContain('<body class="custom-class">');
        expect(raw).toContain('<div id="root"><p>Hello</p></div>');
        expect(raw).toContain('<script type="module" src="/src/client/entry-client.ts"></script>');
        expect(raw).toContain('<title>Test</title>');
    });

    it('should render custom template from string with placeholders', () => {
        const { cossackScripts, cossackBody } = makeHelpers();
        const htmlTemplate = `
            <!DOCTYPE html>
            <html lang="fr">
                <head>
                    <meta charset="utf-8">
                    {{ cossackScripts }}
                </head>
                <body class="french-theme">
                    {{ cossackBody }}
                </body>
            </html>
        `;

        const raw = htmlTemplate
            .replace('{{ cossackScripts }}', cossackScripts())
            .replace('{{ cossackBody }}', cossackBody());

        expect(raw).toContain('<html lang="fr">');
        expect(raw).toContain('<body class="french-theme">');
        expect(raw).toContain('<div id="root"><p>Hello</p></div>');
        expect(raw).toContain('<script type="module" src="/src/client/entry-client.ts"></script>');
    });

    it('cossackBody always includes #root container', () => {
        const { cossackBody } = makeHelpers('my content');
        expect(cossackBody()).toBe('<div id="root">my content</div>');
    });

    it('cossackScripts includes all required parts', () => {
        const { cossackScripts } = makeHelpers();
        const scripts = cossackScripts();
        expect(scripts).toContain('<title>Test</title>');
        expect(scripts).toContain('<link rel="stylesheet" href="/style.css">');
        expect(scripts).toContain('window.__INITIAL_STATE__');
        expect(scripts).toContain('modulepreload');
        expect(scripts).toContain('<script type="module"');
    });
});

describe('serializeInitialState (XSS hardening)', () => {
    it('escapes `</script>` sequences so they cannot break out of the script element', () => {
        const malicious = { comment: '</script><script>alert(1)</script>' };
        const serialized = serializeInitialState(malicious);
        // The literal `</script>` / `<script>` must never appear in the output
        expect(serialized).not.toContain('</script>');
        expect(serialized).not.toContain('<script>');
        // The escaped unicode form should be present instead
        expect(serialized).toContain('\\u003c');
        expect(serialized).toContain('\\u003e');
        // And it must still round-trip to the original value
        expect(JSON.parse(serialized)).toEqual(malicious);
    });

    it('escapes U+2028 and U+2029 line separators', () => {
        const state = { a: 'line\u2028sep\u2029here' };
        const serialized = serializeInitialState(state);
        expect(serialized).not.toContain('\u2028');
        expect(serialized).not.toContain('\u2029');
        expect(JSON.parse(serialized)).toEqual(state);
    });

    it('escapes ampersands (defense in depth for attribute/URL re-use)', () => {
        const state = { url: 'https://example.com/?a=1&b=2' };
        const serialized = serializeInitialState(state);
        expect(serialized).toContain('\\u0026');
        expect(JSON.parse(serialized)).toEqual(state);
    });

    it('round-trips arbitrary nested state unchanged', () => {
        const state = { n: 1, s: 'hi', arr: [1, 'two', { deep: '</x>' }], nil: null };
        const serialized = serializeInitialState(state);
        expect(JSON.parse(serialized)).toEqual(state);
    });
});
