/**
 * A site export (`siteExport`) read back into a new site, so a site can move: out of a network
 * to its own install, or into another network. The file is read as a stream, a row at a time.
 * The site's tables are replaced by the export's, then the imported collections get their
 * tables and records. Pending work (the outbox, webhook deliveries, jobs) stays behind, so
 * nothing is sent twice; webhooks arrive turned off with new secrets, since exports leave the
 * secrets out. Media files are not in exports: copy the storage separately.
 */
import { decodeValue, type PortableValue, type Statement, type Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { HOST_TABLES } from './host-schema';
import { EXPORT_SKIPPED_TABLES, quote } from './site-export';
import type { CmsHost } from './host';

export interface SiteImportReport {
    /** What the export says it is. */
    readonly site: { readonly id: string; readonly name: string; readonly host: string | null };
    readonly exportedAt: string;
    readonly tables: number;
    readonly rows: number;
    /** Tables in the export that this install has no table for, such as a plugin's that is not installed. */
    readonly skipped: readonly string[];
    /**
     * Members after the import: `network` rejoined network accounts with their ID, `site` got
     * site accounts without passwords, and `pending` have no account yet: on the main site,
     * setup's takeover gives them one.
     */
    readonly members: { readonly network: number; readonly site: number; readonly pending: number };
}

export interface SiteImportOptions {
    readonly signal?: AbortSignal;
}

/** Tables the site keeps its own of: the schema's ledgers, and pending work that would run again. */
const KEPT_TABLES: ReadonlySet<string> = new Set(['cms_migrations', 'cms_schema_state', 'cms_outbox', 'cms_webhook_deliveries', 'cossack_jobs']);
const HOST: ReadonlySet<string> = new Set(HOST_TABLES);
/** The `cms_network` key that marks an import in progress, so a retry may replace what it wrote. */
const IMPORT_KEY = 'import';
/** An import that wrote nothing for this long has stopped; another may take over. */
const IMPORT_LEASE_MS = 5 * 60_000;
const WRITE = { kind: 'cms.import', retryConflicts: 3 } as const;
/** What one write holds: RomeDB takes 32 statements and 64 KiB of JSON a request. */
const BATCH_STATEMENTS = 32;
const BATCH_TEXT = 48 * 1024;
/** A statement's text around its row's values, at most. */
const STATEMENT_TEXT = 1024;

/**
 * Import an export into this site. The site must have no entries and no accounts of its own,
 * unless an earlier import of it stopped: then this one starts over. Members of the main site,
 * such as the network admin who added the site, stay members when the export does not have them.
 */
export async function siteImport(host: CmsHost, source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>, options: SiteImportOptions = {}): Promise<SiteImportReport> {
    const migrated = await host.migrate(options.signal ? { signal: options.signal } : {});
    if (migrated.failed) throw new CmsError('CMS_CONFLICT', `The schema could not be applied: ${migrated.failed.message}`);
    await host.ready({ force: true });
    const lease = await claim(host);
    try { return await importInto(host, source, lease, options); }
    catch (error) {
        await lease.stop().catch(() => undefined);
        throw error;
    }
}

async function importInto(host: CmsHost, source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>, lease: Lease, options: SiteImportOptions): Promise<SiteImportReport> {
    const db = host.db;
    const write = (statements: Statement[]) => db.write(statements, { ...WRITE, ...(options.signal ? { signal: options.signal } : {}) });
    const before = (await host.users.list({ limit: 100 })).items.filter(user => user.account === 'network');

    const reader = new ExportReader(source);
    const header = await reader.header();
    if (header.format !== 'cossack-site-export') throw new CmsError('CMS_VALIDATION', 'This is not a site export.');
    if (header.version !== 1) throw new CmsError('CMS_VALIDATION', `This export has version ${String(header.version)}; this install reads version 1. Update it first.`);

    let tables = await tablesHere(host);
    let collections = false;
    let count = 0;
    let rows = 0;
    const skipped: string[] = [];
    for (let table = await reader.table(); table; table = await reader.table()) {
        // The CMS's tables come first: once they are in, the imported collections get their tables.
        if (!collections && !HOST.has(table.name)) {
            collections = true;
            tables = await openCollections(host, options);
        }
        const here = tables.get(table.name);
        if (KEPT_TABLES.has(table.name) || EXPORT_SKIPPED_TABLES.has(table.name) || !here || here.model !== table.model) {
            if (!KEPT_TABLES.has(table.name) && !EXPORT_SKIPPED_TABLES.has(table.name)) skipped.push(table.name);
            while (await reader.row() !== undefined) { /* not imported */ }
            continue;
        }
        const columns = table.model === 'relational' ? await columnsOf(host, table.name, table.columns ?? []) : null;
        let batch: Statement[] = [{ rql: `DELETE FROM ${quote(table.name)}` }];
        let size = 0;
        const flush = async () => {
            await write(batch);
            await lease.wrote();
            batch = [];
            size = 0;
        };
        for (let row = await reader.row(); row !== undefined; row = await reader.row()) {
            const statement = columns ? insertRow(table.name, columns, row) : { rql: `INSERT INTO ${quote(table.name)} DOCUMENT $document`, params: { $document: decoded(row) } };
            const text = reader.lastSize + STATEMENT_TEXT;
            if (batch.length >= BATCH_STATEMENTS || size + text > BATCH_TEXT) await flush();
            batch.push(statement);
            size += text;
            rows++;
        }
        if (batch.length) await flush();
        count++;
    }
    await reader.end();
    if (!collections) await openCollections(host, options);
    const members = await adoptMembers(host, before);
    await lease.release();
    forget(host);
    await host.ready({ force: true });
    return { site: header.site, exportedAt: header.exportedAt, tables: count, rows, skipped, members };
}

/**
 * Whether an export can be imported here: `new` (no entries, no accounts of its own),
 * `stopped` (an import stopped partway; another starts over), `running`, or `used`.
 */
export async function siteImportState(host: CmsHost): Promise<'new' | 'stopped' | 'running' | 'used'> {
    if (!(await host.installed())) return 'new';
    const marker = (await host.db.read([{ rql: 'SELECT updated_at FROM cms_network WHERE key = $key', params: { $key: IMPORT_KEY } }])).results[0]!.rows[0];
    if (marker) return Number(marker[0] as bigint) > host.now() - IMPORT_LEASE_MS ? 'running' : 'stopped';
    return (await (host.siteAccounts ?? host.accounts).count()) > 0 || await hasEntries(host) ? 'used' : 'new';
}

/** The imported collection and taxonomy definitions are loaded and migrated, so their tables exist. */
async function openCollections(host: CmsHost, options: SiteImportOptions): Promise<Map<string, { model: string }>> {
    forget(host);
    await host.ready({ force: true });
    const report = await host.migrate(options.signal ? { signal: options.signal } : {});
    if (report.failed) throw new CmsError('CMS_CONFLICT', `The imported collections could not be created: ${report.failed.message}`);
    return tablesHere(host);
}

/** Drop what the host cached from before the import: settings (and plugin states in them), menus, collections. */
function forget(host: CmsHost): void {
    host.settings.refresh();
    host.menus.refresh();
    host.refreshActivation();
}

async function tablesHere(host: CmsHost): Promise<Map<string, { model: string }>> {
    const info = (await host.db.read([{ rql: 'INFO FOR DB' }])).results[0]!.rows[0]![0] as unknown as { tables?: { name: string; model: string }[] };
    return new Map((info.tables ?? []).map(table => [table.name, { model: table.model }]));
}

/** The export's columns, which this install's table must all have; newer exports may have more. */
async function columnsOf(host: CmsHost, table: string, columns: readonly string[]): Promise<readonly string[]> {
    const described = (await host.db.read([{ rql: `INFO FOR TABLE ${quote(table)}` }])).results[0]!.rows[0]![0] as unknown as { columns: { name: string }[] };
    const here = new Set(described.columns.map(column => column.name));
    const missing = columns.filter(column => !here.has(column));
    if (missing.length) throw new CmsError('CMS_VALIDATION', `This export comes from a newer CMS: ${table} has ${missing.join(', ')}, which this install does not. Update it first.`);
    return columns;
}

/** A RomeDB value from its portable form, as `siteExport` wrote it. */
function decoded(value: unknown): Value {
    try { return decodeValue(value as PortableValue); }
    catch { throw new CmsError('CMS_VALIDATION', 'The export has a value that is not a RomeDB value. Export the site again.'); }
}

function insertRow(table: string, columns: readonly string[], row: unknown): Statement {
    if (!Array.isArray(row) || row.length !== columns.length) throw new CmsError('CMS_VALIDATION', `The export has a row of ${table} that does not match its columns.`);
    const values = columns.map((_, index) => decoded(row[index]));
    if (table === 'cms_webhooks') {
        // Exports leave webhook secrets out: a new one, and the webhook off until someone checks it.
        values[columns.indexOf('secret')] = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (columns.includes('active')) values[columns.indexOf('active')] = 0n;
    }
    return {
        rql: `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map((_, index) => `$c${index}`).join(', ')})`,
        params: Object.fromEntries(values.map((value, index) => [`$c${index}`, value as Value])),
    };
}

interface Lease {
    /** Rows were written: renew the claim now and then. */
    wrote(): Promise<void>;
    release(): Promise<void>;
    /** The import failed: free the site if it wrote nothing, or leave it marked as stopped so a retry may start over. */
    stop(): Promise<void>;
}

/**
 * Claim the site for this import: it must be new (no entries, no accounts of its own), or an
 * earlier import of it stopped. The claim is renewed as rows are written.
 */
async function claim(host: CmsHost): Promise<Lease> {
    const db = host.db;
    const now = host.now();
    const marker = (await db.read([{ rql: 'SELECT updated_at FROM cms_network WHERE key = $key', params: { $key: IMPORT_KEY } }])).results[0]!.rows[0];
    if (marker) {
        if (Number(marker[0] as bigint) > now - IMPORT_LEASE_MS) throw new CmsError('CMS_CONFLICT', 'An import into this site is running. Wait for it to finish.');
    } else {
        // An added site's own accounts, or on the main site any account: a fresh install has none.
        if ((await (host.siteAccounts ?? host.accounts).count()) > 0 || await hasEntries(host)) {
            throw new CmsError('CMS_CONFLICT', 'Import into a new site: this one has entries or accounts of its own.');
        }
    }
    // Taking over a stopped import is guarded by the time it last wrote, so only one import takes it.
    const result = await db.write([marker
        ? { rql: 'UPDATE cms_network SET updated_at = $now WHERE key = $key AND updated_at = $was', params: { $key: IMPORT_KEY, $now: now, $was: marker[0] as bigint } }
        : { rql: 'INSERT INTO cms_network (key, value, updated_at) VALUES ($key, $value, $now) ON CONFLICT (key) DO NOTHING', params: { $key: IMPORT_KEY, $value: JSON.stringify({ startedAt: now }), $now: now } }], WRITE);
    if (result.results[0]!.affected !== 1n) throw new CmsError('CMS_CONFLICT', 'An import into this site is running. Wait for it to finish.');
    let last = now;
    let written = !!marker;
    const release = async () => { await db.write([{ rql: 'DELETE FROM cms_network WHERE key = $key', params: { $key: IMPORT_KEY } }], WRITE); };
    return {
        async wrote() {
            written = true;
            const at = host.now();
            if (at - last < 30_000) return;
            await db.write([{ rql: 'UPDATE cms_network SET updated_at = $now WHERE key = $key', params: { $key: IMPORT_KEY, $now: at } }], WRITE);
            last = at;
        },
        release,
        async stop() {
            if (!written) return release();
            await db.write([{ rql: 'UPDATE cms_network SET updated_at = 0 WHERE key = $key', params: { $key: IMPORT_KEY } }], WRITE);
        },
    };
}

async function hasEntries(host: CmsHost): Promise<boolean> {
    const tables = await tablesHere(host);
    const storages = [...new Set(host.resources.map(resource => resource.storage))].filter(storage => tables.has(storage));
    if (!storages.length) return false;
    const result = await host.db.read(storages.map(storage => ({ rql: `SELECT 1 FROM ${quote(storage)} LIMIT 1` })));
    return result.results.some(rows => rows.rows.length > 0);
}

/**
 * Members whose ID is a network account rejoin it; on an added site the others get site
 * accounts without passwords, set with Forgot password. Network members from before the
 * import that the export does not have stay members, unless their email is now taken.
 */
async function adoptMembers(host: CmsHost, before: readonly { id: string; roles: readonly string[] }[]): Promise<SiteImportReport['members']> {
    const counts = { network: 0, site: 0, pending: 0 };
    const now = host.now();
    for (let offset = 0; ; offset += 200) {
        const ids = (await host.db.read([{ rql: 'SELECT id FROM cms_users ORDER BY id LIMIT 200 OFFSET $offset', params: { $offset: offset } }])).results[0]!.rows.map(row => row[0] as string);
        if (!ids.length) break;
        const network = await host.accounts.existing(ids);
        const local = host.siteAccounts ? await host.siteAccounts.existing(ids) : new Set<string>();
        for (const id of ids) if (network.has(id)) { await host.accounts.join(id, host.site); counts.network++; }
        const orphans = ids.filter(id => !network.has(id) && !local.has(id));
        if (host.siteAccounts && orphans.length) {
            const params = Object.fromEntries(orphans.map((id, index) => [`$u${index}`, id]));
            await host.db.write([{
                rql: `INSERT INTO cms_accounts (id, email, name, password_hash, avatar, status, network_role, created_at, updated_at) SELECT id, email, name, NULL, avatar, status, NULL, created_at, $now FROM cms_users WHERE id IN (${orphans.map((_, index) => `$u${index}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
                params: { ...params, $now: now },
            }], WRITE);
            counts.site += orphans.length;
        } else counts.pending += orphans.length;
        counts.site += [...local].length;
        if (ids.length < 200) break;
    }
    for (const member of before) {
        if (await host.users.get(member.id)) continue;
        try { await host.users.addMember(member.id); }
        catch {
            await host.accounts.leave(member.id, host.site);
            continue;
        }
        const roles = [];
        for (const role of member.roles) if (await host.users.role(role)) roles.push(role);
        await host.users.setRoles(member.id, roles);
        counts.network++;
    }
    return counts;
}

interface ExportHeader {
    readonly format: unknown;
    readonly version: unknown;
    readonly exportedAt: string;
    readonly site: SiteImportReport['site'];
}

/**
 * Reads an export as a stream: the header up to `tables`, then each table's name, model and
 * columns, then its rows one at a time. Each row is parsed on its own, so memory holds one row.
 */
class ExportReader {
    readonly #chunks: AsyncIterator<Uint8Array | string>;
    readonly #decoder = new TextDecoder();
    #text = '';
    #at = 0;
    #done = false;
    /** In a table's rows, between rows. */
    #inRows = false;
    #firstRow = true;
    #firstTable = true;
    /** The length of the last row's text, for batching writes. */
    lastSize = 0;

    constructor(source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>) {
        const iterable: AsyncIterable<Uint8Array | string> = Symbol.asyncIterator in source ? source as AsyncIterable<Uint8Array | string> : readStream(source as ReadableStream<Uint8Array>);
        this.#chunks = iterable[Symbol.asyncIterator]();
    }

    /** The document's fields before `tables`; the writer puts `tables` last. */
    async header(): Promise<ExportHeader> {
        await this.#expect('{');
        const fields: { [key: string]: unknown } = {};
        for (let first = true; ; first = false) {
            if (!first) await this.#expect(',');
            const key = await this.#value();
            if (typeof key !== 'string') throw truncated('a field name');
            await this.#expect(':');
            if (key === 'tables') break;
            fields[key] = await this.#value();
        }
        await this.#expect('[');
        const site = fields.site as SiteImportReport['site'] | undefined;
        return { format: fields.format, version: fields.version, exportedAt: String(fields.exportedAt ?? ''), site: { id: String(site?.id ?? ''), name: String(site?.name ?? ''), host: site?.host ?? null } };
    }

    /** The next table's description, or null after the last one. Its rows must be read first. */
    async table(): Promise<{ name: string; model: string; columns: string[] | null } | null> {
        if (this.#inRows) throw new Error('Read the rows of the table before the next one.');
        if (await this.#peek() === ']') { this.#at++; return null; }
        if (!this.#firstTable) await this.#expect(',');
        this.#firstTable = false;
        await this.#expect('{');
        const fields: { [key: string]: unknown } = {};
        for (let first = true; ; first = false) {
            if (!first) await this.#expect(',');
            const key = await this.#value();
            await this.#expect(':');
            if (key === 'rows') break;
            fields[key as string] = await this.#value();
        }
        await this.#expect('[');
        this.#inRows = true;
        this.#firstRow = true;
        if (typeof fields.name !== 'string' || (fields.model !== 'relational' && fields.model !== 'document')) throw new CmsError('CMS_VALIDATION', 'The export has a table without a name or model.');
        return { name: fields.name, model: fields.model, columns: Array.isArray(fields.columns) ? fields.columns.map(String) : null };
    }

    /** The table's next row, or undefined after its last. */
    async row(): Promise<unknown> {
        if (!this.#inRows) return undefined;
        if (await this.#peek() === ']') {
            this.#at++;
            await this.#expect('}');
            this.#inRows = false;
            return undefined;
        }
        if (!this.#firstRow) await this.#expect(',');
        this.#firstRow = false;
        return this.#value();
    }

    /** The end of the document. */
    async end(): Promise<void> {
        await this.#expect('}');
        if (await this.#peek() !== null) throw new CmsError('CMS_VALIDATION', 'The export has text after its end.');
    }

    /** The next character after whitespace, or null at the end of the stream. */
    async #peek(): Promise<string | null> {
        for (;;) {
            while (this.#at < this.#text.length) {
                const code = this.#text.charCodeAt(this.#at);
                if (code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09) this.#at++;
                else return this.#text[this.#at]!;
            }
            if (!(await this.#more())) return null;
        }
    }

    async #expect(character: string): Promise<void> {
        const next = await this.#peek();
        if (next !== character) throw next === null ? truncated(`"${character}"`) : new CmsError('CMS_VALIDATION', `The export is not valid: expected "${character}" but found "${next}".`);
        this.#at++;
    }

    /** One whole JSON value, parsed. */
    async #value(): Promise<unknown> {
        const first = await this.#peek();
        if (first === null) throw truncated('a value');
        let index = this.#at;
        let depth = 0;
        let inString = false;
        let escaped = false;
        const literal = first !== '{' && first !== '[' && first !== '"';
        for (;;) {
            if (index >= this.#text.length) {
                // Reading more drops the text before this value, which starts at 0 after.
                const start = this.#at;
                const more = await this.#more();
                index -= start;
                if (more) continue;
                if (literal && index > 0) break;
                throw truncated('a value');
            }
            const character = this.#text[index]!;
            if (literal) {
                if (character === ',' || character === '}' || character === ']' || /\s/.test(character)) break;
            } else if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') { inString = false; if (depth === 0) { index++; break; } }
            } else if (character === '"') inString = true;
            else if (character === '{' || character === '[') depth++;
            else if (character === '}' || character === ']') { if (--depth === 0) { index++; break; } }
            index++;
        }
        const text = this.#text.slice(this.#at, index);
        this.#at = index;
        this.lastSize = text.length;
        try { return JSON.parse(text); }
        catch { throw new CmsError('CMS_VALIDATION', 'The export is not valid JSON.'); }
    }

    /** Read the next chunk, dropping text already read. False at the end of the stream. */
    async #more(): Promise<boolean> {
        this.#text = this.#text.slice(this.#at);
        this.#at = 0;
        if (this.#done) return false;
        const next = await this.#chunks.next();
        if (next.done) {
            this.#done = true;
            const rest = this.#decoder.decode();
            this.#text += rest;
            return rest.length > 0;
        }
        this.#text += typeof next.value === 'string' ? next.value : this.#decoder.decode(next.value, { stream: true });
        return true;
    }
}

async function* readStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = stream.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    } finally { reader.releaseLock(); }
}

const truncated = (wanted: string) => new CmsError('CMS_VALIDATION', `The export ends early: expected ${wanted}. Download it again.`);
