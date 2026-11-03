/** Site exports as downloads, for the export endpoints. Server only. */
import { siteExport, type CmsHost, type NetworkSite } from '@cossackframework/cms/server';

/**
 * A site's database export as a download, `<site>-<date>.json`, streamed table by table. The
 * first chunk is read before answering, so a database that cannot be read fails with an error
 * instead of a cut-off file.
 */
export async function exportResponse(host: CmsHost, site: Pick<NetworkSite, 'id' | 'host'>, name: string): Promise<Response> {
    const chunks = siteExport(host.db, { site: { id: site.id, name, host: site.host }, now: () => host.now() });
    const first = await chunks.next();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) { if (!first.done) controller.enqueue(encoder.encode(first.value)); },
        async pull(controller) {
            const next = await chunks.next();
            if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value));
        },
        async cancel() { await chunks.return(undefined); },
    });
    const date = new Date(host.now()).toISOString().slice(0, 10);
    return new Response(body, { headers: {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="${site.id}-${date}.json"`,
    } });
}
