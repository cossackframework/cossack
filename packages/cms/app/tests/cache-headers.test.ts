import { describe, expect, it } from 'vitest';
import type { RenderedBlock } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { cacheHeaders, listedCollections } from '../src/cms/cache';

const block = (type: string, data: Record<string, unknown> = {}, children?: RenderedBlock[]): RenderedBlock => ({ _id: type, type, data, html: {}, media: {}, ...(children ? { children } : {}) });
const host = (hold: string, configured: boolean) => ({ settings: { get: async () => hold }, purge: { configured, tag: { site: () => 'cms:main' } } }) as unknown as CmsHost;

describe('cache headers of the site', () => {
    it('lists the collections of Latest entries blocks, nested ones too', () => {
        const blocks = [block('core/group', {}, [block('core/latest-entries', { collection: 'posts' })]), block('core/latest-entries', { collection: 'events' }), block('core/latest-entries', { collection: 'posts' }), block('core/paragraph')];
        expect([...listedCollections(blocks)]).toEqual(['posts', 'events']);
    });

    it('writes the hold and the site tag before the page\'s tags', async () => {
        expect(await cacheHeaders(host('auto', false), ['cms:main:c:posts', 'cms:main:e:posts:1'])).toEqual({
            'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
            'cache-tag': 'cms:main,cms:main:c:posts,cms:main:e:posts:1',
        });
        expect((await cacheHeaders(host('auto', true), []))['cache-control']).toBe('public, max-age=0, s-maxage=86400, stale-while-revalidate=60');
        expect((await cacheHeaders(host('auto', true), [], { max: 60 }))['cache-control']).toBe('public, max-age=0, s-maxage=60, stale-while-revalidate=60');
        expect(await cacheHeaders(host('none', true), [])).toEqual({ 'cache-control': 'private, no-store', 'cache-tag': 'cms:main' });
    });
});
