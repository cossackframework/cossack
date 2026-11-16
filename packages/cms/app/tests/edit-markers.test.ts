import { describe, expect, it, vi } from 'vitest';
import type { RenderedBlock, SiteTheme } from '@cossackframework/cms';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
vi.stubGlobal('__', (value: string) => value);
const { themeHelpers, tagDocument } = await import('../src/cms/site-view');
const { renderToString } = await import('@cossackframework/renderer/server');

const theme = { layout: () => null, entry: () => null, archive: () => null } as unknown as SiteTheme;
const paragraph = (id: string, text: string): RenderedBlock => ({ _id: id, type: 'core/paragraph', data: { text }, html: { text: `<p>${text}</p>` }, media: {} });

describe('edit markers', () => {
    it('name the block, its document and a lock', async () => {
        const helpers = themeHelpers(theme, { name: null, options: {}, editing: true }, () => false);
        const own = await renderToString(helpers.block([paragraph('p1', 'Hello')])!);
        expect(own).toContain('<div data-cms-edit="block" data-block-id="p1" data-cms-doc="entry" style="display: contents">');
        const area = await renderToString(helpers.block(tagDocument([{ ...paragraph('g1', ''), type: 'core/group', children: [paragraph('p2', 'Inside')] }], 'area:header', true))!);
        expect(area).toContain('data-block-id="g1" data-cms-doc="area:header" data-cms-locked=""');
        expect(area).toContain('data-block-id="p2" data-cms-doc="area:header" data-cms-locked=""');
        // Visitors get no markers.
        const plain = await renderToString(themeHelpers(theme, { name: null, options: {} }, () => false).block([paragraph('p1', 'Hello')])!);
        expect(plain).not.toContain('data-cms-edit');
    });
});
