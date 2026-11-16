/** Site exports as downloads, for the export endpoints. Server only. */
import { ClientError, type DatabaseFile } from '@cossackframework/romedb';
import { siteExport, siteFile, type CmsHost, type NetworkSite } from '@cossackframework/cms/server';

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
 * Its accounts come along, so a site's own accounts keep their passwords; sessions, webhooks and
 * pending work do not.
 */
export async function fileExportResponse(host: CmsHost, site: Pick<NetworkSite, 'id'>, signal: AbortSignal): Promise<Response> {
    let file;
    try { file = await siteFile(host.db, { signal }); }
    catch (error) {
        if (!(error instanceof ClientError)) throw error;
        // RomeDB builds one copy of a database at a time, and Cloud one across the service.
        if (error.code === 'RDB_BUSY') return Response.json({ error: 'Another database copy is being made. Try again in a moment.', code: 'CMS_UNAVAILABLE' }, { status: 503, headers: { 'retry-after': String(Math.ceil((error.retryAfterMs ?? 30_000) / 1000)) } });
        // RomeDB's deadline passed, rather than the visitor leaving: a large copy can take longer on Cloud.
        if (error.code === 'RDB_CANCELLED' && !signal.aborted) return Response.json({ error: 'The database copy took too long to make. Download the JSON export instead.', code: 'CMS_UNAVAILABLE' }, { status: 504 });
        throw error;
    }
    const date = new Date(host.now()).toISOString().slice(0, 10);
    return new Response(sized(file), { headers: {
        'content-type': 'application/vnd.romedb.database', 'content-length': String(file.size), 'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="${site.id}-${date}.romedb"`,
    } });
}

/**
 * The file's bytes, with a length the runtime can send. Workers drop `content-length` from a
 * stream they cannot measure, and a browser then shows no progress and cannot tell a cut-off
 * download from a finished one.
 */
function sized(file: DatabaseFile): ReadableStream<Uint8Array> {
    const { FixedLengthStream } = globalThis as { FixedLengthStream?: new (length: number) => TransformStream<Uint8Array, Uint8Array> };
    return FixedLengthStream ? file.body.pipeThrough(new FixedLengthStream(file.size)) : file.body;
}
