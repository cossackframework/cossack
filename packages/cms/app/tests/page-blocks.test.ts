import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaView, RenderedBlock, SiteTheme, SiteView } from '@cossackframework/cms';

// The site view reads the app's plugins for theme overrides; none here.
vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { themeHelpers, shareUrl, breadcrumbTrail } = await import('../src/cms/site-view');
const { renderToString } = await import('@cossackframework/renderer/server');

const theme = { layout: () => null, entry: () => null, archive: () => null } as unknown as SiteTheme;
const crumbs = [{ label: 'Home', url: '/' }, { label: 'Blog', url: '/blog' }, { label: 'Hello world', url: null }];
const site = { title: 'Acme', tagline: '', logo: null, homeUrl: '/', searchUrl: '/search', url: 'https://acme.test/blog/hello', breadcrumbs: crumbs };
const helpers = themeHelpers(theme, { name: null, options: {}, site }, () => false);
const block = (type: string, data: Record<string, unknown>, extra: Partial<RenderedBlock> = {}): RenderedBlock => ({ _id: data._id as string ?? type.replace('core/', ''), type, data, html: {}, media: {}, ...extra });
const heading = (id: string, text: string): RenderedBlock => ({ _id: id, type: 'core/heading', data: { text, level: 'h2' }, html: {}, media: {} });
const logo: MediaView = { url: '/media/l1/acme.png', alt: 'Acme', width: 400, height: 120, contentType: 'image/png', caption: '', srcset: '', wideSrcset: '', placeholder: null, sizes: '' };
const render = async (input: RenderedBlock) => (await renderToString(helpers.block(input))).replace(/\s*\n\s*/g, '');

afterEach(() => vi.useRealTimers());

describe('page blocks of the second wave', () => {
    it('renders a carousel of slides, each filling its frame over its background', async () => {
        const html = await render({ ...block('core/carousel', { _id: 'hero', aspect: 'wide' }), children: [
            { ...block('core/slide', { _id: 's1', valign: 'bottom' }), style: { gradient: 'dusk' }, children: [heading('h1', 'Welcome')] },
            { ...block('core/slide', { _id: 's2' }), children: [heading('h2', 'Again')] },
        ] });
        expect(html).toContain('aria-roledescription="carousel" aria-label="Slides"');
        expect(html).toContain('<div class="cms-carousel-slide cms-carousel-blockslide" id="hero-slide-1" aria-roledescription="slide" aria-label="1 / 2"><div class="cms-block cms-gradient-dusk" style="background-image: var(--cms-gradient-dusk)"><div class="cms-slide" data-valign="bottom"><h2');
        expect(html).toContain('<div class="cms-slide" data-valign="center"><h2');
        expect(html.match(/role="tab"/g)).toHaveLength(2);
        expect(html).toContain('aria-label="Slide 1"');
    });

    it('renders a gallery as a wall of logos', async () => {
        const html = await render(block('core/gallery', { images: ['l1', 'missing'], columns: 4, layout: 'logos' }, { media: { l1: logo } }));
        expect(html).toContain('<div class="cms-logos my-6" style="--cms-logo-columns: 4"><div class="cms-logo"><img src="/media/l1/acme.png"');
        expect(html).toContain('class="cms-logo-image"');
        expect(html.match(/<img /g)).toHaveLength(1);
    });

    it('renders a notice of a kind, with its icon unless asked not to', async () => {
        const warning = await render(block('core/notice', { kind: 'warning', title: 'Heads up', text: 'Prices change.' }, { html: { text: '<p>Prices change.</p>' } }));
        expect(warning).toContain('<aside class="cms-notice my-6" data-kind="warning" role="note"><svg');
        expect(warning).toContain('class="cms-icon cms-notice-icon"');
        expect(warning).toContain('<div class="cms-notice-body"><p class="cms-notice-title">Heads up</p><div class="cms-prose');
        const bare = await render(block('core/notice', { kind: 'nonsense', text: 'Plain', showIcon: false }));
        expect(bare).toBe('<aside class="cms-notice my-6" data-kind="info" role="note"><div class="cms-notice-body">Plain</div></aside>');
    });

    it('renders a countdown with what is left now, and what shows once it has passed', async () => {
        vi.useFakeTimers({ now: Date.UTC(2026, 0, 1), toFake: ['Date'] });
        const until = Date.now() + ((1 * 86_400 + 2 * 3600 + 3 * 60 + 4) * 1000);
        const html = await render(block('core/countdown', { until, label: 'Launch in', done: 'We are live!' }));
        expect(html).toContain(`<div class="cms-countdown my-6" data-until="${until}"><p class="cms-countdown-label">Launch in</p><div class="cms-countdown-units">`);
        expect(html).toContain('<span class="cms-countdown-value" data-unit="days">1</span><span class="cms-countdown-name">Days</span>');
        expect(html).toContain('data-unit="hours">02</span>');
        expect(html).toContain('data-unit="minutes">03</span>');
        expect(html).toContain('data-unit="seconds">04</span>');
        expect(html).toContain('<p class="cms-countdown-done" hidden>We are live!</p>');
        const over = await render(block('core/countdown', { until: Date.now() - 1000, done: 'We are live!', seconds: false }));
        expect(over).toContain('<div class="cms-countdown-units" hidden>');
        expect(over).not.toContain('data-unit="seconds"');
        expect(over).toContain('<p class="cms-countdown-done">We are live!</p>');
        expect(await render(block('core/countdown', { until: 'soon' }))).toBe('');
    });

    it('renders a table of contents from the headings the server found, down to a level', async () => {
        const headings = [{ id: 'intro', text: 'Intro', level: 2 }, { id: 'details', text: 'Details', level: 3 }, { id: 'fine', text: 'Fine print', level: 4 }];
        const html = await render(block('core/toc', { _id: 'toc', title: 'Contents', depth: 'h3' }, { headings }));
        expect(html).toContain('<nav class="cms-toc my-6" aria-labelledby="toc-title"><p class="cms-toc-title" id="toc-title">Contents</p><ul class="cms-toc-list"><li class="cms-toc-item" data-level="2"><a href="#intro">Intro</a></li><li class="cms-toc-item" data-level="3"><a href="#details">Details</a></li></ul></nav>');
        const numbered = await render(block('core/toc', { _id: 'toc', title: '', depth: 'h4', numbered: true }, { headings }));
        expect(numbered).toContain('<nav class="cms-toc my-6" aria-label="Table of contents"><ol class="cms-toc-list">');
        expect(numbered).toContain('href="#fine"');
        expect(await render(block('core/toc', { title: 'Contents' }))).toBe('');
    });

    it('renders share buttons for the page, by its address and title', async () => {
        const html = await render(block('core/share', { networks: ['facebook', 'email', 'copy', 'myspace'], label: 'Share', style: 'icons' }, { icons: { facebook: { title: 'Facebook', hex: '0866FF', path: 'M1 1h2' } } }));
        expect(html).toContain('<div class="cms-share my-6" data-style="icons"><span class="cms-share-label">Share</span><ul class="cms-share-list">');
        expect(html).toContain('<a class="cms-share-link" href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Facme.test%2Fblog%2Fhello" data-network="facebook" style="--cms-brand: #0866FF" title="Facebook" aria-label="Facebook" rel="noopener" target="_blank"><svg');
        expect(html).toContain('<a class="cms-share-link" href="mailto:?subject=Hello%20world&amp;body=https%3A%2F%2Facme.test%2Fblog%2Fhello" data-network="email" title="Email" aria-label="Email"><svg');
        expect(html).toContain('<button type="button" class="cms-share-link" data-network="copy" data-url="https://acme.test/blog/hello" title="Copy link" aria-label="Copy link"><svg');
        expect(html).toContain('<span class="cms-share-copied" aria-live="polite">Copied</span>');
        expect(html).not.toContain('myspace');
        const labelled = await render(block('core/share', { networks: ['x'], label: '', style: 'labels' }));
        expect(labelled).toContain('<span class="cms-share-name">X</span>');
        expect(labelled).not.toContain('cms-share-label');
        expect(await render(block('core/share', { networks: [] }))).toBe('');
        expect(shareUrl('whatsapp', 'https://a.test/p', 'A post')).toBe('https://wa.me/?text=A%20post%20https%3A%2F%2Fa.test%2Fp');
        expect(shareUrl('copy', 'https://a.test/p', 'A post')).toBeNull();
    });

    it('renders the breadcrumbs of the page, as the block and as the helper', async () => {
        const html = await render(block('core/breadcrumbs', { separator: 'slash' }));
        expect(html).toBe('<nav class="cms-breadcrumbs" aria-label="Breadcrumb" data-separator="slash"><ol class="cms-breadcrumbs-list"><li class="cms-breadcrumb"><a href="/">Home</a></li><li class="cms-breadcrumb"><a href="/blog">Blog</a></li><li class="cms-breadcrumb"><span aria-current="page">Hello world</span></li></ol></nav>');
        expect(await render(block('core/breadcrumbs', { home: false }))).toContain('<ol class="cms-breadcrumbs-list"><li class="cms-breadcrumb"><a href="/blog">Blog</a></li>');
        expect((await renderToString(helpers.breadcrumbs(site as unknown as SiteView, { class: 'mb-4', separator: 'arrow' })!)).replace(/\s*\n\s*/g, '')).toContain('<nav class="cms-breadcrumbs mb-4" aria-label="Breadcrumb" data-separator="arrow">');
        // The home page has a trail of one, so nothing shows.
        expect(breadcrumbTrail([{ label: 'Home', url: null }])).toBeNull();
        expect(breadcrumbTrail(undefined)).toBeNull();
    });
});
