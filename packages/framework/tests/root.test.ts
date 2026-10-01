import { describe, it, expect } from 'vitest';
import { renderRoot, serializeInitialState } from '../src/root';

const props = {
    body: '<p>Hello</p>',
    initialState: { message: 'hello' },
    manifest: {},
    headTags: [{ tag: 'title', children: 'Test' }],
    modulePreloads: ['/chunk.js'],
};

describe('renderRoot', () => {
    it('renders the real default template, state, styles and scripts', () => {
        const out = renderRoot(props);
        expect(out).toContain('<!DOCTYPE html>');
        expect(out).toContain('<html lang="en">');
        expect(out).toContain('<div id="root"><p>Hello</p></div>');
        expect(out).toContain('<script type="module" src="/src/client/entry-client.ts"></script>');
        expect(out).toContain('<title data-cossack="">Test</title>');
        expect(out).toContain('<link rel="stylesheet" href="/src/style.css">');
        expect(out).toContain('window.__INITIAL_STATE__ = {"message":"hello"}');
        expect(out).toContain('<link rel="modulepreload" href="/chunk.js">');
    });

    it('passes real helpers to a function template', () => {
        const out = renderRoot({
            ...props,
            htmlTemplate: ({ cossackScripts, cossackBody }) =>
                `<html lang="ar" dir="rtl"><head>${cossackScripts()}</head><body class="custom">${cossackBody()}</body></html>`,
        });
        expect(out).toContain('<html lang="ar" dir="rtl">');
        expect(out).toContain('<body class="custom"><div id="root"><p>Hello</p></div>');
        expect(out).toContain('window.__INITIAL_STATE__');
    });

    it('replaces string template placeholders including the locale', () => {
        const out = renderRoot({
            ...props, lang: 'fr',
            htmlTemplate: '<html lang="{{ cossackLang }}"><head>{{ cossackScripts }}</head><body>{{ cossackBody }}</body></html>',
        });
        expect(out).toContain('<html lang="fr">');
        expect(out).toContain('<div id="root"><p>Hello</p></div>');
        expect(out).toContain('type="module"');
        expect(out).not.toContain('{{');
    });

    it('escapes metadata values so they cannot inject tags or attributes', () => {
        const value = '\"><script>alert(1)</script><meta content="&';
        const out = renderRoot({ ...props, headTags: [
            { tag: 'meta', attributes: { name: 'description', content: value } },
        ] });
        expect(out).toContain('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;meta content=&quot;&amp;"');
        expect(out).not.toContain('<script>alert(1)</script>');
    });

    it('omits undefined and false attributes while preserving true booleans', () => {
        const out = renderRoot({ ...props, headTags: [
            { tag: 'script', attributes: { src: '/extra.js', async: true, defer: false, nonce: undefined } },
        ] });
        expect(out).toContain('src="/extra.js" async data-cossack=""');
        expect(out).not.toContain('nonce=');
        expect(out).not.toContain('defer');
    });

    it.each([{ css: undefined }, { css: [] }])('supports a production manifest with CSS $css', ({ css }) => {
        const out = renderRoot({ ...props, manifest: {
            'src/client/entry-client.ts': { file: 'assets/app.js', css },
        } });
        expect(out).toContain('src="/assets/app.js"');
        expect(out).not.toMatch(/rel=["']?stylesheet/);
        expect(out).not.toContain('/undefined');
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
