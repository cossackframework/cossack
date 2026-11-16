/**
 * The content API: published entries as JSON, with rich text as its JSON document so apps
 * render it their own way, and writes for signed-in users and application passwords. Requests
 * act as the signed-in user or the password's owner, otherwise as a visitor.
 */
import type { Context } from 'hono';
import { ClientVisibleError } from '@cossackframework/core';
import type { Principal } from '@cossackframework/cms';
import { flattenBlocks, isCmsError, isSameOriginPost, richTextBlocks, richTextHtml, systemPrincipal, type Block, type CollectionDefinition, type RecordShape, type RichTextDoc } from '@cossackframework/cms';
import { withheldFieldNames, type CmsHost } from '@cossackframework/cms/server';
import { blocksHtml } from './content';
import { entryLock } from './site';

export interface ApiEntry { [field: string]: unknown; id: string; url: string | null }

/** Entries with their public URLs and, with `?format=html`, their rich text and blocks rendered. */
/** Fields a locked entry's readers do not get (`withheldFieldNames`): all but the core fields, taxonomies and lock flags. */
export function withheldFields(cms: CmsHost, collection: CollectionDefinition): Set<string> {
    return withheldFieldNames(cms.resourceById(`cms/${collection.name}`).fields);
}

export async function apiEntries(cms: CmsHost, collection: CollectionDefinition, records: readonly RecordShape[], html: boolean, principal?: Principal): Promise<ApiEntry[]> {
    const repository = cms.resource(`cms/${collection.name}`);
    const fields = Object.entries(cms.resourceById(`cms/${collection.name}`).fields);
    // The password itself never leaves. A protected entry's fields stay with those who may edit
    // it, and a members-only entry's with signed-in users: others get its core fields alone.
    const withheld = withheldFields(cms, collection);
    records = records.map(record => {
        const { password, ...rest } = record;
        const editor = principal !== undefined && repository.canUpdate(record, principal);
        const lock = entryLock(record, { editor, signedIn: principal?.kind === 'user', roles: principal?.kind === 'user' ? principal.roles : [] });
        if (!lock) return (typeof password === 'string' && password ? (editor ? record : rest) : rest) as RecordShape;
        const bare = Object.fromEntries(Object.entries(rest).filter(([name]) => !withheld.has(name))) as unknown as RecordShape;
        return { ...bare, ...(lock === 'password' ? { protected: true } : { membersOnly: true }), locked: lock };
    });
    const urls = await cms.entryUrls(collection, records);
    const rich = fields.filter(([, field]) => field.kind === 'richtext').map(([name]) => name);
    const blocks = fields.filter(([, field]) => field.kind === 'blocks' && !field.form).map(([name]) => name);
    const files = html && blocks.length && cms.files ? await cms.files.getMany([...new Set(records.flatMap(record => blocks.flatMap(name => Array.isArray(record[name]) ? flattenBlocks(record[name] as Block[]).flatMap(block => Object.values(block.data).filter((value): value is string => typeof value === 'string')) : [])))].slice(0, 200)).catch(() => new Map()) : new Map();
    return records.map(record => ({
        ...record, url: urls.get(record.id) ?? null,
        ...(html && (rich.length || blocks.length) ? { html: Object.fromEntries([
            ...rich.map(name => [name, record[name] ? richTextHtml(record[name] as RichTextDoc, { block: () => '' }) : '']),
            ...blocks.map(name => [name, Array.isArray(record[name]) ? blocksHtml(cms, record[name] as Block[], files) : '']),
        ]) } : {}),
    }));
}

/** Synced patterns the entries' content and rich text use, by ID: their title and blocks. */
export async function apiPatterns(cms: CmsHost, collection: CollectionDefinition, records: readonly { readonly [field: string]: unknown }[]): Promise<Record<string, { title: string; content: readonly Block[] }>> {
    const fields = Object.entries(cms.resourceById(`cms/${collection.name}`).fields);
    const rich = fields.filter(([, field]) => field.kind === 'richtext').map(([name]) => name);
    const blocks = fields.filter(([, field]) => field.kind === 'blocks').map(([name]) => name);
    const ids = [...new Set(records.flatMap(record => [
        ...rich.flatMap(name => record[name] ? richTextBlocks(record[name] as RichTextDoc) : []),
        ...blocks.flatMap(name => Array.isArray(record[name]) ? flattenBlocks(record[name] as Block[]) : []),
    ]).filter(block => block.type === 'core/pattern').map(block => String(block.data.pattern ?? '')))].filter(Boolean);
    if (!ids.length) return {};
    const found = await cms.resource('cms/patterns').getMany(ids, { principal: systemPrincipal('api') }).catch(() => new Map<string, RecordShape>());
    return Object.fromEntries([...found].map(([id, record]) => [id, { title: String(record.title ?? ''), content: Array.isArray(record.content) ? record.content as Block[] : [] }]));
}

/** JSON for a CMS error (its status) or another error meant for people (400); anything else is rethrown. */
export function apiError(c: Context, error: unknown): Response {
    if (isCmsError(error)) return c.json({ error: error.message, code: error.code, ...(error.fields ? { fields: error.fields } : {}) }, error.status as 400 | 401 | 403 | 404 | 409 | 422 | 503);
    if (error instanceof ClientVisibleError) return c.json({ error: error.message, code: 'CMS_VALIDATION' }, 400);
    throw error;
}

/** Visitors' answers can be cached briefly; signed-in answers are private. */
export function apiHeaders(c: Context): void {
    c.header('cache-control', c.get('principal')?.kind === 'user' ? 'private, no-store' : 'public, max-age=60');
}

/**
 * Whether a write may proceed: application passwords carry no cookies, so only session
 * requests need the same-origin check that stops cross-site forgery.
 */
export function writeAllowed(c: Context): Response | null {
    if (!c.get('cms.token') && !isSameOriginPost(c.req.raw)) return c.json({ error: 'Cross-site writes are not allowed.', code: 'CMS_FORBIDDEN' }, 403);
    if (c.get('principal')?.kind !== 'user') return c.json({ error: 'Sign in, or send an application password.', code: 'CMS_UNAUTHENTICATED' }, 401, { 'www-authenticate': 'Bearer' });
    return null;
}

/**
 * The request's body as a Request of its own, read up to `maxBytes`: null past it, whether or not
 * the request declared its length, so a chunked post cannot make the server buffer without limit.
 */
export async function cappedRequest(c: Context, maxBytes: number): Promise<Request | null> {
    const raw = c.req.raw;
    const declared = Number(raw.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    if (!raw.body) return raw;
    const reader = raw.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel().catch(() => undefined); return null; }
        chunks.push(value);
    }
    const body = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { body.set(chunk, at); at += chunk.byteLength; }
    const headers = new Headers(raw.headers);
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    return new Request(raw.url, { method: raw.method, headers, body });
}

/** The JSON object a write sends, or a 400 answer. */
export async function writeBody(c: Context): Promise<Record<string, unknown> | Response> {
    try {
        const body: unknown = await c.req.json();
        if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
    } catch { /* below */ }
    return c.json({ error: 'Send the fields as a JSON object.', code: 'CMS_VALIDATION' }, 400);
}

/**
 * Answer a management operation: its result as JSON (204 when it returns nothing), or its error.
 * Reads are private to the caller; writes need a signed-in user, the same-origin check for
 * sessions, and a JSON object body, handed to `work`.
 */
export async function answer(c: Context, work: (body: Record<string, unknown>) => Promise<unknown>, options: { write?: boolean; status?: 200 | 201 } = {}): Promise<Response> {
    let body: Record<string, unknown> = {};
    if (options.write) {
        const refused = writeAllowed(c);
        if (refused) return refused;
        if (!['DELETE', 'GET', 'HEAD'].includes(c.req.method) && c.req.header('content-length') !== '0' && c.req.header('content-type')) {
            const parsed = await writeBody(c);
            if (parsed instanceof Response) return parsed;
            body = parsed;
        }
    }
    c.header('cache-control', options.write ? 'no-store' : 'private, no-store');
    try {
        const data = await work(body);
        return data === undefined ? c.body(null, 204) : c.json(data, options.status ?? 200);
    } catch (error) { return apiError(c, error); }
}
