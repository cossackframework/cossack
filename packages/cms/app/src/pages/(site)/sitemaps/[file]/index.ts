import { Cossack, Page } from '@cossackframework/core';
import { isCmsError } from '@cossackframework/cms';
import { siteOrigin } from '../../../../cms/seo';
import registry from 'virtual:cossack-pages';
import { sitemapUrls, staticPages, xmlEscape } from '../../../../cms/sitemaps';

/** One sitemap: `/sitemaps/posts-1.xml` for entries, `/sitemaps/terms-categories.xml` for a taxonomy's archives. */
@Page({ transport: 'http' })
export default class Sitemap extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        try {
            if (await cms.settings.get('reading.discourageSearchEngines')) return new Response('Not found', { status: 404 });
            const urls = await sitemapUrls(cms, this.c.req.param('file') ?? '', { pages: staticPages(Object.keys(registry.pages)) });
            if (!urls) return new Response('Not found', { status: 404 });
            const origin = siteOrigin(this.c);
            const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.map(entry =>
                `<url><loc>${xmlEscape(`${origin}${entry.url}`)}</loc>${entry.updatedAt ? `<lastmod>${new Date(entry.updatedAt).toISOString()}</lastmod>` : ''}${entry.image ? `<image:image><image:loc>${xmlEscape(`${origin}${entry.image}`)}</image:loc></image:image>` : ''}</url>`).join('')}</urlset>\n`;
            return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
        } catch (error) {
            if (!isCmsError(error)) throw error;
            return new Response('Not found', { status: error.code === 'CMS_UNAVAILABLE' ? 503 : 404 });
        }
    }
}
