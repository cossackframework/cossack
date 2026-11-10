import { describe, expect, it, vi } from 'vitest';
import type { MediaView, RenderedBlock, SiteTheme } from '@cossackframework/cms';

// The site view reads the app's plugins for theme overrides; none here.
vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { themeHelpers, siteIcon } = await import('../src/cms/site-view');
const { renderToString } = await import('@cossackframework/renderer/server');

const theme = { layout: () => null, entry: () => null, archive: () => null } as unknown as SiteTheme;
const helpers = themeHelpers(theme, { name: null, options: {} }, () => false);
const block = (type: string, data: Record<string, unknown>, extra: Partial<RenderedBlock> = {}): RenderedBlock => ({ _id: data._id as string ?? type.replace('core/', ''), type, data, html: {}, media: {}, ...extra });
const paragraph = (id: string, text: string): RenderedBlock => ({ _id: id, type: 'core/paragraph', data: { text }, html: { text: `<p>${text}</p>` }, media: {} });
const portrait: MediaView = { url: '/media/a1/ada.jpg', alt: 'Ada', width: 400, height: 400, contentType: 'image/jpeg', caption: '', srcset: '', wideSrcset: '', placeholder: null, sizes: '' };
const render = async (input: RenderedBlock) => (await renderToString(helpers.block(input))).replace(/\s*\n\s*/g, '');

describe('section blocks', () => {
    it('draws a site icon as an inline SVG, or nothing for a name outside the set', async () => {
        const svg = await renderToString(siteIcon('check-circle', { class: 'size-6' })!);
        expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="cms-icon size-6"');
        expect(svg).toContain('aria-hidden="true"');
        expect(svg).toContain('<use href="/assets/icons/line/hot.');
        expect(await renderToString(helpers.icon('star', { label: 'Favourite' })!)).toContain('role="img" aria-label="Favourite"');
        expect(siteIcon('no-such-icon')).toBeNull();
        expect(helpers.icon('')).toBeNull();
    });

    it('renders tabs with the first panel active and every panel in the page', async () => {
        const html = await render({ ...block('core/tabs', { _id: 'tabs' }), children: [
            { ...block('core/tab', { _id: 't1', label: 'Plans', icon: 'tag' }), children: [paragraph('p1', 'Monthly')] },
            { ...block('core/tab', { _id: 't2', label: 'Reviews' }), children: [paragraph('p2', 'Loved it')] },
        ] });
        expect(html).toContain('<div class="cms-tabs my-6"><div class="cms-tablist" role="tablist">');
        expect(html).toContain('<button type="button" role="tab" class="cms-tab" id="tabs-tab-1" aria-controls="tabs-panel-1" aria-selected="true" tabindex="0"><svg');
        expect(html).toContain('aria-selected="false" tabindex="-1"><span>Reviews</span></button>');
        expect(html).toContain('<section class="cms-tabpanel" role="tabpanel" id="tabs-panel-1" aria-labelledby="tabs-tab-1" data-active="" tabindex="0"><h3 class="cms-tabpanel-title">Plans</h3><div class="cms-tab-content">');
        expect(html).toContain('<section class="cms-tabpanel" role="tabpanel" id="tabs-panel-2" aria-labelledby="tabs-tab-2" tabindex="0">');
        expect(html).toContain('Loved it');
        expect(await render(block('core/tabs', { _id: 'empty' }))).toBe('');
    });

    it('renders an accordion as details, open where asked, and a spacer of a size', async () => {
        const html = await render({ ...block('core/accordion', { _id: 'acc', single: true }), children: [
            { ...block('core/accordion-item', { _id: 'a1', label: 'Shipping', open: true }), children: [paragraph('p1', 'Free over $50')] },
            { ...block('core/accordion-item', { _id: 'a2', label: 'Returns' }), children: [] },
        ] });
        expect(html).toContain('<div class="cms-accordion my-6" id="acc-accordion" data-single="true">');
        expect(html).toContain('<details class="cms-accordion-item" open><summary class="cms-accordion-summary">Shipping<span class="cms-accordion-caret" aria-hidden="true"></span></summary><div class="cms-accordion-body"><div class="cms-prose');
        expect(html).toContain('<details class="cms-accordion-item"><summary class="cms-accordion-summary">Returns');
        expect(await render(block('core/spacer', { size: 'huge' }))).toBe('<div class="cms-spacer" data-size="huge" aria-hidden="true"></div>');
    });

    it('renders a card with an icon in place of the image, boxed or plain', async () => {
        const html = await render(block('core/card', { title: 'Fast delivery', icon: 'delivery', style: 'plain', text: 'Next day.' }, { html: { text: '<p>Next day.</p>' } }));
        expect(html).toContain('<div class="cms-card" data-layout="none" data-style="plain"><div class="cms-card-body"><div class="cms-card-icon"><svg');
        expect(html).toContain('class="cms-icon size-8"');
        expect(html).toContain('<h3 class="text-lg font-semibold">Fast delivery</h3>');
        const boxed = await render(block('core/card', { title: 'Plain', icon: 'no-such-icon' }));
        expect(boxed).toContain('data-style="boxed"');
        expect(boxed).not.toContain('cms-card-icon');
    });

    it('renders an icon list in columns, each item with its icon and link', async () => {
        const html = await render({ ...block('core/icon-list', { _id: 'list', columns: 2, size: 'large' }), children: [
            block('core/icon-item', { _id: 'i1', icon: 'bolt', text: 'Fast', url: '/speed' }),
            block('core/icon-item', { _id: 'i2', icon: '', text: 'Safe' }),
        ] });
        expect(html).toContain('<ul class="cms-icon-list my-4" data-size="large" style="--cms-icon-columns: 2">');
        expect(html).toContain('<li class="cms-icon-item"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="cms-icon cms-icon-item-icon"');
        expect(html).toContain('<a href="/speed">Fast</a>');
        expect(html).toContain('<span>Safe</span>');
        expect(html.match(/<svg /g)).toHaveLength(2);
    });

    it('renders a testimonial with stars, the photo and a linked name', async () => {
        const html = await render(block('core/testimonial', { text: 'It just works.', name: 'Ada', role: 'CTO, Acme', avatar: 'a1', rating: 4, url: 'https://x.com/ada/status/1' }, { html: { text: '<p>It just works.</p>' }, media: { a1: portrait } }));
        expect(html).toContain('<figure class="cms-testimonial my-6"><div class="cms-rating" role="img" aria-label="4 / 5">');
        expect(html.match(/data-filled="true"/g)).toHaveLength(4);
        expect(html.match(/data-filled="false"/g)).toHaveLength(1);
        expect(html).toContain('<blockquote class="cms-testimonial-quote"><div class="cms-prose');
        expect(html).toContain('<img src="/media/a1/ada.jpg"');
        expect(html).toContain('<div class="cms-testimonial-name"><a href="https://x.com/ada/status/1" rel="noopener">Ada</a></div><div class="cms-testimonial-role">CTO, Acme</div>');
        expect(await render(block('core/testimonial', { text: 'Plain', name: 'Bo', rating: 0 }))).not.toContain('cms-rating');
    });

    it('renders a stat with its number kept for the count-up, and a pricing plan', async () => {
        const stat = await render(block('core/stat', { value: '1,250', prefix: '$', suffix: '+', label: 'Raised', animate: true }));
        expect(stat).toContain('<div class="cms-stat my-6" data-animate="true"><p class="cms-stat-value"><span class="cms-stat-prefix">$</span><span class="cms-stat-number" data-value="1,250">1,250</span><span class="cms-stat-suffix">+</span></p><p class="cms-stat-label">Raised</p></div>');
        expect(await render(block('core/stat', { value: '98', animate: false }))).toContain('data-animate="false"');
        const plan = await render(block('core/pricing', { name: 'Pro', price: '$29', period: 'per month', description: 'For teams.', features: ['Everything in Free', '', 'Priority support'], buttonLabel: 'Start', buttonUrl: '/signup', highlighted: true, badge: 'Most popular' }));
        expect(plan).toContain('<div class="cms-pricing my-6" data-highlighted="true"><span class="cms-pricing-badge">Most popular</span><h3 class="cms-pricing-name">Pro</h3>');
        expect(plan).toContain('<p class="cms-pricing-price"><span class="cms-pricing-amount">$29</span> <span class="cms-pricing-period">per month</span></p><p class="cms-pricing-description">For teams.</p>');
        expect(plan.match(/<li><svg/g)).toHaveLength(2);
        expect(plan).toContain('<a href="/signup" class="inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium no-underline bg-primary text-primary-foreground hover:opacity-90">Start</a>');
        expect(await render(block('core/pricing', { name: 'Free', price: '$0' }))).not.toContain('cms-pricing-action');
    });

    it('renders social links with the brands the server resolved, and site icons for the rest', async () => {
        const html = await render(block('core/social-links', { links: ['https://x.com/acme', 'mailto:hi@acme.test', 'https://social.example/@acme'], size: 'large', shape: 'square', labels: false },
            { icons: { 'https://x.com/acme': { title: 'X', hex: '000000', path: 'M1 1h2' } } }));
        expect(html).toContain('<ul class="cms-social my-4" data-size="large" data-shape="square" data-labels="false">');
        expect(html).toContain('<a class="cms-social-link" href="https://x.com/acme" style="--cms-brand: #000000" title="X" aria-label="X" rel="me noopener" target="_blank"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="cms-social-icon" aria-hidden="true" focusable="false"><path d="M1 1h2"></path></svg></a>');
        expect(html).toContain('<a class="cms-social-link" href="mailto:hi@acme.test" title="Email" aria-label="Email"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" class="cms-icon cms-social-icon"');
        expect(html).toContain('title="social.example" aria-label="social.example" rel="me noopener" target="_blank">');
        const labelled = await render(block('core/social-links', { links: ['https://x.com/acme'], labels: true }, { icons: { 'https://x.com/acme': { title: 'X', hex: '000000', path: 'M1 1h2' } } }));
        expect(labelled).toContain('title="X" rel="me noopener" target="_blank"><svg');
        expect(labelled).toContain('<span class="cms-social-label">X</span>');
        expect(await render(block('core/social-links', { links: [] }))).toBe('');
    });

    it('renders a map of an address, or an embed URL it checks again, and nothing else', async () => {
        const byAddress = await render(block('core/map', { address: 'Hanoi, Vietnam', zoom: 12, height: 'tall', caption: 'Find us' }));
        expect(byAddress).toContain('<figure class="cms-map my-6" data-height="tall"><iframe class="cms-map-frame" src="https://maps.google.com/maps?q=Hanoi%2C%20Vietnam&amp;z=12&amp;output=embed" title="Find us" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><figcaption class="cms-map-caption">Find us</figcaption></figure>');
        const embed = await render(block('core/map', { url: 'https://www.openstreetmap.org/export/embed.html?bbox=1,2,3,4' }));
        expect(embed).toContain('src="https://www.openstreetmap.org/export/embed.html?bbox=1,2,3,4" title="Map"');
        expect(await render(block('core/map', { url: 'https://evil.example/maps/embed?x' }))).toBe('');
        expect(await render(block('core/map', {}))).toBe('');
    });
});
