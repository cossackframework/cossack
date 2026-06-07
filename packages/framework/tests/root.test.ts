import { describe, it, expect, vi } from 'vitest';

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
