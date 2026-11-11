/**
 * The management API's operations: what the REST routes under `/api/cms`, the MCP tools and
 * `cossack cms` do, written once. Each works on the request's site and principal and throws a
 * CmsError when it refuses, so every door answers alike (`apiError` turns them into JSON).
 * Content, people, settings and terms first; the appearance (menus, their locations and the
 * widget areas) at the end.
 */
import type { Context } from 'hono';
import {
    BLOCK_ID, checkNoteRange, CmsError, CONTENT_STATUSES, findBlock, hasPermission, indexedRowField, isNetworkAdmin, MAIN_SITE, MENU_LIMITS, menuItemId, noteThreads, PERMISSIONS, recordSchema, recordTitle, richTextBlocks,
    ANONYMOUS, type SnippetPart,
    type Block, type FieldFilter, type MenuItem, type MenuShape, type Note, type NoteThread, type Principal, type RecordShape, type RichTextDoc, redirectProblems, type Redirect, type RedirectStatus, type FieldDeclaration, WEBHOOK_EVENTS, COMMENT_STATUSES, type Webhook, type CommentShape, type CommentStatus } from '@cossackframework/cms';
import { networkSite, type ApiToken, type CmsHost, type NetworkSite, type SiteRecord } from '@cossackframework/cms/server';
import { createApiToken, listApiTokens, manageableHere, NETWORK_ACCOUNT_LOCKED, revokeApiToken, type PublicUser } from '../auth';
import { canAssignRoles, canGrantRoles, canManageUser } from '../services/rbac';
import { changeUserPassword, createUser, deleteUser, getUser, listUsers, syncUserRoles, updateUser, type UserDetail, type UserSummary } from '../services/users';
import { apiEntries, apiPatterns, withheldFields, type ApiEntry } from './content-api';
import { entryLock } from './site';
import { findMedia, routeResource } from './content';
import { siteUrl, type CmsBindings } from './index';
import { announceNote } from './notes-announce';
import { mailOrigin } from './seo';
import type { CachePurgeEvent } from '@cossackframework/cms';
import type { PurgeRecord } from '@cossackframework/cms/server';

/** Query parameters, as Hono hands them over. */
export type Query = { readonly [key: string]: string | undefined };
/** A JSON object a client sent. */
export type Body = { readonly [key: string]: unknown };

const KEY = /^[A-Za-z0-9_-]{1,80}$/;
const SITE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

// --- Helpers ---------------------------------------------------------------

/** The signed-in principal; visitors are refused. */
export function signedIn(c: Context): Principal & { kind: 'user' } {
    const principal = c.get('principal');
    if (principal.kind !== 'user') throw new CmsError('CMS_UNAUTHENTICATED', 'Sign in, or send an application password.');
    return principal;
}

function allowed(c: Context, permission: string, refusal: string): Principal & { kind: 'user' } {
    const principal = signedIn(c);
    if (!hasPermission(principal, permission)) throw new CmsError('CMS_FORBIDDEN', refusal);
    return principal;
}

/** The signed-in user as the RBAC helpers see them; a token request has no `user` on the context. */
function actor(c: Context): PublicUser {
    const principal = signedIn(c);
    return (c.get('user') as PublicUser | undefined) ?? { id: principal.id, email: '', name: '', avatar: null, meta: null, roles: [], principal };
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : fallback;
    return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), min), max) : fallback;
}

function text(value: unknown, field: string, options: { max?: number; required?: boolean } = {}): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (options.required !== false && !trimmed) throw new CmsError('CMS_VALIDATION', `${field} is required.`, { fields: { [field]: 'is required.' } });
    if (trimmed.length > (options.max ?? 200)) throw new CmsError('CMS_VALIDATION', `${field} is too long.`, { fields: { [field]: `must be at most ${options.max ?? 200} characters.` } });
    return trimmed;
}

/** The revision a write expects: the one sent, or the current one when the client did not read first. Widget areas have revision 0 before their first save. */
function expected(value: unknown, current: number, min = 1): number {
    if (value === undefined || value === null || value === '') return current;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replaceAll('"', '')) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < min) throw new CmsError('CMS_VALIDATION', min === 0 ? 'rev is the revision you read, 0 before the first save.' : 'rev is the revision you read, a positive integer.');
    return parsed;
}

/** A moment: an ISO 8601 string, epoch milliseconds, or `now`; undefined when absent. */
function moment(value: unknown, field: string, now: number): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === 'now') return now;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`) : Number.NaN;
    if (!Number.isFinite(parsed)) throw new CmsError('CMS_VALIDATION', `${field} is an ISO 8601 time, such as 2026-11-06T09:00:00Z.`, { fields: { [field]: 'must be a time.' } });
    return parsed;
}

async function entryOf(cms: CmsHost, resource: string, id: string, principal: Principal): Promise<RecordShape> {
    const record = KEY.test(id) ? await cms.resource(resource).get(id, { principal }) : null;
    if (!record) throw new CmsError('CMS_NOT_FOUND', 'Entry not found.');
    return record;
}

// --- Who am I ----------------------------------------------------------------

export interface SiteSummary {
    id: string;
    name: string;
    host: string | null;
    url: string | null;
    status: string;
}

export interface Whoami {
    user: { id: string; email: string; name: string; roles: { id: string; name: string }[]; permissions: string[]; networkAdmin: boolean; account: 'site' | 'network' };
    site: SiteSummary;
    /** The application password the request carries, or null for a session. */
    token: { scope: 'read' | 'write' } | null;
    network: { enabled: boolean; canAddSites: boolean; main: boolean };
}

async function siteSummary(c: Context, site: NetworkSite, cms: CmsHost): Promise<SiteSummary> {
    const url = siteUrl(c.env as CmsBindings, site) ?? null;
    let host = site.host;
    if (!host && url) { try { host = new URL(url).host; } catch { /* APP_URL is not a URL */ } }
    return { id: site.id, name: site.id === MAIN_SITE ? String(await cms.settings.get('general.siteTitle').catch(() => '')) : site.name ?? '', host, url, status: site.status };
}

export async function whoami(c: Context): Promise<Whoami> {
    const principal = signedIn(c);
    const cms = c.get('cms');
    const site = c.get('site');
    const network = c.get('network');
    const member = await cms.users.get(principal.id);
    const enabled = await network.enabled().catch(() => false);
    return {
        user: {
            id: principal.id, email: member?.email ?? '', name: member?.name ?? '', roles: (member?.assignments ?? []).map(role => ({ id: role.id, name: role.name })),
            permissions: [...principal.permissions], networkAdmin: isNetworkAdmin(principal), account: member?.account ?? 'network',
        },
        site: await siteSummary(c, site, cms),
        token: c.get('cms.token') ? { scope: c.get('cms.tokenScope') ?? 'write' } : null,
        network: { enabled, canAddSites: enabled && network.canAddSites, main: site.id === MAIN_SITE },
    };
}

// --- Application passwords -----------------------------------------------------

export async function tokensList(c: Context): Promise<{ items: ApiToken[] }> {
    return { items: await listApiTokens(signedIn(c).id) };
}

/** A new application password for the signed-in session; `token` is shown once. Passwords do not make passwords. */
export async function tokenCreate(c: Context, input: Body): Promise<{ token: string; id: string; name: string; scope: 'read' | 'write'; expiresAt: number | null }> {
    const principal = signedIn(c);
    if (c.get('cms.token')) throw new CmsError('CMS_FORBIDDEN', 'Create application passwords from a signed-in session.');
    const name = text(input.name, 'name', { max: 80 });
    const scope = input.scope === undefined ? 'write' : input.scope;
    if (scope !== 'read' && scope !== 'write') throw new CmsError('CMS_VALIDATION', 'scope is read or write.');
    // Days until it expires; absent or null means never.
    const days = input.expiresInDays === undefined || input.expiresInDays === null ? null : integer(input.expiresInDays, 0, 1, 3650);
    if (days === 0) throw new CmsError('CMS_VALIDATION', 'expiresInDays is 1 to 3650.');
    const token = await createApiToken(principal.id, name, scope, days);
    const record = (await listApiTokens(principal.id)).find(entry => entry.id === token.slice(4, 20));
    return { token, id: token.slice(4, 20), name, scope, expiresAt: record?.expiresAt ?? null };
}

export async function tokenRevoke(c: Context, id: string): Promise<void> {
    const principal = signedIn(c);
    if (!(await listApiTokens(principal.id)).some(token => token.id === id)) throw new CmsError('CMS_NOT_FOUND', 'No such application password.');
    await revokeApiToken(principal.id, id);
}

// --- Collections -------------------------------------------------------------

export interface CollectionSummary {
    name: string; label: string; singular: string; description: string;
    publishable: boolean; slug: boolean; hierarchical: boolean; managed: boolean; builtin: boolean; plugin: string | null;
    path: string | null; taxonomies: string[];
    fields: { name: string; kind: string; label: string; required: boolean; multiple: boolean; values?: string[] }[];
}

export function collectionsList(c: Context): { items: CollectionSummary[] } {
    const cms = c.get('cms');
    return { items: cms.collections().map(collection => {
        const resource = cms.resourceById(`cms/${collection.name}`);
        return {
            name: collection.name, label: collection.label, singular: collection.singular, description: collection.description ?? '',
            publishable: collection.publishable !== false, slug: collection.slug !== false, hierarchical: collection.hierarchical === true,
            managed: collection.managed === true, builtin: collection.builtin === true, plugin: collection.plugin ?? null,
            path: collection.path ?? null, taxonomies: [...(collection.taxonomies ?? [])],
            fields: Object.entries(resource.fields).map(([name, field]) => ({
                name, kind: field.kind, label: field.label ?? name, required: field.required === true, multiple: field.multiple === true,
                ...(field.values ? { values: [...field.values] } : {}),
            })),
        };
    }) };
}

export function collectionSchema(c: Context, name: string): object {
    return recordSchema(routeResource(c.get('cms'), name).resource);
}

// --- Entries -----------------------------------------------------------------

export interface EntryPage {
    items: ApiEntry[]; page: number; pages: number; total: number;
    /** Set when the list was cut short: a filter on withheld fields reads at most 1,000 matches, and counts and pages only those. */
    truncated?: true;
}

/**
 * Entries of a collection. Visitors read published entries, newest first. Signed-in readers
 * choose `status` (one of the statuses, or `any`), and drafts come most recently changed
 * first. `term=categories:news` lists a term's entries, including those of terms below it;
 * `q` searches; `locale` lists one language's entries; `filter[field]=value` matches a field;
 * `format=html` adds rendered rich text and blocks beside the JSON documents.
 */
export async function entriesList(c: Context, name: string, query: Query): Promise<EntryPage> {
    const cms = c.get('cms');
    const principal = c.get('principal');
    const collection = cms.collection(name);
    const repository = cms.resource(`cms/${collection.name}`);
    const page = integer(query.page, 1, 1, 500);
    const perPage = integer(query.perPage, 10, 1, 100);
    const publishable = collection.publishable !== false;
    const where: Record<string, FieldFilter> = {};
    if (publishable) {
        const status = principal.kind === 'user' ? query.status : undefined;
        if (status === undefined || status === '') where.status = 'published';
        else if (status !== 'any') {
            if (!(CONTENT_STATUSES as readonly string[]).includes(status)) throw new CmsError('CMS_VALIDATION', `status is one of ${CONTENT_STATUSES.join(', ')}, or any.`);
            where.status = status;
        }
    }
    const locale = query.locale;
    if (locale) {
        if (!(await cms.languages()).all.includes(locale)) throw new CmsError('CMS_VALIDATION', `${locale} is not one of the site's languages.`);
        where.locale = locale;
    }
    const [taxonomy, slug] = (query.term ?? '').split(':', 2);
    if (taxonomy && slug) {
        if (!(collection.taxonomies ?? []).includes(taxonomy)) throw new CmsError('CMS_VALIDATION', `${collection.label} do not use ${taxonomy}.`);
        const term = await cms.taxonomies.bySlug(taxonomy, slug);
        if (!term) throw new CmsError('CMS_NOT_FOUND', 'Term not found.');
        where[taxonomy] = { containsAny: (await cms.taxonomies.subtree(term.id)).slice(0, 50) };
    }
    // `filter[price]=10`, `filter[specs.name]=Weight`: equality on a scalar field, membership on a multiple field or an indexed row field.
    const fields = cms.resourceById(`cms/${collection.name}`).fields;
    for (const [key, raw] of Object.entries(query)) {
        const field = /^filter\[([a-zA-Z0-9_.]{1,200})\]$/.exec(key)?.[1];
        if (!field || typeof raw !== 'string') continue;
        const row = field.includes('.') ? indexedRowField(fields, field.split('.')) : null;
        const declaration = field.includes('.') ? row : fields[field];
        if (!declaration || UNQUERYABLE_FIELDS.has(field)) throw new CmsError('CMS_VALIDATION', `Cannot filter on ${field}.`);
        const kind = declaration.kind;
        const value = kind === 'integer' || kind === 'number' || (kind === 'datetime' && (row !== null || declaration.multiple)) ? Number(raw) : kind === 'boolean' ? raw === 'true' : raw;
        where[field] = declaration.multiple || row ? { contains: value } : value;
    }
    const q = (query.q ?? '').trim().slice(0, 200);
    const html = query.format === 'html';
    if (q) {
        // A locked entry the reader may not open stays out: that it matched would tell what its content says.
        const signedIn = principal.kind === 'user';
        const records = (await repository.search(q, { limit: perPage, where }, { principal }))
            .filter(record => !entryLock(record, { editor: repository.canUpdate(record, principal), signedIn, roles: signedIn ? principal.roles : [] }));
        return { items: await apiEntries(cms, collection, records, html, principal), page: 1, pages: 1, total: records.length };
    }
    // `sort=publishedAt:asc`, `sort=title`: a scalar field of the collection; the default follows what is listed.
    const sorted = sortOf(query.sort, fields);
    const order = sorted ?? (!publishable ? { field: 'title', direction: 'asc' as const }
        : where.status === 'published' ? { field: 'publishedAt', direction: 'desc' as const } : { field: 'updatedAt', direction: 'desc' as const });
    // Filtering or sorting on a field locked entries withhold would tell its value by what is
    // listed: such a request lists only entries the reader may open.
    const withheld = withheldFields(cms, collection);
    const probed = [...Object.keys(where).filter(name => !BASE_FILTERS.has(name)), ...(sorted ? [sorted.field] : [])].some(name => withheld.has(name.split('.')[0]!));
    const lockedOut = probed && !hasPermission(principal, `cms/${collection.name}:update`);
    if (lockedOut) {
        if (fields.password) where.password = { in: [null, ''] };
        if (fields.membersOnly && principal.kind !== 'user') where.membersOnly = { ne: true };
    }
    if (lockedOut && principal.kind === 'user' && fields.membersOnly) {
        // Members-only entries for other roles can't be left out by a condition, so the matches
        // are read in pages and the ones the reader may open are counted and listed: page and
        // total then agree with what is shown, and say nothing of the rest.
        // The scan stops at LOCKED_SCAN_LIMIT matches; past it the list says it was cut short
        // and its pages end where the scan did.
        const open: RecordShape[] = [];
        let truncated = false;
        for (let offset = 0; ; offset += LOCKED_SCAN_BATCH) {
            if (offset >= LOCKED_SCAN_LIMIT) { truncated = true; break; }
            const batch = await repository.list({ where, order, limit: LOCKED_SCAN_BATCH, offset }, { principal });
            open.push(...batch.records.filter(record => !entryLock(record, { editor: repository.canUpdate(record, principal), signedIn: true, roles: principal.roles })));
            if (!batch.more && !batch.next) break;
        }
        const pages = Math.max(1, Math.ceil(open.length / perPage));
        const shown = Math.min(page, pages);
        const items = await apiEntries(cms, collection, open.slice((shown - 1) * perPage, shown * perPage), html, principal);
        return { items: pickFields(items, query.fields), page: shown, pages, total: open.length, ...(truncated ? { truncated: true as const } : {}) };
    }
    const [list, total] = await Promise.all([
        repository.list({ where, order, limit: perPage, offset: Math.min((page - 1) * perPage, 10_000) }, { principal }),
        repository.count({ where }, { principal }),
    ]);
    const items = await apiEntries(cms, collection, list.records, html, principal);
    return { items: pickFields(items, query.fields), page, pages: Math.max(1, Math.ceil(total / perPage)), total };
}

/** How many matches a filter on withheld fields reads for a signed-in reader who can't open every entry, and in what pages. */
const LOCKED_SCAN_LIMIT = 1000;
const LOCKED_SCAN_BATCH = 100;

/** Conditions the API sets itself rather than from `filter[...]`. */
const BASE_FILTERS = new Set(['status', 'locale']);

/** One result of the site's search. */
export interface SearchItem { collection: string; id: string; title: string; url: string | null; snippet: readonly SnippetPart[] }

/**
 * The site's search, as its visitors get it: published entries they may read, of every
 * collection (or `collection=`), best first, with snippets. `q` is what someone typed; every
 * word is required, and when nothing has them all, `loose` answers with any of them.
 */
export async function siteSearch(c: Context, query: Query): Promise<{ items: SearchItem[]; page: number; next: boolean; loose: boolean }> {
    const cms = c.get('cms');
    const q = (query.q ?? '').trim().slice(0, 200);
    const page = integer(query.page, 1, 1, 1000);
    const perPage = integer(query.perPage, 10, 1, 50);
    const languages = await cms.languages();
    if (query.locale && !languages.all.includes(query.locale)) throw new CmsError('CMS_VALIDATION', `${query.locale} is not one of the site's languages.`);
    const only = query.collection ? [cms.collection(query.collection).name] : undefined;
    const found = await cms.siteSearch.search(q, { page, perPage, ...(languages.multilingual ? { locale: query.locale || languages.default } : {}), ...(only ? { collections: only } : {}) });
    const byCollection = new Map<string, string[]>();
    for (const hit of found.hits) byCollection.set(hit.collection, [...byCollection.get(hit.collection) ?? [], hit.id]);
    const shown = new Map<string, { title: string; url: string | null }>();
    for (const [name, ids] of byCollection) {
        const collection = cms.collections().find(entry => entry.name === name);
        if (!collection) continue;
        // Read as a visitor: the index is what visitors find, whoever asks.
        const records = [...(await cms.resource(`cms/${name}`).getMany(ids, { principal: ANONYMOUS })).values()]
            .filter(record => !entryLock(record, { editor: false, signedIn: false, roles: [] }));
        const urls = await cms.entryUrls(collection, records);
        for (const record of records) shown.set(`${name}:${record.id}`, { title: recordTitle(record, 'title'), url: urls.get(record.id) ?? null });
    }
    const items = found.hits.flatMap(hit => {
        const entry = shown.get(`${hit.collection}:${hit.id}`);
        return entry ? [{ collection: hit.collection, id: hit.id, ...entry, snippet: hit.snippet }] : [];
    });
    return { items, page, next: found.next, loose: found.loose };
}

/** `sort=field` or `sort=field:desc` on a scalar field the collection declares; null for none, an error for a field it cannot sort on. */
/**
 * Fields the API never answers with, so a request may not filter or sort on them either: a
 * filter that matches only when the guess is right would give a protected entry's password away.
 */
const UNQUERYABLE_FIELDS = new Set(['password']);

function sortOf(sort: string | undefined, fields: { readonly [name: string]: FieldDeclaration }): { field: string; direction: 'asc' | 'desc' } | null {
    if (!sort) return null;
    const [field, direction = 'asc'] = sort.split(':', 2);
    const declaration = field ? fields[field] : undefined;
    if (!declaration || UNQUERYABLE_FIELDS.has(field!) || declaration.multiple || !['string', 'integer', 'number', 'datetime', 'boolean', 'enum'].includes(declaration.kind) || declaration.kind === 'string' && declaration.media) throw new CmsError('CMS_VALIDATION', `Cannot sort on ${String(field)}.`);
    if (direction !== 'asc' && direction !== 'desc') throw new CmsError('CMS_VALIDATION', 'sort takes field or field:asc or field:desc.');
    return { field: field!, direction };
}

/** `fields=title,slug,excerpt`: only those fields of each item, always with id and url. */
function pickFields<T extends { id: string; url: string | null }>(items: T[], fields: string | undefined): T[] {
    if (!fields) return items;
    const wanted = new Set(fields.split(',').map(name => name.trim()).filter(Boolean));
    if (!wanted.size || wanted.size > 50) return items;
    return items.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key === 'id' || key === 'url' || wanted.has(key))) as T);
}

export interface EntryView { item: ApiEntry; patterns: Record<string, { title: string; content: readonly unknown[] }>; translations: Record<string, { id: string; url: string | null }> }

/**
 * One entry by slug (published only) or by ID (whatever the reader may see, such as their own
 * drafts); `preview` reads an unpublished entry through its preview link. The answer lists the
 * synced patterns its rich text uses and, on a site with several languages, its translations.
 */
export async function entryRead(c: Context, name: string, key: string, options: { preview?: string; html?: boolean } = {}): Promise<EntryView | null> {
    const cms = c.get('cms');
    const principal = c.get('principal');
    const collection = cms.collection(name);
    const repository = cms.resource(`cms/${collection.name}`);
    let record: RecordShape | null | undefined;
    if (options.preview) {
        const preview = await cms.previewByToken(options.preview);
        record = preview?.resource.id === `cms/${collection.name}` && preview.record.id === key ? preview.record : null;
    } else {
        const bySlug = collection.slug !== false && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)
            ? (await repository.list({ where: { slug: key, ...(collection.publishable === false ? {} : { status: 'published' }) }, limit: 1 }, { principal })).records[0]
            : undefined;
        record = bySlug ?? (KEY.test(key) ? await repository.get(key, { principal }) : null);
    }
    if (!record) return null;
    const languages = await cms.languages();
    const translations = languages.multilingual ? Object.fromEntries(await Promise.all([...await cms.translations(collection, record, { principal })]
        .map(async ([code, entry]) => [code, { id: entry.id, url: (await cms.entryUrls(collection, [entry])).get(entry.id) ?? null }] as const))) : {};
    const item = (await apiEntries(cms, collection, [record], options.html === true, principal))[0]!;
    // Patterns come from the answered item, so a locked entry's withheld content lists none.
    return { item, patterns: await apiPatterns(cms, collection, [item]), translations };
}

/**
 * One block of an entry by its `_id`, from any blocks field (nested blocks included) or embedded
 * in a rich text field, with the field's name: `GET /api/cms/content/posts/<id>/blocks/hero`.
 * Null when the entry or the block is not there.
 */
export async function entryBlock(c: Context, name: string, key: string, blockId: string): Promise<{ entry: { id: string; rev: unknown }; field: string; block: Block } | null> {
    if (!BLOCK_ID.test(blockId)) return null;
    const view = await entryRead(c, name, key);
    if (!view) return null;
    const { item } = view;
    for (const [field, value] of Object.entries(item)) {
        if (Array.isArray(value) && value.every(entry => entry && typeof entry === 'object' && typeof (entry as Block).type === 'string' && typeof (entry as Block)._id === 'string')) {
            const block = findBlock(value as Block[], blockId);
            if (block) return { entry: { id: item.id, rev: item.rev }, field, block };
        } else if (value && typeof value === 'object' && (value as RichTextDoc).type === 'doc' && Array.isArray((value as RichTextDoc).content)) {
            const block = richTextBlocks(value as RichTextDoc).find(entry => entry._id === blockId);
            if (block) return { entry: { id: item.id, rev: item.rev }, field, block: { _id: block._id, type: block.type, data: block.data, ...(block.style ? { style: block.style } : {}) } };
        }
    }
    return null;
}

export async function entryCreate(c: Context, name: string, fields: Body): Promise<{ item: ApiEntry }> {
    const cms = c.get('cms');
    const collection = cms.collection(name);
    const record = await cms.resource(`cms/${collection.name}`).create(fields, { principal: signedIn(c) });
    return { item: (await apiEntries(cms, collection, [record], false))[0]! };
}

/** Change an entry's fields. `rev` is the revision the client read; left out, the current one. A stale revision answers 409. */
export async function entryUpdate(c: Context, name: string, id: string, fields: Body, rev: unknown): Promise<{ item: ApiEntry }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const collection = cms.collection(name);
    const resource = `cms/${collection.name}`;
    const current = await entryOf(cms, resource, id, principal);
    const record = await cms.resource(resource).update(id, fields, { principal, expectedRevision: expected(rev, current.rev) });
    return { item: (await apiEntries(cms, collection, [record], false))[0]! };
}

export async function entryDelete(c: Context, name: string, id: string, rev: unknown): Promise<void> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const collection = cms.collection(name);
    const current = await entryOf(cms, `cms/${collection.name}`, id, principal);
    await cms.resource(`cms/${collection.name}`).delete(id, { principal, expectedRevision: expected(rev, current.rev) });
}

/**
 * Publish an entry now, or schedule it: `at` in the future makes it `scheduled` until then.
 * An entry published before keeps its publication time unless `at` is given. With "Open notes
 * hold publishing" on, an entry that is not live yet needs its notes resolved first.
 */
export async function entryPublish(c: Context, name: string, id: string, input: Body): Promise<{ item: ApiEntry }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const collection = cms.collection(name);
    if (collection.publishable === false) throw new CmsError('CMS_VALIDATION', `${collection.label} are not published.`);
    const resource = `cms/${collection.name}`;
    const current = await entryOf(cms, resource, id, principal);
    const at = moment(input.at, 'at', cms.now());
    const record = await cms.resource(resource).update(id, { status: 'published', ...(at === undefined ? {} : { publishedAt: at }) }, { principal, expectedRevision: expected(input.rev, current.rev) });
    return { item: (await apiEntries(cms, collection, [record], false))[0]! };
}

/** Take an entry off the site: back to a draft, keeping its publication time for a later republish. */
export async function entryUnpublish(c: Context, name: string, id: string, input: Body): Promise<{ item: ApiEntry }> {
    return entrySetStatus(c, name, id, 'draft', input.rev);
}

/** Move an entry between statuses: `draft`, `pending` (for review), `published`, `trash`. */
export async function entrySetStatus(c: Context, name: string, id: string, status: string, rev: unknown): Promise<{ item: ApiEntry }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const collection = cms.collection(name);
    if (collection.publishable === false) throw new CmsError('CMS_VALIDATION', `${collection.label} have no status.`);
    if (!(CONTENT_STATUSES as readonly string[]).includes(status) || status === 'scheduled') throw new CmsError('CMS_VALIDATION', 'status is draft, pending, published or trash; publish with a future time to schedule.');
    const resource = `cms/${collection.name}`;
    const current = await entryOf(cms, resource, id, principal);
    const record = await cms.resource(resource).update(id, { status }, { principal, expectedRevision: expected(rev, current.rev) });
    return { item: (await apiEntries(cms, collection, [record], false))[0]! };
}

export interface RevisionSummary { revision: number; at: number; actor: string | null; title: string; status: string | null }

export async function entryRevisions(c: Context, name: string, id: string, query: Query): Promise<{ current: number; items: RevisionSummary[] }> {
    const cms = c.get('cms');
    const principal = c.get('principal');
    const collection = cms.collection(name);
    const resource = `cms/${collection.name}`;
    const current = await entryOf(cms, resource, id, principal);
    const titleField = cms.resourceById(resource).titleField;
    const revisions = await cms.resource(resource).revisions(id, { principal }, { limit: integer(query.limit, 20, 1, 100) });
    return { current: current.rev, items: revisions.map(revision => ({
        revision: revision.revision, at: revision.at, actor: revision.actor, title: recordTitle(revision.data, titleField), status: typeof revision.data.status === 'string' ? revision.data.status : null,
    })) };
}

/** The content of one revision, for comparing before a restore. */
export async function entryRevision(c: Context, name: string, id: string, revision: number): Promise<{ revision: number; at: number; actor: string | null; data: RecordShape }> {
    const cms = c.get('cms');
    const principal = c.get('principal');
    const collection = cms.collection(name);
    await entryOf(cms, `cms/${collection.name}`, id, principal);
    const found = Number.isSafeInteger(revision) && revision >= 1 ? await cms.resource(`cms/${collection.name}`).revision(id, revision, { principal }) : null;
    if (!found) throw new CmsError('CMS_NOT_FOUND', 'Revision not found.');
    return found;
}

/** Restore a revision's fields as a new revision; where and whether the entry is published stays as it is. */
export async function entryRestore(c: Context, name: string, id: string, revision: number, rev: unknown): Promise<{ item: ApiEntry }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const collection = cms.collection(name);
    const resource = `cms/${collection.name}`;
    const current = await entryOf(cms, resource, id, principal);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new CmsError('CMS_VALIDATION', 'revision is a positive integer.');
    const record = await cms.resource(resource).restore(id, revision, { principal, expectedRevision: expected(rev, current.rev) });
    return { item: (await apiEntries(cms, collection, [record], false))[0]! };
}

// --- Notes -------------------------------------------------------------------

export async function notesForEntry(c: Context, name: string, id: string, status: string | undefined): Promise<{ threads: NoteThread[] }> {
    const cms = c.get('cms');
    const collection = cms.collection(name);
    const resource = `cms/${collection.name}`;
    const principal = c.get('principal');
    const record = await entryOf(cms, resource, id, principal);
    // Notes are the editors' discussion: publishing an entry does not publish them.
    if (!cms.resource(resource).canUpdate(record, principal)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to read notes on this entry.');
    if (status !== undefined && status !== '' && status !== 'open' && status !== 'resolved') throw new CmsError('CMS_VALIDATION', 'status is open or resolved.');
    return { threads: noteThreads(await cms.notes.forEntry(resource, id)).filter(thread => !status || thread.root.status === status) };
}

/**
 * A new thread, or a reply: `body` and, for a thread, `target` (`entry`, `field:title`,
 * `block:content:<blockId>`, `text:content:<blockId>.text`) with `range` and `quote` on a
 * passage; a reply names its thread as `parentId`. Whoever may edit the entry writes notes.
 */
export async function noteAdd(c: Context, name: string, id: string, input: Body): Promise<{ note: Note }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const collection = cms.collection(name);
    const resource = `cms/${collection.name}`;
    const repository = cms.resource(resource);
    const record = await entryOf(cms, resource, id, principal);
    if (!repository.canUpdate(record, principal)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to leave notes on this entry.');
    const note = await cms.notes.create({
        resource, recordId: id, userId: principal.id, body: String(input.body ?? ''),
        ...(typeof input.parentId === 'string' ? { parentId: input.parentId } : { target: typeof input.target === 'string' ? input.target : 'entry', range: checkNoteRange(input.range), quote: typeof input.quote === 'string' ? input.quote : '' }),
    });
    const author = await cms.users.get(principal.id).catch(() => null);
    void announceNote(cms, { kind: 'created', note }, { origin: mailOrigin(c), route: collection.name, collection: collection.name, title: recordTitle(record, cms.resourceById(resource).titleField), author: author?.name || author?.email || principal.id })
        .catch(error => console.warn('[cms] a note could not be announced', error));
    return { note };
}

/** The note and its entry, when the principal may edit that entry. */
async function editableNote(c: Context, noteId: string): Promise<{ note: Note; record: RecordShape; principal: Principal & { kind: 'user' } }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const note = KEY.test(noteId) ? await cms.notes.get(noteId) : null;
    if (!note) throw new CmsError('CMS_NOT_FOUND', 'Note not found.');
    const repository = cms.resource(note.resource);
    const record = await repository.get(note.recordId, { principal });
    if (!record) throw new CmsError('CMS_NOT_FOUND', 'Note not found.');
    if (!repository.canUpdate(record, principal)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to change notes on this entry.');
    return { note, record, principal };
}

/** Change a note: `body` (its author alone) and, on a thread's root, `status` (`open` or `resolved`). */
export async function noteChange(c: Context, noteId: string, input: Body): Promise<{ note: Note }> {
    const cms = c.get('cms');
    const found = await editableNote(c, noteId);
    let { note } = found;
    if (typeof input.body === 'string') {
        if (note.userId !== found.principal.id) throw new CmsError('CMS_FORBIDDEN', 'Only its author changes a note.');
        note = (await cms.notes.edit(note.id, input.body)) ?? note;
    }
    if (input.status !== undefined) {
        if (note.parentId) throw new CmsError('CMS_VALIDATION', 'Resolve the thread, not a reply.');
        if (input.status !== 'open' && input.status !== 'resolved') throw new CmsError('CMS_VALIDATION', 'status is open or resolved.');
        note = (await cms.notes.setStatus(note.id, input.status, found.principal.id)) ?? note;
        if (note.status === 'resolved') {
            const [owner, resourceName] = note.resource.split('/');
            const author = await cms.users.get(found.principal.id).catch(() => null);
            void announceNote(cms, { kind: 'resolved', note }, { origin: mailOrigin(c), route: owner === 'cms' ? resourceName! : `${owner}.${resourceName}`, collection: owner === 'cms' ? resourceName! : null,
                title: recordTitle(found.record, cms.resourceById(note.resource).titleField), author: author?.name || author?.email || found.principal.id })
                .catch(error => console.warn('[cms] a note could not be announced', error));
        }
    }
    return { note };
}

/** Remove a note (its author, or a user administrator); a thread's root takes its replies. */
export async function noteRemove(c: Context, noteId: string): Promise<void> {
    const found = await editableNote(c, noteId);
    if (found.note.userId !== found.principal.id && !hasPermission(found.principal, PERMISSIONS.manageUsers)) throw new CmsError('CMS_FORBIDDEN', 'Only its author or an administrator removes a note.');
    await c.get('cms').notes.remove(found.note.id);
}

export interface NotedEntry { collection: string; entryId: string; title: string; status: string | null; threads: NoteThread[] }

/** Entries with notes across the site (up to 100), with their threads, for whoever may edit each entry; `status` keeps open or resolved threads. */
export async function notesAcross(c: Context, status: string | undefined, limit: unknown): Promise<{ items: NotedEntry[] }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    if (status !== undefined && status !== '' && status !== 'open' && status !== 'resolved') throw new CmsError('CMS_VALIDATION', 'status is open or resolved.');
    const items: NotedEntry[] = [];
    for (const entry of await cms.notes.entries(integer(limit, 50, 1, 100))) {
        const [owner, resourceName] = entry.resource.split('/');
        if (owner !== 'cms' || !resourceName) continue;
        let record: RecordShape | null;
        try { record = await cms.resource(entry.resource).get(entry.recordId, { principal }); } catch { continue; }
        if (!record || !cms.resource(entry.resource).canUpdate(record, principal)) continue;
        const threads = noteThreads(await cms.notes.forEntry(entry.resource, entry.recordId)).filter(thread => !status || thread.root.status === status);
        if (!threads.length) continue;
        items.push({ collection: resourceName, entryId: entry.recordId, title: recordTitle(record, cms.resourceById(entry.resource).titleField), status: typeof record.status === 'string' ? record.status : null, threads });
    }
    return { items };
}

// --- Users and roles -----------------------------------------------------------

const USERS = 'Not allowed to manage users.';

export async function usersList(c: Context, query: Query): Promise<{ items: UserSummary[]; total: number; page: number; pages: number }> {
    allowed(c, PERMISSIONS.manageUsers, USERS);
    const page = integer(query.page, 1, 1, 10_000);
    const pageSize = integer(query.perPage, 20, 1, 100);
    const result = await listUsers({ search: (query.q ?? '').trim().slice(0, 100) || undefined, roleId: query.role || undefined, page, pageSize });
    return { items: result.items, total: result.total, page, pages: Math.max(1, Math.ceil(result.total / pageSize)) };
}

/** A user by ID or email. */
export async function userGet(c: Context, key: string): Promise<UserDetail> {
    allowed(c, PERMISSIONS.manageUsers, USERS);
    const id = key.includes('@') ? (await c.get('cms').users.findByEmail(key))?.id : KEY.test(key) ? key : undefined;
    const user = id ? await getUser(id) : null;
    if (!user) throw new CmsError('CMS_NOT_FOUND', 'User not found.');
    return user;
}

function roleIds(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const roles = list.map(role => String(role).trim()).filter(Boolean);
    if (!roles.every(role => /^[a-z][a-z0-9_-]{0,63}$/.test(role))) throw new CmsError('CMS_VALIDATION', 'roles are role IDs, such as editor.');
    return [...new Set(roles)];
}

/** Refuse roles holding permissions the caller lacks: nobody gives a stronger role than their own. */
async function grantable(c: Context, roles: readonly string[]): Promise<void> {
    const found = (await Promise.all(roles.map(role => c.get('cms').users.role(role)))).filter(role => role !== null);
    if (!canGrantRoles(actor(c), found)) throw new CmsError('CMS_FORBIDDEN', 'You cannot give a role with permissions you do not have.');
}

/** A new account with the chosen roles (role managers) or General settings' default role. */
export async function userCreate(c: Context, input: Body): Promise<UserDetail> {
    allowed(c, PERMISSIONS.manageUsers, USERS);
    const email = text(input.email, 'email', { max: 254 });
    const password = typeof input.password === 'string' ? input.password : '';
    if (password.length < 8) throw new CmsError('CMS_VALIDATION', 'password must be at least 8 characters.', { fields: { password: 'must be at least 8 characters.' } });
    const roles = roleIds(input.roles);
    if (roles && !canAssignRoles(actor(c))) throw new CmsError('CMS_FORBIDDEN', 'Only role managers choose roles; leave roles out for the default role.');
    if (roles) await grantable(c, roles);
    const created = await createUser({ email, password, name: text(input.name, 'name', { required: false, max: 120 }) || undefined, ...(roles ? { roleIds: roles } : {}) });
    return (await getUser(created.id))!;
}

/** Change a user: `name`, `email`, `password`, `roles` (role managers) and `status` (`active` or `disabled`). */
export async function userUpdate(c: Context, id: string, input: Body): Promise<UserDetail> {
    allowed(c, PERMISSIONS.manageUsers, USERS);
    const target = KEY.test(id) ? await getUser(id) : null;
    if (!target) throw new CmsError('CMS_NOT_FOUND', 'User not found.');
    const me = actor(c);
    if (!canManageUser(me, target)) throw new CmsError('CMS_FORBIDDEN', 'Only an administrator can change this account.');
    const profile = {
        ...(input.name !== undefined ? { name: text(input.name, 'name', { max: 120 }) } : {}),
        ...(input.email !== undefined ? { email: text(input.email, 'email', { max: 254 }) } : {}),
    };
    // Your own email takes your password resets with it: like your password, it changes on your profile with your current password, never with an API key or open session alone.
    if (profile.email !== undefined && id === me.id && profile.email.trim().toLowerCase() !== target.email.trim().toLowerCase()) {
        throw new CmsError('CMS_FORBIDDEN', 'Change your own email from your user screen in the dashboard, with your current password.');
    }
    if (Object.keys(profile).length) await updateUser(id, profile);
    if (input.password !== undefined) {
        // Your own password changes on your profile, which asks for the current one: an API key or open session alone cannot take the account.
        if (id === me.id) throw new CmsError('CMS_FORBIDDEN', 'Change your own password from your profile, with your current password.');
        if (typeof input.password !== 'string' || input.password.length < 8) throw new CmsError('CMS_VALIDATION', 'password must be at least 8 characters.', { fields: { password: 'must be at least 8 characters.' } });
        await changeUserPassword(id, input.password);
    }
    const roles = roleIds(input.roles);
    if (roles) {
        if (!canAssignRoles(me)) throw new CmsError('CMS_FORBIDDEN', 'Only role managers change roles.');
        await grantable(c, roles);
        await syncUserRoles(id, roles);
    }
    if (input.status !== undefined) {
        if (input.status !== 'active' && input.status !== 'disabled') throw new CmsError('CMS_VALIDATION', 'status is active or disabled.');
        if (id === me.id) throw new CmsError('CMS_VALIDATION', 'Your own account stays active.');
        if (!(await manageableHere(id))) throw new CmsError('CMS_FORBIDDEN', NETWORK_ACCOUNT_LOCKED);
        await c.get('cms').users.setStatus(id, input.status);
    }
    return (await getUser(id))!;
}

/** Delete a user, or remove them from an added site. Never the caller's own account. */
export async function userDelete(c: Context, id: string): Promise<void> {
    allowed(c, PERMISSIONS.manageUsers, USERS);
    const me = actor(c);
    if (id === me.id) throw new CmsError('CMS_VALIDATION', 'Delete your own account from your profile, or ask another administrator.');
    const target = KEY.test(id) ? await getUser(id) : null;
    if (!target) throw new CmsError('CMS_NOT_FOUND', 'User not found.');
    if (!canManageUser(me, target)) throw new CmsError('CMS_FORBIDDEN', 'Only an administrator can delete this account.');
    await deleteUser(id);
}

export async function rolesList(c: Context): Promise<{ items: { id: string; name: string; permissions: string[]; users: number | null }[] }> {
    const principal = signedIn(c);
    if (!hasPermission(principal, PERMISSIONS.manageUsers) && !hasPermission(principal, PERMISSIONS.manageRoles)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to see roles.');
    return { items: (await c.get('cms').users.roles({ limit: 200 })).map(role => ({ id: role.id, name: role.name, permissions: [...role.permissions], users: role.userCount ?? null })) };
}

// --- Settings ------------------------------------------------------------------

export interface SettingsGroupView { group: string; label: string; values: Record<string, unknown>; fields: { name: string; kind: string; label: string; description: string }[] }

/** The settings document the principal may edit (every portable group), or one group with its declarations. */
export async function settingsRead(c: Context, group?: string): Promise<{ document: Record<string, Record<string, unknown>> } | SettingsGroupView> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    const document = await cms.settings.snapshot({ principal });
    if (group === undefined) return { document };
    const declaration = cms.settings.catalog({ principal }).find(entry => entry.id === group);
    if (!declaration || !document[group]) throw new CmsError('CMS_NOT_FOUND', `No settings group ${group} you may edit; the groups are ${Object.keys(document).join(', ')}.`);
    return { group, label: declaration.label, values: document[group]!, fields: Object.entries(declaration.fields).map(([name, field]) => ({ name, kind: field.kind, label: field.label ?? name, description: field.description ?? '' })) };
}

/** Change some fields of one group; others keep their values. */
export async function settingsUpdate(c: Context, group: string, values: Body): Promise<SettingsGroupView> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    await cms.settings.update(group, values, { principal });
    return await settingsRead(c, group) as SettingsGroupView;
}

/** Apply a settings document (`{ group: { field: value } }`), as Settings → Import does. */
export async function settingsApply(c: Context, document: unknown): Promise<{ document: Record<string, Record<string, unknown>> }> {
    return { document: await c.get('cms').settings.applyDocument(document, { principal: signedIn(c) }) };
}

// --- Cache ----------------------------------------------------------------------

/**
 * Purge the caches in front of the site: the tags and URLs given, or every page. The purge is
 * queued like any other and the outbox run at once, so the answer carries each purger's result;
 * a purger that failed retries from the outbox.
 */
export async function cachePurge(c: Context, input: Body): Promise<{ event: CachePurgeEvent; purgers: string[]; results: PurgeRecord[] }> {
    const cms = c.get('cms');
    const principal = signedIn(c);
    if (!hasPermission(principal, PERMISSIONS.manageSettings)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to purge the cache.');
    const strings = (value: unknown, name: string): string[] => {
        if (value === undefined || value === null) return [];
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string') || value.length > 500) throw new CmsError('CMS_VALIDATION', `${name} must be a list of up to 500 strings.`, { fields: { [name]: 'is invalid.' } });
        return value as string[];
    };
    const event = await cms.purge.queue('manual', { tags: strings(input.tags, 'tags'), urls: strings(input.urls, 'urls') });
    await cms.outbox.dispatch({ limit: 10 });
    return { event, purgers: cms.purge.purgers.map(purger => purger.name), results: cms.purge.recent.filter(record => record.eventId === event.eventId) };
}

// --- Taxonomies and terms --------------------------------------------------------

export function taxonomiesList(c: Context): { items: { name: string; label: string; singular: string; hierarchical: boolean; path: string | null; builtin: boolean }[] } {
    return { items: c.get('cms').taxonomies.declarations.map(taxonomy => ({ name: taxonomy.name, label: taxonomy.label, singular: taxonomy.singular, hierarchical: taxonomy.hierarchical, path: taxonomy.path ?? null, builtin: taxonomy.builtin === true })) };
}

/** The site's webhooks: `GET /api/cms/webhooks`. Needs the webhooks permission. */
export async function webhooksList(c: Context): Promise<{ items: Webhook[] }> {
    if (!hasPermission(signedIn(c), PERMISSIONS.manageWebhooks)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to manage webhooks.');
    return { items: await c.get('cms').webhooks.list() };
}

/** A new webhook: `POST /api/cms/webhooks` with `{ name, url, events, collections?, active? }`; the answer carries the signing `secret` once. */
export async function webhookCreate(c: Context, input: Body): Promise<{ item: Webhook & { readonly secret?: string } }> {
    const principal = signedIn(c);
    if (!hasPermission(principal, PERMISSIONS.manageWebhooks)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to manage webhooks.');
    const events = Array.isArray(input.events) ? input.events.filter((event): event is string => typeof event === 'string') : [];
    if (!events.length || events.some(event => !(WEBHOOK_EVENTS as readonly string[]).includes(event))) throw new CmsError('CMS_VALIDATION', `events lists one or more of ${WEBHOOK_EVENTS.join(', ')}.`);
    const collections = Array.isArray(input.collections) ? input.collections.filter((name): name is string => typeof name === 'string') : [];
    const item = await c.get('cms').webhooks.save({ name: text(input.name, 'name', { max: 120 }), url: text(input.url, 'url', { max: 2000 }), events, collections, active: input.active !== false }, { by: principal.kind === 'user' ? principal.id : null });
    return { item };
}

export async function webhookDelete(c: Context, id: string): Promise<void> {
    if (!hasPermission(signedIn(c), PERMISSIONS.manageWebhooks)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to manage webhooks.');
    const cms = c.get('cms');
    if (!(await cms.webhooks.get(id))) throw new CmsError('CMS_NOT_FOUND', 'Webhook not found.');
    await cms.webhooks.delete(id);
}

/** The moderation queue: `GET /api/cms/comments/queue?status=pending&page=1&perPage=50`. Needs the comments permission. */
export async function commentsQueue(c: Context, query: Query): Promise<{ items: CommentShape[]; total: number; page: number; pages: number }> {
    if (!hasPermission(signedIn(c), PERMISSIONS.moderateComments)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to moderate comments.');
    const status = query.status ?? 'pending';
    if (!(COMMENT_STATUSES as readonly string[]).includes(status)) throw new CmsError('CMS_VALIDATION', `status is one of ${COMMENT_STATUSES.join(', ')}.`);
    const perPage = integer(query.perPage, 50, 1, 200);
    const page = integer(query.page, 1, 1, 10_000);
    const result = await c.get('cms').comments.list({ status: status as CommentStatus, limit: perPage, offset: (page - 1) * perPage, ...(typeof query.q === 'string' && query.q ? { search: query.q } : {}) });
    return { ...result, page, pages: Math.max(1, Math.ceil(result.total / perPage)) };
}

/** Approve, hold, mark as spam or trash a comment: `PATCH /api/cms/comments/<id>` with `{ status }`. */
export async function commentModerate(c: Context, id: string, input: Body): Promise<{ item: CommentShape }> {
    if (!hasPermission(signedIn(c), PERMISSIONS.moderateComments)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to moderate comments.');
    const cms = c.get('cms');
    const current = await cms.comments.get(id);
    if (!current) throw new CmsError('CMS_NOT_FOUND', 'Comment not found.');
    if (!(COMMENT_STATUSES as readonly string[]).includes(input.status as string)) throw new CmsError('CMS_VALIDATION', `status is one of ${COMMENT_STATUSES.join(', ')}.`);
    await cms.comments.setStatus([id], input.status as CommentStatus);
    return { item: (await cms.comments.get(id))! };
}

export async function commentDelete(c: Context, id: string): Promise<void> {
    if (!hasPermission(signedIn(c), PERMISSIONS.moderateComments)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to moderate comments.');
    const cms = c.get('cms');
    if (!(await cms.comments.get(id))) throw new CmsError('CMS_NOT_FOUND', 'Comment not found.');
    await cms.comments.delete([id]);
}

/** Redirects, newest first: `GET /api/cms/redirects?q=old&page=1&perPage=50`. */
export async function redirectsList(c: Context, query: Query): Promise<{ items: Redirect[]; total: number }> {
    const principal = signedIn(c);
    if (!hasPermission(principal, PERMISSIONS.manageRedirects)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to manage redirects.');
    const perPage = integer(query.perPage, 50, 1, 200);
    const page = integer(query.page, 1, 1, 10_000);
    return c.get('cms').redirects.list({ ...(typeof query.q === 'string' && query.q ? { search: query.q } : {}), limit: perPage, offset: (page - 1) * perPage });
}

/** A redirect: `POST /api/cms/redirects` with `{ source, target, status?, note? }`; `source` is a path, `target` a path or URL. */
export async function redirectCreate(c: Context, input: Body): Promise<{ item: Redirect }> {
    const principal = signedIn(c);
    if (!hasPermission(principal, PERMISSIONS.manageRedirects)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to manage redirects.');
    const problems = redirectProblems(input as never);
    if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
    const item = await c.get('cms').redirects.save({ source: text(input.source, 'source', { max: 500 }), target: text(input.target, 'target', { max: 2000 }),
        ...(input.status !== undefined ? { status: Number(input.status) as RedirectStatus } : {}), ...(typeof input.note === 'string' ? { note: input.note.slice(0, 500) } : {}) }, { by: principal.kind === 'user' ? principal.id : null });
    return { item };
}

export async function termsList(c: Context, taxonomy: string, query: Query) {
    const cms = c.get('cms');
    cms.taxonomies.declaration(taxonomy);
    const page = integer(query.page, 1, 1, 10_000);
    const perPage = integer(query.perPage, 50, 1, 200);
    const { items, total } = await cms.taxonomies.list(taxonomy, { search: (query.q ?? '').trim().slice(0, 100) || undefined, limit: perPage, offset: (page - 1) * perPage });
    return { items, total, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

function termInput(input: Body) {
    return {
        ...(input.name !== undefined ? { name: text(input.name, 'name', { max: 200 }) } : {}),
        ...(input.slug !== undefined ? { slug: text(input.slug, 'slug', { required: false, max: 200 }) } : {}),
        ...(input.description !== undefined ? { description: typeof input.description === 'string' ? input.description : '' } : {}),
        ...(input.parent !== undefined ? { parent: typeof input.parent === 'string' && input.parent ? input.parent : null } : {}),
        ...(input.meta !== undefined && input.meta && typeof input.meta === 'object' ? { meta: input.meta as { [field: string]: unknown } } : {}),
    };
}

export async function termCreate(c: Context, taxonomy: string, input: Body) {
    return c.get('cms').taxonomies.create(taxonomy, { ...termInput(input), name: text(input.name, 'name', { max: 200 }) }, { principal: signedIn(c) });
}

async function termIn(c: Context, taxonomy: string, id: string) {
    const term = KEY.test(id) ? await c.get('cms').taxonomies.get(id) : null;
    if (!term || term.taxonomy !== taxonomy) throw new CmsError('CMS_NOT_FOUND', 'Term not found.');
    return term;
}

export async function termRead(c: Context, taxonomy: string, id: string) {
    return termIn(c, taxonomy, id);
}

export async function termUpdate(c: Context, taxonomy: string, id: string, input: Body) {
    await termIn(c, taxonomy, id);
    return c.get('cms').taxonomies.update(id, termInput(input), { principal: signedIn(c) });
}

export async function termDelete(c: Context, taxonomy: string, id: string): Promise<void> {
    await termIn(c, taxonomy, id);
    await c.get('cms').taxonomies.delete(id, { principal: signedIn(c) });
}

// --- Media ------------------------------------------------------------------------

/** Library files: `q` matches titles and names, `kind` (image, video, audio, document, archive) narrows them. */
export async function mediaList(c: Context, query: Query) {
    const principal = c.get('principal');
    if (![PERMISSIONS.upload, PERMISSIONS.manageMedia, PERMISSIONS.manageUsers].some(permission => hasPermission(principal, permission))) {
        throw new CmsError(principal.kind === 'user' ? 'CMS_FORBIDDEN' : 'CMS_UNAUTHENTICATED', 'Not allowed to see the media library.');
    }
    const kind = query.kind ?? '';
    return { items: await findMedia(c.get('cms'), (query.q ?? '').slice(0, 100), ['image', 'video', 'audio', 'document', 'archive'].includes(kind) ? kind : '') };
}

// --- Network sites ---------------------------------------------------------------

export interface SiteView extends SiteSummary {
    domains: { host: string; primary: boolean; verified: boolean }[];
    createdAt: number | null;
    updatedAt: number | null;
    deletedAt: number | null;
}

async function networkAdmin(c: Context) {
    const principal = signedIn(c);
    const network = c.get('network');
    if (!isNetworkAdmin(principal)) throw new CmsError('CMS_FORBIDDEN', 'Only network admins manage sites.');
    if (c.get('site').id !== MAIN_SITE) throw new CmsError('CMS_FORBIDDEN', 'Manage sites on the network host (the main site).');
    if (!(await network.enabled().catch(() => false))) throw new CmsError('CMS_FORBIDDEN', 'The network is off: turn it on under Settings → Network first.');
    return network;
}

function siteView(c: Context, record: SiteRecord): SiteView {
    const site = networkSite(record);
    return {
        id: record.id, name: record.name, host: site.host, url: siteUrl(c.env as CmsBindings, site) ?? null, status: record.status,
        domains: record.domains.map(domain => ({ host: domain.host, primary: domain.primary, verified: domain.verifiedAt !== null })),
        createdAt: record.createdAt, updatedAt: record.updatedAt, deletedAt: record.deletedAt,
    };
}

async function mainView(c: Context): Promise<SiteView> {
    const summary = await siteSummary(c, c.get('site'), c.get('cms'));
    return { ...summary, domains: summary.host ? [{ host: summary.host, primary: true, verified: true }] : [], createdAt: null, updatedAt: null, deletedAt: null };
}

/** The network's sites, the main site first: `q` searches names and addresses, `status` keeps active, archived or deleted sites. */
export async function sitesList(c: Context, query: Query): Promise<{ items: SiteView[]; total: number; page: number; pages: number }> {
    const network = await networkAdmin(c);
    const status = query.status;
    if (status !== undefined && status !== '' && !['active', 'archived', 'deleted'].includes(status)) throw new CmsError('CMS_VALIDATION', 'status is active, archived or deleted.');
    const page = integer(query.page, 1, 1, 10_000);
    const perPage = integer(query.perPage, 50, 1, 200);
    const search = (query.q ?? '').trim().slice(0, 100);
    const { items, total } = await network.sites.list({ ...(search ? { search } : {}), ...(status ? { status: status as 'active' | 'archived' | 'deleted' } : {}), limit: perPage, offset: (page - 1) * perPage });
    const main = page === 1 && !search && (!status || status === 'active') ? [await mainView(c)] : [];
    return { items: [...main, ...items.map(record => siteView(c, record))], total: total + main.length, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function siteGet(c: Context, id: string): Promise<SiteView> {
    const network = await networkAdmin(c);
    if (id === MAIN_SITE) return mainView(c);
    const record = SITE_ID.test(id) ? await network.sites.get(id) : null;
    if (!record) throw new CmsError('CMS_NOT_FOUND', 'Site not found.');
    return siteView(c, record);
}

/**
 * Add a site: a name, an address under the network's subdomain, its first administrator (the
 * email of a network account; the caller's when left out), a language and whether it starts
 * with starter content.
 */
export async function siteCreate(c: Context, input: Body): Promise<SiteView> {
    const network = await networkAdmin(c);
    const principal = signedIn(c);
    if (!network.canAddSites) throw new CmsError('CMS_UNAVAILABLE', 'Sites need a place for their databases: set ROMEDB_SITES_URL and ROMEDB_SITES_TOKEN, or run on Node with a file database.');
    const name = text(input.name, 'name', { max: 120 });
    const host = text(input.host, 'host', { max: 253 }).toLowerCase();
    const email = text(input.admin, 'admin', { required: false, max: 254 });
    const admin = email ? await network.main.accounts.findByEmail(email) : await network.main.accounts.get(principal.id);
    if (!admin) throw new CmsError('CMS_VALIDATION', 'No network account has that email. Add the person under Network → Users first.', { fields: { admin: 'is not a network account.' } });
    const id = text(input.id, 'id', { required: false, max: 63 });
    const language = text(input.language, 'language', { required: false, max: 16 });
    const record = await network.createSite({ name, host, admin: admin.id, ...(id ? { id } : {}), ...(language ? { language } : {}), starter: input.starter !== false }, { principal });
    return siteView(c, record);
}

/** Archive, restore (`active`) or delete a site; a deleted site can be restored for 30 days. */
export async function siteSetStatus(c: Context, id: string, status: unknown): Promise<SiteView> {
    const network = await networkAdmin(c);
    if (status !== 'active' && status !== 'archived' && status !== 'deleted') throw new CmsError('CMS_VALIDATION', 'status is active, archived or deleted.');
    if (id === MAIN_SITE) throw new CmsError('CMS_VALIDATION', 'The main site cannot be archived or deleted.');
    if (!SITE_ID.test(id) || !(await network.sites.get(id))) throw new CmsError('CMS_NOT_FOUND', 'Site not found.');
    return siteView(c, await network.setSiteStatus(id, status, { principal: signedIn(c) }));
}

// --- Appearance: menus, their locations and the widget areas ----------------------------
// What Appearance → Menus and Appearance → Widgets do, for the appearance permission. The
// resolved menu visitors see at a location is `GET /api/cms/menus/<location>` (content-api).

const APPEARANCE = 'Not allowed to manage the appearance.';

export interface MenuLocationView { name: string; label: string; theme: string; active: boolean; /** The menu shown there, or null. */ menu: string | null }
export interface MenuSummaryView { id: string; name: string; /** How many items, every level counted. */ items: number; locations: string[]; updatedAt: number }
export interface MenuView { id: string; name: string; items: readonly MenuItem[]; rev: number; locations: string[]; createdAt: number; updatedAt: number }
export interface AreaView {
    name: string; label: string; theme: string; active: boolean;
    /** 0 while the theme's default blocks show; a save needs it. */
    rev: number;
    /** The site saved its own blocks; otherwise `blocks` are the theme's defaults. */
    saved: boolean;
    blocks: readonly Block[];
    defaults: readonly Block[];
    updatedAt: number;
}

async function menuLocationNames(cms: CmsHost): Promise<string[]> {
    return (await cms.menuLocations()).map(location => location.name);
}

async function menuView(cms: CmsHost, menu: MenuShape): Promise<MenuView> {
    const assigned = await cms.menus.locations();
    return { id: menu.id, name: menu.name, items: menu.items, rev: menu.revision, locations: [...assigned].filter(([, id]) => id === menu.id).map(([location]) => location), createdAt: menu.createdAt, updatedAt: menu.updatedAt };
}

async function menuOf(cms: CmsHost, id: string): Promise<MenuShape> {
    const menu = await cms.menus.get(id);
    if (!menu) throw new CmsError('CMS_NOT_FOUND', 'Menu not found.');
    return menu;
}

/** Items as a client sends them: a tree whose items may leave out their IDs, labels and children; the host checks the rest. */
function menuItems(value: unknown): MenuItem[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new CmsError('CMS_VALIDATION', 'items is a list of menu items.', { fields: { items: 'must be a list.' } });
    const fill = (list: unknown[]): MenuItem[] => list.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item as MenuItem;
        const given = item as { [name: string]: unknown };
        return {
            ...given,
            id: typeof given.id === 'string' && given.id ? given.id : menuItemId(),
            label: typeof given.label === 'string' ? given.label : '',
            children: Array.isArray(given.children) ? fill(given.children) : given.children === undefined ? [] : given.children,
        } as MenuItem;
    });
    return fill(value);
}

/** Location names a menu should show in, checked against the themes' before anything is written. */
async function wantedLocations(cms: CmsHost, value: unknown): Promise<{ locations: string[]; known: string[] } | null> {
    if (value === undefined) return null;
    const list = Array.isArray(value) ? value : [value];
    if (!list.every(location => typeof location === 'string')) throw new CmsError('CMS_VALIDATION', 'locations is a list of menu location names.', { fields: { locations: 'must be a list of names.' } });
    const known = await menuLocationNames(cms);
    for (const location of list as string[]) if (!known.includes(location)) throw new CmsError('CMS_VALIDATION', `${location} is not a menu location of a theme; the locations are ${known.join(', ') || 'none'}.`, { fields: { locations: `${location} is not a location.` } });
    return { locations: list as string[], known };
}

/** The themes' menu locations (the active theme's first) with the menu at each. */
export async function menuLocationsList(c: Context): Promise<{ items: MenuLocationView[] }> {
    allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const cms = c.get('cms');
    const [locations, assigned] = await Promise.all([cms.menuLocations(), cms.menus.locations()]);
    return { items: locations.map(location => ({ ...location, menu: assigned.get(location.name) ?? null })) };
}

/** Show a menu at a location (`menu` an ID), or none (`menu` null or empty). */
export async function menuLocationAssign(c: Context, location: string, input: Body): Promise<{ item: MenuLocationView }> {
    const principal = allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const cms = c.get('cms');
    const menu = input.menu === undefined || input.menu === null || input.menu === '' ? null : input.menu;
    if (menu !== null && typeof menu !== 'string') throw new CmsError('CMS_VALIDATION', 'menu is a menu ID, or null for none.', { fields: { menu: 'must be a menu ID.' } });
    await cms.menus.assign(location, menu, { principal, known: await menuLocationNames(cms) });
    const item = (await menuLocationsList(c)).items.find(entry => entry.name === location);
    return { item: item ?? { name: location, label: location, theme: '', active: false, menu } };
}

export async function menusList(c: Context): Promise<{ items: MenuSummaryView[] }> {
    allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    return { items: (await c.get('cms').menus.list()).map(menu => ({ id: menu.id, name: menu.name, items: menu.items, locations: [...menu.locations], updatedAt: menu.updatedAt })) };
}

export async function menuRead(c: Context, id: string): Promise<{ item: MenuView }> {
    allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const cms = c.get('cms');
    return { item: await menuView(cms, await menuOf(cms, id)) };
}

/** A new menu from `{ name, items?, locations? }`; items may leave out their IDs. */
export async function menuCreate(c: Context, input: Body): Promise<{ item: MenuView }> {
    const principal = allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const cms = c.get('cms');
    const wanted = await wantedLocations(cms, input.locations);
    const menu = await cms.menus.create({ name: text(input.name, 'name', { max: MENU_LIMITS.name }), items: menuItems(input.items) }, { principal });
    if (wanted?.locations.length) await cms.menus.place(menu.id, wanted.locations, { principal, known: wanted.known });
    return { item: await menuView(cms, menu) };
}

/**
 * Rename a menu, replace its items (the whole tree) or move it to exactly the `locations`
 * given. `rev` is the revision read; a stale one answers 409. Fields left out stay.
 */
export async function menuUpdate(c: Context, id: string, input: Body): Promise<{ item: MenuView }> {
    const principal = allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const cms = c.get('cms');
    let menu = await menuOf(cms, id);
    const wanted = await wantedLocations(cms, input.locations);
    if (input.name !== undefined || input.items !== undefined) {
        menu = await cms.menus.update(id, { name: input.name === undefined ? undefined : text(input.name, 'name', { max: MENU_LIMITS.name }), items: menuItems(input.items) }, { principal, expectedRevision: expected(input.rev, menu.revision) });
    }
    if (wanted) await cms.menus.place(menu.id, wanted.locations, { principal, known: wanted.known });
    return { item: await menuView(cms, menu) };
}

/** Delete a menu; the locations it held show none. */
export async function menuDelete(c: Context, id: string): Promise<void> {
    const principal = allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    await c.get('cms').menus.delete(id, { principal });
}

async function areaViews(cms: CmsHost): Promise<AreaView[]> {
    const [declared, saved] = await Promise.all([cms.areaLocations(), cms.areas.all()]);
    return declared.map(area => {
        const row = saved.get(area.name);
        return { name: area.name, label: area.label, theme: area.theme, active: area.active, rev: row?.revision ?? 0, saved: !!row, blocks: row ? row.blocks : area.defaults, defaults: area.defaults, updatedAt: row?.updatedAt ?? 0 };
    });
}

/** The themes' widget areas (the active theme's first) with the blocks each shows. */
export async function areasList(c: Context): Promise<{ items: AreaView[] }> {
    allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    return { items: await areaViews(c.get('cms')) };
}

export async function areaRead(c: Context, name: string): Promise<{ item: AreaView }> {
    allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const areas = await areaViews(c.get('cms'));
    const item = areas.find(area => area.name === name);
    if (!item) throw new CmsError('CMS_NOT_FOUND', `No widget area ${name}; the areas are ${areas.map(area => area.name).join(', ') || 'none'}.`);
    return { item };
}

/** Replace an area's blocks (`{ blocks, rev? }`); `rev` is the revision read, 0 while the theme's defaults show. */
export async function areaUpdate(c: Context, name: string, input: Body): Promise<{ item: AreaView }> {
    const principal = allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const cms = c.get('cms');
    const known = (await cms.areaLocations()).map(area => area.name);
    const current = await cms.areas.get(name);
    await cms.areas.save(name, input.blocks, { principal, expectedRevision: expected(input.rev, current.revision, 0), known });
    return areaRead(c, name);
}

/** Forget an area's saved blocks: the theme's defaults show again, and its revision is 0. */
export async function areaReset(c: Context, name: string): Promise<void> {
    const principal = allowed(c, PERMISSIONS.manageAppearance, APPEARANCE);
    const cms = c.get('cms');
    await cms.areas.reset(name, { principal, known: (await cms.areaLocations()).map(area => area.name) });
}
