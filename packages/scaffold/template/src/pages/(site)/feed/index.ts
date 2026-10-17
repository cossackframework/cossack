import { Cossack, Page } from '@cossackframework/core';
import { ANONYMOUS, entryUrl, isCmsError, recordTitle, richTextExcerpt, richTextHtml, type RichTextDoc } from '@cossackframework/cms';
import { renderMarkdown, excerptOf } from '@cossackframework/cms/server';

const escape = (text: string) => text.replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);

/** The posts feed as RSS 2.0, sized and filled by Settings → Reading. */
@Page({ transport: 'http' })
export default class Feed extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        const origin = new URL(this.c.req.url).origin;
        try {
            const settings = await cms.settings.all();
            const collection = cms.collection('posts');
            const posts = cms.resource('cms/posts');
            const page = await posts.list({ where: { status: 'published' }, order: { field: 'publishedAt', direction: 'desc' }, limit: settings['reading.feedItems'] }, { principal: ANONYMOUS });
            const items = page.records.map(record => {
                const link = `${origin}${entryUrl(collection.path ?? 'posts', [String(record.slug)])}`;
                // Rich text bodies, or Markdown from before posts used the rich text editor.
                const doc = record.body && typeof record.body === 'object' ? record.body as RichTextDoc : null;
                const markdown = typeof record.body === 'string' ? record.body : '';
                const full = doc ? richTextHtml(doc, { block: () => '' }) : renderMarkdown(markdown);
                const summary = String(record.excerpt || (doc ? richTextExcerpt(doc, 55) : excerptOf(markdown, 55)));
                const description = settings['reading.feedContent'] === 'full' ? full : escape(summary);
                return `<item><title>${escape(recordTitle(record, 'title'))}</title><link>${escape(link)}</link><guid isPermaLink="true">${escape(link)}</guid>`
                    + `<pubDate>${new Date(Number(record.publishedAt)).toUTCString()}</pubDate><description>${settings['reading.feedContent'] === 'full' ? `<![CDATA[${description.replaceAll(']]>', ']]]]><![CDATA[>')}]]>` : description}</description></item>`;
            });
            const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escape(settings['general.siteTitle'])}</title><link>${escape(origin)}/</link>`
                + `<description>${escape(settings['general.tagline'])}</description>${items.join('')}</channel></rss>\n`;
            return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
        } catch (error) {
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            return new Response('Not available yet', { status: 503 });
        }
    }
}
