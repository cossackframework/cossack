import { Cossack, Page } from '@cossackframework/core';
import { siteOrigin } from '../../../cms/seo';

/**
 * robots.txt: keeps crawlers out of the dashboard, the API, sign-in and previews, and names
 * the sitemap. Settings → Reading can hide the whole site; Settings → SEO adds rules.
 */
@Page({ transport: 'http' })
export default class Robots extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        let hidden = false;
        let extra = '';
        try {
            const settings = await cms.settings.all();
            hidden = settings['reading.discourageSearchEngines'];
            extra = settings['seo.robotsTxt'].trim();
        } catch { /* before setup: the defaults */ }
        const lines = hidden ? ['User-agent: *', 'Disallow: /']
            : ['User-agent: *', 'Disallow: /dashboard/', 'Disallow: /api/', 'Disallow: /auth/', 'Disallow: /preview/', ...(extra ? ['', extra] : []), '', `Sitemap: ${siteOrigin(this.c)}/sitemap.xml`];
        return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }
}
