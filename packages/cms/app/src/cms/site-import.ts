/** Site imports from a page's POST, for setup and the network's site page. Server only. */
import type { Context } from 'hono';
import { CmsError } from '@cossackframework/cms';
import { siteImport, type CmsHost, type SiteImportReport } from '@cossackframework/cms/server';

/** Whether the POST carries an export as its body: the browser sends the file itself. */
export function sendsExport(c: Context): boolean {
    return (c.req.header('content-type') ?? '').startsWith('application/json');
}

/** Import the export in the request: its body, or a multipart form's `file`. */
export async function importRequest(c: Context, host: CmsHost): Promise<SiteImportReport> {
    let body: ReadableStream<Uint8Array> | null = null;
    if (sendsExport(c)) body = c.req.raw.body;
    else {
        const file = (await c.req.formData()).get('file');
        if (file instanceof File && file.size > 0) body = file.stream();
    }
    if (!body) throw new CmsError('CMS_VALIDATION', 'Choose an export file.');
    return siteImport(host, body, { signal: c.req.raw.signal });
}

/** What the import brought in, for the page's message. */
export function importSummary(report: SiteImportReport): string {
    const members = report.members.network + report.members.site + report.members.pending;
    return `Imported ${report.site.name || report.site.id}: ${report.rows} rows in ${report.tables} tables, ${members} ${members === 1 ? 'member' : 'members'}.`
        + (report.skipped.length ? ` Left out, with no table here: ${report.skipped.join(', ')}.` : '');
}
