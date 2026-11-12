import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { CmsHost } from '@cossackframework/cms/server';

vi.mock('virtual:cossack-plugins', () => ({ default: [] }));
const { default: MediaFile } = await import('../src/pages/(site)/media/[id]/[name]/index');

/** A host with one uploaded image and its resized variant. */
function app() {
    const file = { id: 'f1', name: 'photo.jpg', contentType: 'image/jpeg', size: 3 };
    const cms = {
        purge: { tag: { site: () => 'cms:main' } },
        files: {
            variant: async (id: string) => id === 'f1' ? { body: new Response('jpg').body!, contentType: 'image/webp', size: 3 } : null,
            open: async (id: string) => id === 'f1' ? { file, body: new Response('jpg').body! } : null,
        },
    } as unknown as CmsHost;
    const server = new Hono();
    server.use('*', async (c, next) => { c.set('cms' as never, cms as never); await next(); });
    server.get('/media/:id/:name', c => {
        const page = new MediaFile() as unknown as { c: unknown; get: () => Promise<Response> };
        page.c = c;
        return page.get();
    });
    return server;
}

describe('media answers', () => {
    it('carry the site cache tag, so a media change purges them', async () => {
        const original = await app().request('/media/f1/photo.jpg');
        expect(original.headers.get('cache-tag')).toBe('cms:main');
        const resized = await app().request('/media/f1/photo.jpg?w=320');
        expect(resized.headers.get('cache-tag')).toBe('cms:main');
    });

    it('keep an original for an hour, not for good; a resized copy is named by its version', async () => {
        expect((await app().request('/media/f1/photo.jpg')).headers.get('cache-control')).toBe('public, max-age=3600');
        expect((await app().request('/media/f1/photo.jpg?w=320')).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    });
});
