/** Site exports as downloads, for the export endpoints. Server only. */
import { ClientError } from '@cossackframework/romedb';
import { siteExport, type CmsHost, type NetworkSite } from '@cossackframework/cms/server';
import { databaseFile, databaseFiles } from './database';

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

/**
 * A site's database as a download, `<site>-<date>.romedb`, which a new install opens directly.
 * Its accounts come along, so a site's own accounts keep their passwords; sessions and pending
 * work do not. The copy is cleaned on this server before the first byte goes out.
 */
export async function fileExportResponse(host: CmsHost, site: Pick<NetworkSite, 'id'>, signal: AbortSignal): Promise<Response> {
    if (!(await databaseFiles(host.db))) return Response.json({ error: 'This install exports sites as JSON only.', code: 'CMS_UNAVAILABLE' }, { status: 501 });
    let file;
    try { file = await databaseFile(host.db, signal); }
    catch (error) {
        // RomeDB builds one copy of a database at a time.
        if (error instanceof ClientError && error.code === 'RDB_BUSY') return Response.json({ error: 'Another copy of this database is being made. Try again in a moment.', code: 'CMS_UNAVAILABLE' }, { status: 503, headers: { 'retry-after': '30' } });
        throw error;
    }
    const date = new Date(host.now()).toISOString().slice(0, 10);
    return new Response(file.body, { headers: {
        'content-type': 'application/vnd.romedb.database', 'content-length': String(file.size), 'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="${site.id}-${date}.romedb"`,
    } });
}
