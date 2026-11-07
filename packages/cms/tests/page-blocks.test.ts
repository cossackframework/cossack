import { describe, expect, it } from 'vitest';
import { blockProblems, CORE_BLOCKS, SHARE_BRAND_URLS, SHARE_NETWORKS, validateBlocks, type Block } from '../src/index';
import { brandIcon } from '../src/server/brands';

const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));

describe('page blocks of the second wave', () => {
    it('declares slides, notices, countdowns, tables of contents, share buttons and breadcrumbs', () => {
        for (const name of ['core/slide', 'core/notice', 'core/countdown', 'core/toc', 'core/share', 'core/breadcrumbs']) {
            expect(blockProblems(types.get(name)!), name).toEqual([]);
        }
        expect(types.get('core/carousel')!.children).toEqual({ allowed: ['core/slide'], max: 12 });
        expect(types.get('core/slide')!.supports).toEqual({ background: true });
        expect(types.get('core/gallery')!.fields.layout).toMatchObject({ kind: 'enum', values: ['grid', 'logos'] });
        expect(types.get('core/share')!.fields.networks).toMatchObject({ kind: 'enum', multiple: true, values: [...SHARE_NETWORKS] });
    });

    it('validates a page of them', () => {
        const page: Block[] = [
            { _id: 'crumbs', type: 'core/breadcrumbs', data: { home: true, separator: 'slash' } },
            { _id: 'toc', type: 'core/toc', data: { title: 'Contents', depth: 'h3', numbered: true } },
            { _id: 'note', type: 'core/notice', data: { kind: 'warning', title: 'Heads up', text: 'Prices change on **Monday**.' } },
            { _id: 'timer', type: 'core/countdown', data: { until: 1_900_000_000_000, label: 'Launch', done: 'We are live', seconds: false } },
            { _id: 'hero', type: 'core/carousel', data: { aspect: 'wide', autoplay: true, interval: 6 }, children: [
                { _id: 's1', type: 'core/slide', data: { valign: 'bottom' }, style: { gradient: 'dusk', overlay: '#000000', overlayOpacity: 30 }, children: [{ _id: 's1h', type: 'core/heading', data: { text: 'Welcome' } }] },
            ] },
            { _id: 'logos', type: 'core/gallery', data: { images: [], columns: 4, layout: 'logos' } },
            { _id: 'share', type: 'core/share', data: { networks: ['facebook', 'email', 'copy'], label: 'Share', style: 'labels' } },
        ];
        expect(validateBlocks(page, types).errors).toEqual({});
        expect(validateBlocks([{ _id: 'share', type: 'core/share', data: { networks: ['myspace'] } }], types).errors).not.toEqual({});
        expect(validateBlocks([{ _id: 'timer', type: 'core/countdown', data: { until: 'tomorrow' } }], types).errors).toEqual({ 'timer.until': 'must be a safe integer.' });
        expect(validateBlocks([{ _id: 'loose', type: 'core/slide', data: {} }], types).errors).not.toEqual({});
    });

    it('knows the brand of every network the share block offers', () => {
        for (const network of SHARE_NETWORKS) {
            if (network === 'email' || network === 'copy') { expect(SHARE_BRAND_URLS[network]).toBeUndefined(); continue; }
            expect(brandIcon(SHARE_BRAND_URLS[network]!), network).toBeTruthy();
        }
    });
});
