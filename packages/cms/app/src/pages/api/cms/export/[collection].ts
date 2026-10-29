import type { Context } from 'hono';
import { apiError } from '../../../../cms/content-api';
import { exportEntries, routeResource } from '../../../../cms/content';

/**
 * Every entry of a content type the caller may read, whatever its status, as a JSON document
 * `{ collection, exportedAt, items }` that `/api/cms/import/<collection>` takes back:
 * `GET /api/cms/export/posts`. For a session or an application password that may read them.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    const principal = c.get('principal');
    try {
        const route = c.req.param('collection') ?? '';
        const { resource } = routeResource(cms, route);
        if (principal.kind !== 'user') return c.json({ error: 'Sign in, or send an application password.', code: 'CMS_UNAUTHENTICATED' }, 401, { 'www-authenticate': 'Bearer' });
        const pages = exportEntries(cms, route, principal);
        // The first page checks the permission before anything is sent.
        const first = await pages.next();
        const encoder = new TextEncoder();
        let count = 0;
        const chunk = (items: Record<string, unknown>[]) => items.map(item => `${count++ ? ',\n' : ''}  ${JSON.stringify(item)}`).join('');
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(encoder.encode(`{\n "collection": ${JSON.stringify(route)},\n "exportedAt": ${JSON.stringify(new Date(cms.now()).toISOString())},\n "items": [\n${first.done ? '' : chunk(first.value)}`)); },
            async pull(controller) {
                const next = await pages.next();
                if (next.done) { controller.enqueue(encoder.encode('\n ]\n}\n')); controller.close(); } else controller.enqueue(encoder.encode(chunk(next.value)));
            },
            async cancel() { await pages.return(undefined); },
        });
        const date = new Date(cms.now()).toISOString().slice(0, 10);
        return new Response(body, { headers: {
            'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
            'content-disposition': `attachment; filename="${resource.name}-${date}.json"`,
        } });
    } catch (error) { return apiError(c, error); }
};
