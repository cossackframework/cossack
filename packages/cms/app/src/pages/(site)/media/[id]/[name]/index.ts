import { Cossack, Page } from '@cossackframework/core';
import { cacheTagHeader } from '@cossackframework/cms';

const HEADERS = {
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
};

/**
 * Uploaded media. Files are public once uploaded; the name in the URL is decorative. The
 * stored type was checked against the file's signature, and responses forbid sniffing,
 * scripts and framing. `?w=` (and `h=`) serve a resized variant of an image in the best
 * format the browser accepts, made once and kept; `v` names the version of its crop.
 *
 * Answers carry the site's cache tag, so a deleted or changed file leaves a purging cache with
 * the site's next purge (every media change queues one). An original is kept an hour, not for
 * good: a file deleted by mistake stops answering from browsers within the hour.
 */
@Page({ transport: 'http' })
export default class MediaFile extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        const files = cms.files;
        const tag = cacheTagHeader([cms.purge.tag.site()]);
        const id = this.c.req.param('id') ?? '';
        const width = Number(this.c.req.query('w'));
        if (files && Number.isSafeInteger(width) && width > 0) {
            const height = Number(this.c.req.query('h'));
            const variant = await files.variant(id, {
                width, ...(Number.isSafeInteger(height) && height > 0 ? { height } : {}), accept: this.c.req.header('accept') ?? '', signal: this.c.req.raw.signal,
            });
            if (variant) return new Response(variant.body, {
                headers: { ...HEADERS, 'content-type': variant.contentType, 'content-length': String(variant.size), 'cache-control': 'public, max-age=3600', 'cache-tag': tag, vary: 'Accept' },
            });
            // Files that are not resized, such as SVG and GIF, answer as uploaded.
        }
        const opened = files ? await files.open(id, { signal: this.c.req.raw.signal }) : null;
        if (!opened) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        const { file, body } = opened;
        const inline = /^(image|video|audio)\//.test(file.contentType) || file.contentType === 'application/pdf';
        return new Response(body, {
            headers: {
                ...HEADERS,
                'content-type': file.contentType === 'text/plain' ? 'text/plain; charset=utf-8' : file.contentType,
                'content-length': String(file.size),
                'cache-control': 'public, max-age=3600',
                'cache-tag': tag,
                'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            },
        });
    }
}
