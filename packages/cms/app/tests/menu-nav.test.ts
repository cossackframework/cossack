import { describe, expect, it, vi } from 'vitest';
import type { MediaView, MenuItemView } from '@cossackframework/cms';

// The site view reads the app's plugins for theme overrides; none here.
vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { menuNav, searchForm } = await import('../src/cms/site-view');
const { html, renderToString } = await import('@cossackframework/renderer/server');

const item = (id: string, label: string, url: string | null, extra: Partial<MenuItemView> = {}): MenuItemView =>
    ({ id, label, url, kind: url === null ? 'heading' : 'link', newTab: false, description: '', className: '', attributes: {}, fields: {}, panel: null, children: [], ...extra });
const icon: MediaView = { url: '/media/rocket.svg', alt: '', width: 20, height: 20, contentType: 'image/svg+xml', caption: '', srcset: '', wideSrcset: '', sizes: '', placeholder: null, priority: false };
const helpers = { block: () => html`<div class="panel-card">Try it free</div>`, isActive: (url: string) => url === '/sales' };
const render = (items: readonly MenuItemView[], options = {}) => renderToString(menuNav(items, options, helpers)!);

describe('helpers.menu', () => {
    it('renders nothing for an empty menu', () => {
        expect(menuNav([], {}, helpers)).toBeNull();
    });

    it('draws a header menu with dropdowns and the small-screen disclosure', async () => {
        const markup = await render([item('home', 'Home', '/'), item('about', 'About', '/about', { children: [item('team', 'Team', '/about/team', { newTab: true, className: 'featured', attributes: { 'data-track': 'team' } })] })], { label: 'Primary' });
        expect(markup).toContain('<nav class="cms-nav cms-nav-dropdowns" aria-label="Primary">');
        expect(markup).toContain('cms-nav-has-sub');
        expect(markup).toContain('<div class="cms-nav-sub">');
        expect(markup).toMatch(/<a href="\/about\/team" class="cms-nav-sublink featured"[^>]*target="_blank"[^>]*data-track="team"/);
        expect(markup).toContain('<details class="cms-nav-mobile">');
        expect(markup).not.toContain('cms-mega');
    });

    it('opens a mega panel for an item with a panel or heading children', async () => {
        const products = item('products', 'Products', '/products', {
            description: 'Everything we make',
            panel: [{ _id: 'card', type: 'core/card', data: {}, html: {}, media: {} }],
            children: [
                item('loose', 'Overview', '/overview'),
                item('teams', 'By team', null, { children: [item('sales', 'Sales', '/sales', { description: 'Close deals faster', fields: { badge: 'New', icon } })] }),
            ],
        });
        const markup = await render([products]);
        expect(markup).toContain('data-mega');
        expect(markup).toContain('<div class="cms-mega" data-panel=""><div class="cms-mega-box">');
        // The loose link's column first, then the heading's.
        expect(markup.indexOf('/overview')).toBeLessThan(markup.indexOf('cms-mega-heading'));
        expect(markup).toContain('<p class="cms-mega-heading">By team</p>');
        expect(markup).toMatch(/<a href="\/sales" class="cms-mega-link" aria-current="page">/);
        expect(markup).toContain('<img class="cms-nav-icon" src="/media/rocket.svg"');
        expect(markup).toContain('<span class="cms-nav-badge">New</span>');
        expect(markup).toContain('<span class="cms-nav-description">Close deals faster</span>');
        expect(markup).toContain('<div class="cms-mega-panel cms-content"><div class="panel-card">Try it free</div></div>');
        // The disclosure shows the heading as text, not a link.
        expect(markup).toContain('<span class="cms-nav-treelink cms-nav-heading">By team</span>');
    });

    it('flattens one level in a row and nests the whole tree in a list', async () => {
        const items = [item('a', 'A', '/a', { children: [item('b', 'B', '/b')] }), item('h', 'Heading', null, { children: [item('c', 'C', '/c')] })];
        const inline = await render(items, { style: 'inline', label: 'Footer' });
        expect(inline).toContain('class="cms-nav cms-nav-inline" aria-label="Footer"');
        expect(inline.match(/<li class="cms-nav-item">/g)).toHaveLength(3);
        expect(inline).not.toContain('Heading');
        const list = await render(items, { style: 'list' });
        expect(list).toContain('<ul class="cms-nav-tree">');
        expect(list).toContain('<ul><li class="cms-nav-item"><a href="/b"');
    });
});

describe('helpers.search', () => {
    it('renders a box, or a button that opens one', async () => {
        const box = await renderToString(searchForm('/fr/search', { placeholder: 'Rechercher' }));
        expect(box).toContain('<form action="/fr/search" method="get" role="search" class="cms-search">');
        expect(box).toContain('placeholder="Rechercher" aria-label="Rechercher"');
        const toggle = await renderToString(searchForm('/search', { style: 'icon' }));
        expect(toggle).toContain('<details class="cms-search-toggle"><summary class="cms-search-button" aria-label="Search"');
    });
});
