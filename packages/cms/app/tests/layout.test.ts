import { describe, expect, it, vi } from 'vitest';
import type { MediaView, RenderedBlock, SiteTheme } from '@cossackframework/cms';

// The site view reads the app's plugins for theme overrides; none here.
vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { themeHelpers, alignOf } = await import('../src/cms/site-view');
const { renderToString } = await import('@cossackframework/renderer/server');

const theme = { layout: () => null, entry: () => null, archive: () => null } as unknown as SiteTheme;
const helpers = themeHelpers(theme, { name: null, options: {} }, () => false);
const paragraph = (id: string, text: string): RenderedBlock => ({ _id: id, type: 'core/paragraph', data: { text }, html: { text: `<p>${text}</p>` }, media: {} });
const group = (id: string, data: Record<string, unknown>, children: RenderedBlock[], extra: Partial<RenderedBlock> = {}): RenderedBlock => ({ _id: id, type: 'core/group', data, html: {}, media: {}, children, ...extra });
const picture: MediaView = { url: '/media/f1/sea.jpg', alt: '', width: 2000, height: 1200, contentType: 'image/jpeg', caption: '', srcset: '/media/f1/sea.jpg?w=640 640w, /media/f1/sea.jpg?w=1920 1920w', wideSrcset: '', placeholder: null, sizes: '', focus: { x: 0.5, y: 0.2 } };
const clip: MediaView = { url: '/media/v1/loop.mp4', alt: '', width: null, height: null, contentType: 'video/mp4', caption: '', srcset: '', wideSrcset: '', placeholder: null, sizes: '' };
const compact = (html: string) => html.replace(/\s*\n\s*/g, '');

describe('the constrained layout', () => {
    it('wraps each block of a layout in an item at its width', async () => {
        const html = compact(await renderToString(helpers.layout([
            paragraph('p1', 'Text'),
            { _id: 'cols', type: 'core/columns', data: { align: 'wide' }, html: {}, media: {}, children: [] },
            group('g1', { align: 'full' }, [paragraph('p2', 'Inside'), group('g2', { align: 'wide' }, [])]),
            group('g3', { align: 'left' }, []),
        ], { class: 'py-4' })));
        expect(html).toContain('<div class="cms-layout py-4">');
        expect(html).toContain('<div class="cms-item" data-align="content"><div class="cms-prose');
        expect(html).toContain('<div class="cms-item" data-align="wide"><div class="cms-columns"');
        // A full-width group renders its children as items too, so a wide child stays wide inside the band.
        expect(html).toContain('<div class="cms-item" data-align="full"><div class="cms-group" data-align="full" data-direction="column" data-justify="start"><div class="cms-item" data-align="content"><div class="cms-prose');
        expect(html).toContain('<div class="cms-item" data-align="wide"><div class="cms-group" data-align="wide"');
        expect(html).toContain('<div class="cms-item" data-align="left"><div class="cms-group" data-align="left"');
        // A full-width row keeps its children as they are: the stylesheet lays the row within the measure.
        const row = compact(await renderToString(helpers.block(group('r', { align: 'full', direction: 'row', justify: 'between' }, [paragraph('p3', 'Logo')]))!));
        expect(row).toContain('<div class="cms-group" data-align="full" data-direction="row" data-justify="between"><div class="cms-prose');
        expect(row).not.toContain('cms-item');
    });

    it('reads a block\'s width from its Width field', () => {
        expect(alignOf({ data: {} })).toBe('content');
        expect(alignOf({ data: { align: 'full' } })).toBe('full');
        expect(alignOf({ data: { align: 'sideways' } })).toBe('content');
    });

    it('gives a group its height and vertical alignment, and its styled wrapper its width', async () => {
        const hero = compact(await renderToString(helpers.block(group('h', { align: 'center', height: 'tall', valign: 'center' }, [], { style: { background: 'brand' } }))!));
        expect(hero).toContain('<div class="cms-block cms-bg-brand" data-align="center" style="background-color: var(--cms-color-brand)"><div class="cms-group" data-align="center" data-direction="column" data-justify="start" data-height="tall" data-valign="center">');
        const plain = compact(await renderToString(helpers.block(group('p', { height: 'auto', valign: 'top' }, []))!));
        expect(plain).toContain('<div class="cms-group" data-align="content" data-direction="column" data-justify="start"></div>');
    });

    it('places a background video behind a group, with the image as its poster', async () => {
        const band = compact(await renderToString(helpers.block(group('b', { align: 'full' }, [paragraph('p', 'Over it')], { style: { image: 'f1', video: 'v1', overlay: '#000', overlayOpacity: 60 }, media: { f1: picture, v1: clip } }))!));
        expect(band).toContain('<div class="cms-block cms-has-image cms-has-overlay cms-has-video" data-align="full" style="background-size: cover; background-position: 50% 20%; background-repeat: no-repeat; background-image: url(&quot;/media/f1/sea.jpg?w=1920&quot;); --cms-overlay: color-mix(in srgb, #000 60%, transparent)">');
        expect(band).toContain('<video class="cms-bg-video" src="/media/v1/loop.mp4" poster="/media/f1/sea.jpg" autoplay muted loop playsinline disablepictureinpicture preload="auto" aria-hidden="true" tabindex="-1"></video><div class="cms-group"');
        // A video the media did not resolve renders no element.
        const silent = compact(await renderToString(helpers.block(group('s', {}, [], { style: { video: 'gone', background: 'brand' } }))!));
        expect(silent).not.toContain('<video');
    });
});
