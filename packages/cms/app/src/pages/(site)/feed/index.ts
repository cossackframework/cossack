import { Cossack, Page } from '@cossackframework/core';
import { feedResponse } from '../../../cms/feeds';
import { trackCrawler } from '../../../cms/traffic';

/** The posts feed as RSS 2.0, sized and filled by Settings → Reading; `/feed/atom`, `/feed/json` and other collections are beside it. */
@Page({ transport: 'http' })
export default class Feed extends Cossack {
    async get() {
        trackCrawler(this.c, 'feed');
        return feedResponse(this.c.get('cms'), this.c.req.raw, []);
    }
}
