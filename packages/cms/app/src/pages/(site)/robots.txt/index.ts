import { Cossack, Page } from '@cossackframework/core';
import { robotsTxtLines } from '@cossackframework/cms';
import { siteOrigin } from '../../../cms/seo';
import { trackCrawler } from '../../../cms/traffic';

/**
 * robots.txt: keeps crawlers out of the dashboard, the API, sign-in, previews and the IndexNow
 * key, blocks the crawler groups Settings → Crawlers turned off, and names the sitemap.
 * Settings → Reading can hide the whole site; Settings → SEO adds rules.
 */
@Page({ transport: 'http' })
export default class Robots extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        let hidden = false;
        let extra = '';
        let crawlers = { allowSearch: true, allowAiSearch: true, allowAiTraining: true, contentSignals: false };
        try {
            const settings = await cms.settings.all();
            hidden = settings['reading.discourageSearchEngines'];
            extra = settings['seo.robotsTxt'];
            crawlers = { allowSearch: settings['crawlers.allowSearch'], allowAiSearch: settings['crawlers.allowAiSearch'], allowAiTraining: settings['crawlers.allowAiTraining'], contentSignals: settings['crawlers.contentSignals'] };
        } catch { /* before setup: the defaults */ }
        trackCrawler(this.c, 'robots');
        const lines = robotsTxtLines({ hidden, crawlers, extra, sitemapUrl: `${siteOrigin(this.c)}/sitemap.xml` });
        return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }
}
