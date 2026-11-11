/**
 * The site's search index: one `cms_search` document per entry an anonymous visitor may read
 * (published, not protected, not members-only, in a collection with a path on the site), with
 * one full-text index over its title and text. One index ranks every collection together, pages
 * with OFFSET, and holds nothing locked. The collections' own indexes stay for the dashboard.
 *
 * Each entry write keeps its row in step in the same batch, guarded by the write's audit row, and
 * copies the text from the entry document inside the statement, so the request carries no extra
 * text. `search.rebuild` fills the index from scratch in rounds of 200 entries from the outbox.
 */
import { defineAction } from '@cossackframework/core/hooks';
import { isLockedRecord } from './locked';
import { uuidv7 } from '@cossackframework/core';
import type { Statement, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { ANONYMOUS, hasPermission, ruleScope } from '../permissions';
import { isSearchSyntaxError, searchQuery, type SnippetPart } from '../search';
import type { CollectionDefinition } from '../collections';
import type { RecordShape } from '../records';
import type { Resource } from '../resource';
import { searchedAsText, searchTextPath } from './schema';
import type { CmsHost } from './host';

export const SITE_SEARCH = {
    collection: 'cms_search',
    index: 'cms_search__text',
    topic: 'search.rebuild',
    /** Entries one rebuild round reads, and one statement writes. */
    round: 200,
    batch: 100,
    /** RomeDB's largest `search::text` limit, so the deepest page reaches this many hits. */
    hits: 10_000,
    /** Characters of each hit's snippet (`search::snippet` takes 40 to 1000). */
    snippet: 160,
} as const;

/** One round of a rebuild, queued in the outbox; the first clears what it rebuilds. */
export interface SearchRebuildEvent {
    readonly eventId: string;
    readonly topic: 'search.rebuild';
    readonly at: number;
    readonly run: string;
    /** One collection's rows, or every collection's when null. */
    readonly only: string | null;
    /** Where the round starts: the collection and the last entry ID done in it. Both null for the first round. */
    readonly collection: string | null;
    readonly after: string | null;
    readonly step: number;
}

/** Runs a rebuild round from the outbox. The host handles it; plugins cannot hook it. */
export const searchRebuild = defineAction<SearchRebuildEvent>('cms.search.rebuild', { version: 1, timeoutMs: 60_000 });

/** A collection in the index, with its resource. */
export interface SearchedCollection {
    readonly collection: CollectionDefinition;
    readonly resource: Resource;
}

/** One hit of a site search, best first. */
export interface SiteSearchHit {
    readonly collection: string;
    readonly id: string;
    readonly score: number;
    readonly snippet: readonly SnippetPart[];
}

export interface SiteSearchPage {
    readonly hits: readonly SiteSearchHit[];
    readonly page: number;
    /** Another page follows. RomeDB counts only up to its limit, so there is no total. */
    readonly next: boolean;
    /** Nothing had every word, so these have any of them. */
    readonly loose: boolean;
}

export interface SiteSearchOptions {
    /** The page's language, on a site with several. */
    readonly locale?: string;
    /** Only these collections. */
    readonly collections?: readonly string[];
    readonly page?: number;
    readonly perPage?: number;
    readonly signal?: AbortSignal;
}

const WRITE = { kind: 'cms.search', retryConflicts: 5 } as const;

export class SiteSearch {
    readonly #host: CmsHost;

    constructor(host: CmsHost) {
        this.#host = host;
    }

    /** The collections the index holds: a path on the site, something to search, and visitors may read them. By name. */
    collections(): SearchedCollection[] {
        const found: SearchedCollection[] = [];
        for (const collection of this.#host.collections()) {
            if (collection.path === null || collection.path === undefined) continue;
            const resource = this.#host.resourceById(`cms/${collection.name}`);
            if (!Object.values(resource.fields).some(field => field.search) || ruleScope(resource.access.read, ANONYMOUS) === 'deny') continue;
            found.push({ collection, resource });
        }
        return found.sort((a, b) => a.collection.name < b.collection.name ? -1 : a.collection.name > b.collection.name ? 1 : 0);
    }

    /** What decides a collection's rows, to tell whether a saved collection needs them rebuilt; null when it has none. */
    signature(name: string): string | null {
        const searched = this.collections().find(entry => entry.collection.name === name);
        if (!searched) return null;
        const fields = Object.entries(searched.resource.fields).filter(([, declaration]) => declaration.search).map(([field, declaration]) => [field, searchedAsText(declaration), declaration.access?.read ?? null]);
        return JSON.stringify({ path: searched.collection.path, publishable: searched.collection.publishable !== false, read: searched.resource.access.read, fields, title: Boolean(searched.resource.fields.title), locale: Boolean(searched.resource.fields.locale) });
    }

    /**
     * The statements that keep an entry's row in step with a write, for the write's batch: the row
     * when visitors may read the entry (`readable` is the entry as written, or null after a delete
     * or when visitors may not read it), else no row. Guarded by the write's audit row `op`.
     */
    statements(resource: Resource, key: string, op: string, readable: RecordShape | null): Statement[] {
        const searched = this.#searched(resource);
        if (!searched) return [];
        const guard = 'EXISTS (SELECT 1 FROM cms_audit WHERE id = $sOp)';
        if (readable && this.#visible(searched, readable)) {
            return [this.#upsert(searched, `d.id = type::record('${resource.storage}', $sKey) AND ${guard}`, { $sKey: key, $sOp: op })];
        }
        return [{ rql: `DELETE FROM ${SITE_SEARCH.collection} WHERE id = type::record('${SITE_SEARCH.collection}', $sId) AND ${guard}`, params: { $sId: `${searched.collection.name}:${key}`, $sOp: op } }];
    }

    /** Fill the index again from the entries, in the background: every collection, or one. */
    async rebuild(options: { only?: string; signal?: AbortSignal } = {}): Promise<void> {
        const run = uuidv7();
        const at = this.#host.now();
        const event: SearchRebuildEvent = { eventId: `search:${run}:0`, topic: 'search.rebuild', at, run, only: options.only ?? null, collection: null, after: null, step: 0 };
        await this.#host.outbox.enqueue(SITE_SEARCH.topic, event, options.signal ? { signal: options.signal } : {});
        this.#host.outboxWritten();
    }

    /** One rebuild round: clear first, then up to 200 entries, then queue the next round. */
    async step(event: SearchRebuildEvent, options: { signal?: AbortSignal } = {}): Promise<void> {
        const call = options.signal ? { signal: options.signal } : {};
        const searched = this.collections().filter(entry => event.only === null || entry.collection.name === event.only);
        if (event.collection === null && event.after === null) {
            await this.#host.db.write([event.only === null
                ? { rql: `DELETE FROM ${SITE_SEARCH.collection}` }
                : { rql: `DELETE FROM ${SITE_SEARCH.collection} WHERE collection = $collection`, params: { $collection: event.only } }], { ...call, ...WRITE });
        }
        let position = event.collection === null ? 0 : searched.findIndex(entry => entry.collection.name >= event.collection!);
        let after = position >= 0 && searched[position]?.collection.name === event.collection ? event.after : null;
        let budget: number = SITE_SEARCH.round;
        while (position >= 0 && position < searched.length && budget > 0) {
            const entry = searched[position]!;
            const storage = entry.resource.storage;
            const size = Math.min(budget, SITE_SEARCH.batch);
            const page = await this.#host.db.read([{
                rql: `SELECT record::id(id) FROM ${storage}${after === null ? '' : ` WHERE id > type::record('${storage}', $after)`} ORDER BY id LIMIT ${size}`,
                params: after === null ? {} : { $after: after },
            }], call);
            const ids = page.results[0]!.rows.map(row => row[0] as string);
            if (ids.length) {
                const visible = this.#visibleRql(entry);
                await this.#host.db.write([this.#upsert(entry, [`d.id >= type::record('${storage}', $from)`, `d.id <= type::record('${storage}', $to)`, ...visible.rql].join(' AND '), { ...visible.params, $from: ids[0]!, $to: ids.at(-1)! })], { ...call, ...WRITE });
                budget -= ids.length;
                after = ids.at(-1)!;
            }
            if (ids.length < size) {
                position++;
                after = null;
            }
        }
        if (position < 0 || position >= searched.length) return;
        const next: SearchRebuildEvent = { ...event, eventId: `search:${event.run}:${event.step + 1}`, at: this.#host.now(), collection: searched[position]!.collection.name, after, step: event.step + 1 };
        await this.#host.outbox.enqueue(SITE_SEARCH.topic, next, { ...call, ignoreDuplicate: true });
    }

    /** How many entries the index holds, and whether a rebuild is under way. */
    async status(options: { signal?: AbortSignal } = {}): Promise<{ entries: number; rebuilding: boolean }> {
        const result = await this.#host.db.read([
            { rql: `SELECT count(*) FROM ${SITE_SEARCH.collection}` },
            { rql: 'SELECT count(*) FROM cms_outbox WHERE topic = $topic AND delivered_at IS NULL', params: { $topic: SITE_SEARCH.topic } },
        ], options.signal ? { signal: options.signal } : {});
        return { entries: Number(result.results[0]!.rows[0]![0] as bigint), rebuilding: Number(result.results[1]!.rows[0]![0] as bigint) > 0 };
    }

    /**
     * One page of the site's entries matching what someone typed, best first, with snippets:
     * every word, else (on the first page) any word, with `loose` set. Empty for nothing searchable.
     * The hits name entries; load them as the reader, who may still be refused one.
     */
    async search(text: string, options: SiteSearchOptions = {}): Promise<SiteSearchPage> {
        const page = options.page ?? 1;
        const perPage = options.perPage ?? 10;
        if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50) throw new CmsError('CMS_VALIDATION', 'perPage must be 1..50.');
        if (!Number.isInteger(page) || page < 1) throw new CmsError('CMS_VALIDATION', 'page must be a positive integer.');
        const parsed = searchQuery(text);
        const empty: SiteSearchPage = { hits: [], page, next: false, loose: false };
        const offset = (page - 1) * perPage;
        if (!parsed || offset + perPage > SITE_SEARCH.hits) return empty;
        const shown = this.collections().map(entry => entry.collection.name);
        const wanted = options.collections ? shown.filter(name => options.collections!.includes(name)) : shown;
        if (!wanted.length) return empty;
        const params: { [key: string]: Value } = {};
        const conditions = [`s.collection IN (${wanted.map((name, index) => { params[`$c${index}`] = name; return `$c${index}`; }).join(', ')})`];
        if (options.locale !== undefined) {
            conditions.push('s.locale = $locale');
            params.$locale = options.locale;
        }
        // Hits are checked again in the outer query; fetch more when some may be filtered out.
        const filtered = options.locale !== undefined || wanted.length < shown.length;
        const run = async (query: string) => {
            // The page's hits first, then a snippet cut in the database for each of them only: a
            // projection beside ORDER BY would cut one for every hit fetched, and a hit's text never leaves.
            const onPage = `SELECT h.id, h.score FROM search::text('${SITE_SEARCH.index}', $query, $limit) h JOIN ${SITE_SEARCH.collection} s ON s.id = h.id WHERE ${conditions.join(' AND ')} ORDER BY h.score DESC, h.id LIMIT ${perPage + 1}${offset ? ` OFFSET ${offset}` : ''}`;
            const result = await this.#host.db.read([{
                rql: `SELECT s.collection, s.entry, search::snippet('${SITE_SEARCH.index}', s.text, $query, ${SITE_SEARCH.snippet}), p.score FROM (${onPage}) p JOIN ${SITE_SEARCH.collection} s ON s.id = p.id ORDER BY p.score DESC, p.id`,
                params: { ...params, $query: query, $limit: Math.min((offset + perPage + 1) * (filtered ? 4 : 1), SITE_SEARCH.hits) },
            }], { ...(options.signal ? { signal: options.signal } : {}), workLimits: this.#host.readLimits }).catch(error => {
                if (isSearchSyntaxError(error)) throw new CmsError('CMS_VALIDATION', 'That search could not be read.');
                throw error;
            });
            return result.results[0]!.rows;
        };
        let rows = await run(parsed.all);
        let loose = false;
        if (!rows.length && page === 1 && parsed.any) {
            rows = await run(parsed.any);
            loose = rows.length > 0;
        }
        const hits = rows.slice(0, perPage).map(([collection, id, snippet, score]) => ({
            collection: collection as string, id: id as string, score: Number(score), snippet: snippetOf(snippet),
        }));
        return { hits, page, next: rows.length > perPage, loose };
    }

    #searched(resource: Resource): SearchedCollection | undefined {
        if (!resource.id.startsWith('cms/')) return undefined;
        return this.collections().find(entry => entry.resource.id === resource.id);
    }

    /** Whether visitors may read an entry the read rule lets them see: published, not protected, not members-only. */
    #visible(searched: SearchedCollection, record: RecordShape): boolean {
        if (searched.collection.publishable !== false && record.status !== 'published') return false;
        return !isLockedRecord(record);
    }

    /** `#visible` and the visitor's read rule, as conditions on the entry document `d`. */
    #visibleRql(searched: SearchedCollection): { rql: string[]; params: { [key: string]: Value } } {
        const fields = searched.resource.fields;
        const rql: string[] = [];
        const params: { [key: string]: Value } = {};
        if (searched.collection.publishable !== false) rql.push(`d.status = 'published'`);
        if (fields.password) rql.push(`(d.password IS NULL OR d.password = '')`);
        if (fields.membersOnly) rql.push('NOT coalesce(d."membersOnly", false)');
        const scope = ruleScope(searched.resource.access.read, ANONYMOUS);
        if (scope !== 'allow' && scope !== 'deny') {
            const rules = scope.where.map((rule, ruleIndex) => Object.entries(rule).map(([name, value], index) => {
                params[`$v${ruleIndex}_${index}`] = value as Value;
                return `d."${name}" = $v${ruleIndex}_${index}`;
            }).join(' AND '));
            rql.push(rules.length ? `(${rules.map(rule => `(${rule})`).join(' OR ')})` : 'false');
        }
        return { rql, params };
    }

    /** Write the rows of the entries `where` picks, copying their text inside the statement. */
    #upsert(searched: SearchedCollection, where: string, params: { [key: string]: Value }): Statement {
        const fields = searched.resource.fields;
        // Searchable fields visitors may read, the title aside; rich text, blocks and rows by their plain text.
        const parts = Object.entries(fields)
            .filter(([name, declaration]) => declaration.search && name !== 'title' && (!declaration.access?.read || hasPermission(ANONYMOUS, declaration.access.read)))
            .map(([name, declaration]) => `d."${searchedAsText(declaration) ? searchTextPath(name) : name}"`);
        const text = parts.length ? `concat_ws(char(10), ${parts.join(', ')})` : `''`;
        const title = fields.title && (!fields.title.access?.read || hasPermission(ANONYMOUS, fields.title.access.read)) ? 'd.title' : 'NULL';
        const locale = fields.locale ? 'd.locale' : 'NULL';
        const at = fields.publishedAt ? 'd."publishedAt"' : 'NULL';
        return {
            rql: `INSERT OR REPLACE INTO ${SITE_SEARCH.collection} (id, collection, entry, locale, title, text, at) SELECT type::record('${SITE_SEARCH.collection}', $sCollection || ':' || record::id(d.id)), $sCollection, record::id(d.id), ${locale}, ${title}, ${text}, ${at} FROM ${searched.resource.storage} d WHERE ${where}`,
            params: { ...params, $sCollection: searched.collection.name },
        };
    }
}

/** `search::snippet`'s parts as plain values: text and a match flag each, empty parts left out. */
function snippetOf(value: unknown): SnippetPart[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(part => part !== null && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' && (part as { text: string }).text !== ''
        ? [{ text: (part as { text: string }).text, match: (part as { match?: unknown }).match === true }] : []);
}
