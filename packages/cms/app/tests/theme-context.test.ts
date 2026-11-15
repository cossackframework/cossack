import { describe, expect, it, vi } from 'vitest';
import { html } from '@cossackframework/renderer';
import type { BlockContext, RenderedBlock, SiteTheme } from '@cossackframework/cms';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { themeContext, siteBasics, fallbackTheme } = await import('../src/cms/site-view');
const { renderToString } = await import('@cossackframework/renderer/server');

const compact = async (value: Parameters<typeof renderToString>[0]) => (await renderToString(value)).replace(/\s*\n\s*/g, '');
const site = { title: 'Acme', tagline: 'Skates', logo: '/media/l/acme.png', homeUrl: '/', searchUrl: '/search', locale: 'en', url: 'https://acme.test/', breadcrumbs: [] };
const menus = { primary: [] };

describe('the context templates receive', () => {
    it('gives a page template the site as far as the page knows it, beside the helpers', () => {
        const context = themeContext(fallbackTheme, { name: null, options: { accent: 'red' }, site, menus }, () => false);
        expect(context.site).toEqual({ ...site, menus, languages: [] });
        expect(context.helpers.options).toEqual({ accent: 'red' });
        // Before setup there is no site yet: blanks, not a crash.
        expect(siteBasics({})).toMatchObject({ title: '', homeUrl: '/', searchUrl: '/search', breadcrumbs: [], menus: {}, languages: [] });
    });

    it('calls a theme block renderer with the block, the site and the helpers', async () => {
        const seen: BlockContext[] = [];
        const theme = { ...fallbackTheme, blocks: { 'core/heading': (context: BlockContext) => { seen.push(context); return html`<h2>${context.site.title}: ${String(context.block.data.text)}</h2>`; } } } as SiteTheme;
        const { helpers } = themeContext(theme, { name: null, options: {}, site }, () => false);
        const block: RenderedBlock = { _id: 'h', type: 'core/heading', data: { text: 'Hi', level: 'h2' }, html: {}, media: {} };
        expect(await compact(helpers.block([block, { ...block, _id: 'h2' }]))).toBe('<h2>Acme: Hi</h2><h2>Acme: Hi</h2>');
        expect(seen[0]!.helpers).toBe(helpers);
        expect(seen[1]!.site).toBe(seen[0]!.site);
    });

    it('draws the logo from the site without passing it', async () => {
        const { helpers } = themeContext(fallbackTheme, { name: null, options: {}, site }, () => false);
        expect(await compact(helpers.logo({ class: 'h-8' }))).toBe('<img src="/media/l/acme.png" alt="Acme" class="cms-site-logo object-contain h-8">');
        expect(themeContext(fallbackTheme, { name: null, options: {} }, () => false).helpers.logo()).toBeNull();
    });
});
