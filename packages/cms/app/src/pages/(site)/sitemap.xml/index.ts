import { Cossack, Page } from '@cossackframework/core';
import { isCmsError } from '@cossackframework/cms';
import { siteOrigin } from '../../../cms/seo';
import registry from 'virtual:cossack-pages';
import { sitemapFiles, staticPages, xmlEscape } from '../../../cms/sitemaps';
import { trackCrawler } from '../../../cms/traffic';

/** The sitemap index: one sitemap per 1,000 entries of each collection on the site, and one per taxonomy. */
@Page({ transport: 'http' })
export default class SitemapIndex extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        try {
            if (await cms.settings.get('reading.discourageSearchEngines')) return new Response('Not found', { status: 404 });
            trackCrawler(this.c, 'sitemap');
            const origin = siteOrigin(this.c);
            const files = await sitemapFiles(cms, { pages: staticPages(Object.keys(registry.pages)) });
            const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map(file => `<sitemap><loc>${xmlEscape(`${origin}/sitemaps/${file}`)}</loc></sitemap>`).join('')}</sitemapindex>\n`;
            return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
        } catch (error) {
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            return new Response('Not available yet', { status: 503 });
        }
    }
}
