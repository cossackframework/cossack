import { Cossack, Page } from '@cossackframework/core';
import { isCmsError } from '@cossackframework/cms';

/** The IndexNow key file, `/indexnow/<key>.txt`: engines fetch it to check that a ping came from the site. */
@Page({ transport: 'http' })
export default class IndexNowKey extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        try {
            const key = await cms.indexnow.key();
            if (!key || this.c.req.param('file') !== `${key}.txt`) return new Response('Not found', { status: 404 });
            return new Response(key, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400', 'x-robots-tag': 'noindex' } });
        } catch (error) {
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            return new Response('Not available yet', { status: 503 });
        }
    }
}
