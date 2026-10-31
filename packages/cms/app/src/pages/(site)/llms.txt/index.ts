import { Cossack, Page } from '@cossackframework/core';
import { isCmsError } from '@cossackframework/cms';
import { llmsTxt } from '../../../cms/machine';
import { siteOrigin } from '../../../cms/seo';
import { trackCrawler } from '../../../cms/traffic';

/** `/llms.txt`: the site for AI assistants, as Settings → SEO allows. Off with the site hidden from search engines. */
@Page({ transport: 'http' })
export default class LlmsTxt extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        try {
            const settings = await cms.settings.all();
            if (!settings['seo.llmsTxt'] || settings['reading.discourageSearchEngines']) return new Response('Not found', { status: 404 });
            trackCrawler(this.c, 'llms');
            return new Response(await llmsTxt(cms, siteOrigin(this.c)), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
        } catch (error) {
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            return new Response('Not available yet', { status: 503 });
        }
    }
}
