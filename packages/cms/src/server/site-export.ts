/**
 * A site's database as one JSON document, streamed table by table, for the site to keep or
 * move. Values use RomeDB's portable encoding (`encodeValue`), so integers, record IDs and
 * binary values come back exactly with `decodeValue`. Media files are not included: `cms_files`
 * rows name their storage keys.
 */
import { encodeValue, type RomeDB, type Statement, type Value } from '@cossackframework/romedb';
import { HOST_TABLES } from './host-schema';

/**
 * Tables left out: credentials and sign-in state (sessions, second factors, passkeys, reset
 * tokens, application passwords, preview links, handoffs), the cache, and the network's own
 * tables, which hold accounts and the site registry on the main site.
 */
export const EXPORT_SKIPPED_TABLES: ReadonlySet<string> = new Set([
    'cms_auth_sessions', 'cms_sessions', 'cms_session_values', 'cms_session_sites', 'cms_oauth_states', 'cms_password_resets', 'cms_auth_challenges',
    'cms_user_security', 'cms_passkeys', 'cms_api_tokens', 'cms_preview_tokens', 'cms_handoffs', 'cms_cache',
    'cms_accounts', 'cms_sites', 'cms_site_domains', 'cms_memberships', 'cms_network',
]);

/** Columns exported as null: webhook signing secrets. */
export const EXPORT_REDACTED_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({ cms_webhooks: ['secret'] });

export interface SiteExportOptions {
    /** What the document says it is: the site's ID, name and address. */
    readonly site: { readonly id: string; readonly name: string; readonly host: string | null };
    readonly now?: () => number;
    /** Rows per read. Default 200. */
    readonly pageSize?: number;
    readonly signal?: AbortSignal;
}

/**
 * The export as text chunks: `{ format: 'cossack-site-export', version: 1, exportedAt, site,
 * skipped, redacted, tables: [{ name, model, columns?, rows }] }`. Relational rows are arrays in
 * `columns` order; document rows are whole documents. The CMS's own tables come first, by name,
 * so an import has the collections' definitions before their records; then the rest, by name.
 * Each table is read in key order, a page at a time, at least as fresh as the first read.
 */
export async function* siteExport(db: RomeDB, options: SiteExportOptions): AsyncGenerator<string> {
    const read = (statements: Statement[], after?: number) => db.read(statements, { ...(after === undefined ? {} : { afterSequence: after }), ...(options.signal ? { signal: options.signal } : {}) });
    const first = await read([{ rql: 'INFO FOR DB' }]);
    const sequence = first.sequence;
    const info = first.results[0]!.rows[0]![0] as unknown as { tables?: { name: string; model: string }[] };
    const tables = (info.tables ?? []).filter(table => !EXPORT_SKIPPED_TABLES.has(table.name) && (table.model === 'relational' || table.model === 'document'))
        .sort((a, b) => Number(!HOST.has(a.name)) - Number(!HOST.has(b.name)) || a.name.localeCompare(b.name));
    const json = (value: unknown) => JSON.stringify(value);
    const pageSize = Math.min(Math.max(options.pageSize ?? 200, 1), 1000);
    yield `{"format":"cossack-site-export","version":1,"exportedAt":${json(new Date((options.now ?? Date.now)()).toISOString())},"site":${json(options.site)},`
        + `"skipped":${json([...EXPORT_SKIPPED_TABLES].sort())},"redacted":${json(EXPORT_REDACTED_COLUMNS)},"tables":[`;
    for (const [index, table] of tables.entries()) {
        const name = quote(table.name);
        let columns: string[] = [];
        let order = 'id';
        if (table.model === 'relational') {
            const described = (await read([{ rql: `INFO FOR TABLE ${name}` }], sequence)).results[0]!.rows[0]![0] as unknown as { columns: { name: string; pk: bigint | number }[] };
            columns = described.columns.map(column => column.name);
            const keys = described.columns.filter(column => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(column => quote(column.name));
            order = keys.length ? keys.join(', ') : 'rowid';
        }
        const redacted = new Set(EXPORT_REDACTED_COLUMNS[table.name] ?? []);
        yield `${index ? ',' : ''}{"name":${json(table.name)},"model":${json(table.model)},${table.model === 'relational' ? `"columns":${json(columns)},` : ''}"rows":[`;
        let count = 0;
        for (let offset = 0; ; offset += pageSize) {
            const select = table.model === 'relational' ? columns.map(quote).join(', ') : '*';
            const page = (await read([{ rql: `SELECT ${select} FROM ${name} ORDER BY ${order} LIMIT $limit OFFSET $offset`, params: { $limit: pageSize, $offset: offset } }], sequence)).results[0]!;
            const rows = page.rows.map(row => table.model === 'relational'
                ? json(row.map((value, column) => encodeValue(redacted.has(columns[column]!) ? null : value as Value)))
                : json(encodeValue(row[0] as Value)));
            if (rows.length) yield `${count ? ',' : ''}${rows.join(',')}`;
            count += rows.length;
            if (page.rows.length < pageSize) break;
        }
        yield ']}';
    }
    yield ']}\n';
}

const HOST: ReadonlySet<string> = new Set(HOST_TABLES);

/** A RomeQL identifier, quoted when it is not a plain lowercase name. */
export function quote(name: string): string {
    return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}
