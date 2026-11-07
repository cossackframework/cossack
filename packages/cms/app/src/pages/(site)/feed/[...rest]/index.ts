import { Cossack, Page } from '@cossackframework/core';
import { feedResponse } from '../../../../cms/feeds';
import { trackCrawler } from '../../../../cms/traffic';

/** `/feed/atom`, `/feed/json`, `/feed/<collection>` and `/feed/<collection>/<format>`, with `?term=<slug>` on each. */
@Page({ transport: 'http' })
export default class FeedOf extends Cossack {
    async get() {
        trackCrawler(this.c, 'feed');
        const path = this.c.req.param('rest') ?? '';
        return feedResponse(this.c.get('cms'), this.c.req.raw, path.split('/').filter(Boolean));
    }
}
