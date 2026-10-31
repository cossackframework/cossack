/**
 * Redirects for paths without content: exact sources (`/old`) and prefixes (`/old/*` →
 * `/new/*`). The host records automatic 301s when a published entry's URL changes, in the
 * same batch as the change; administrators manage the rest under Tools → Redirects.
 */
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { containsPattern } from './users';
import { REDIRECT_PATH as PATH, redirectPath, redirectProblems, type Redirect, type RedirectInput, type RedirectStatus } from '../redirects';

const WRITE = { kind: 'cms.redirects', retryConflicts: 5 } as const;
const COLUMNS = 'id, source, target, status, prefix, kind, note, hits, last_hit_at, created_at, updated_at';

export class CmsRedirects {
    readonly #db: RomeDB;
    readonly #now: () => number;
    #prefixes: { at: number; rules: Promise<Redirect[]> } | undefined;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    async list(options: { search?: string; kind?: 'auto' | 'manual'; offset?: number; limit?: number } = {}): Promise<{ items: Redirect[]; total: number }> {
        const conditions: string[] = [];
        const params: { [key: string]: Value } = {};
        if (options.search?.trim()) {
            conditions.push("(lower(source) LIKE $search ESCAPE '\\' OR lower(target) LIKE $search ESCAPE '\\' OR lower(note) LIKE $search ESCAPE '\\')");
            params.$search = containsPattern(options.search.trim().slice(0, 200));
        }
        if (options.kind) { conditions.push('kind = $kind'); params.$kind = options.kind; }
        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
        const offset = Math.min(Math.max(options.offset ?? 0, 0), 10_000);
        const result = await this.#db.read([
            { rql: `SELECT ${COLUMNS} FROM cms_redirects${where} ORDER BY updated_at DESC, id LIMIT ${limit} OFFSET ${offset}`, ...(conditions.length ? { params } : {}) },
            { rql: `SELECT count(*) FROM cms_redirects${where}`, ...(conditions.length ? { params } : {}) },
        ]);
        return { items: result.results[0]!.rows.map(redirectOf), total: Number(result.results[1]!.rows[0]![0] as bigint) };
    }

    async get(id: string): Promise<Redirect | null> {
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_redirects WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? redirectOf(row) : null;
    }

    /** Create a redirect, or change the one with `id`. Sources are unique. */
    async save(input: RedirectInput, options: { id?: string; by?: string | null } = {}): Promise<Redirect> {
        const problems = redirectProblems(input);
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
        const source = redirectPath(input.source.trim());
        const status = input.status ?? 301;
        const target = status === 410 ? '' : input.target.trim();
        const now = this.#now();
        const id = options.id ?? crypto.randomUUID();
        const params = { $id: id, $source: source, $target: target, $status: status, $prefix: source.endsWith('/*') ? 1 : 0, $note: input.note?.trim() ?? '', $now: now, $by: options.by ?? null };
        try {
            const result = await this.#db.write([options.id
                ? { rql: 'UPDATE cms_redirects SET source = $source, target = $target, status = $status, prefix = $prefix, note = $note, kind = \'manual\', updated_at = $now WHERE id = $id', params: { ...params, $by: undefined as never } }
                : { rql: "INSERT INTO cms_redirects (id, source, target, status, prefix, kind, note, hits, created_at, updated_at, created_by) VALUES ($id, $source, $target, $status, $prefix, 'manual', $note, 0, $now, $now, $by)", params }].map(strip), WRITE);
            if (options.id && result.results[0]!.affected === 0n) throw new CmsError('CMS_NOT_FOUND', 'Redirect not found.');
        } catch (error) {
            if (error instanceof CmsError) throw error;
            if ((error as { code?: string }).code === 'FDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', `A redirect from ${source} already exists.`, { cause: error });
            throw error;
        }
        this.#prefixes = undefined;
        return (await this.get(id))!;
    }

    async delete(id: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_redirects WHERE id = $id', params: { $id: id } }], WRITE);
        this.#prefixes = undefined;
    }

    /**
     * The redirect for a path without content: an exact source first, then the longest prefix.
     * `location` is the target with a prefix's rest; null for 410.
     */
    async match(path: string): Promise<{ redirect: Redirect; location: string | null } | null> {
        const clean = redirectPath(path);
        if (!PATH.test(clean)) return null;
        const exact = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_redirects WHERE source = $source AND prefix = 0`, params: { $source: clean } }]);
        const row = exact.results[0]!.rows[0];
        if (row) {
            const redirect = redirectOf(row);
            return { redirect, location: redirect.status === 410 ? null : redirect.target };
        }
        let best: Redirect | undefined;
        for (const rule of await this.#prefixRules()) {
            const base = rule.source.slice(0, -2);
            if ((clean === base || clean.startsWith(`${base}/`)) && (!best || base.length > best.source.length - 2)) best = rule;
        }
        if (!best) return null;
        if (best.status === 410) return { redirect: best, location: null };
        const rest = clean.slice(best.source.length - 2).replace(/^\//, '');
        const location = best.target.endsWith('/*') ? `${best.target.slice(0, -2)}${rest ? `/${rest}` : ''}` || '/' : best.target;
        return { redirect: best, location };
    }

    /** Count a use of a redirect. */
    async hit(id: string): Promise<void> {
        await this.#db.write([{ rql: 'UPDATE cms_redirects SET hits = hits + 1, last_hit_at = $now WHERE id = $id', params: { $id: id, $now: this.#now() } }], WRITE);
    }

    /**
     * Statements recording `from` → `to` after a URL changed, each guarded by `guard` (RomeQL that is
     * true only when the change committed): the new URL stops being a redirect source,
     * redirects to the old URL follow it, and the old URL redirects to the new one.
     */
    automatic(from: string, to: string, options: { guard?: string; params?: { [key: string]: Value }; by?: string | null; prefix?: boolean } = {}): Statement[] {
        const source = redirectPath(from);
        const target = redirectPath(to);
        if (source === target || !PATH.test(source) || source === '/') return [];
        const guard = options.guard ? ` AND ${options.guard}` : '';
        const extra = options.params ?? {};
        const now = this.#now();
        this.#prefixes = undefined;
        return [
            strip({ rql: `DELETE FROM cms_redirects WHERE source = $rTo AND prefix = 0${guard}`, params: { ...extra, $rTo: target } }),
            strip({ rql: `UPDATE cms_redirects SET target = $rTo, updated_at = $rNow WHERE target = $rFrom${guard}`, params: { ...extra, $rTo: target, $rFrom: source, $rNow: now } }),
            strip({
                rql: `INSERT INTO cms_redirects (id, source, target, status, prefix, kind, note, hits, created_at, updated_at, created_by)
                    SELECT $rId, $rSource, $rTarget, 301, $rPrefix, 'auto', '', 0, $rNow, $rNow, $rBy WHERE 1 = 1${guard}
                    ON CONFLICT (source) DO UPDATE SET target = excluded.target, status = 301, prefix = excluded.prefix, kind = 'auto', updated_at = excluded.updated_at`,
                params: { ...extra, $rId: crypto.randomUUID(), $rSource: options.prefix ? `${source}/*` : source, $rTarget: options.prefix ? `${target === '/' ? '' : target}/*` : target, $rPrefix: options.prefix ? 1 : 0, $rNow: now, $rBy: options.by ?? null },
            }),
        ];
    }

    /** Remove the prefix redirect of a path that serves content again, such as a collection's restored path. */
    async dropPrefix(path: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_redirects WHERE source = $source AND prefix = 1', params: { $source: `${redirectPath(path)}/*` } }], WRITE);
        this.#prefixes = undefined;
    }

    /** Write automatic redirects outside a content change, such as after a path setting changed. */
    async record(pairs: readonly { from: string; to: string; prefix?: boolean }[], by: string | null): Promise<void> {
        const statements = pairs.flatMap(pair => this.automatic(pair.from, pair.to, { by, ...(pair.prefix ? { prefix: true } : {}) }));
        for (let index = 0; index < statements.length; index += 30) await this.#db.write(statements.slice(index, index + 30), WRITE);
        this.#prefixes = undefined;
    }

    #prefixRules(): Promise<Redirect[]> {
        const now = this.#now();
        if (!this.#prefixes || now - this.#prefixes.at > 30_000) {
            const rules = this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_redirects WHERE prefix = 1 ORDER BY updated_at DESC LIMIT 500` }]).then(result => result.results[0]!.rows.map(redirectOf));
            this.#prefixes = { at: now, rules };
            rules.catch(() => { this.#prefixes = undefined; });
        }
        return this.#prefixes.rules;
    }
}

function redirectOf(row: readonly Value[]): Redirect {
    return Object.freeze({
        id: row[0] as string, source: row[1] as string, target: row[2] as string, status: Number(row[3] as bigint) as RedirectStatus, prefix: Number(row[4] as bigint) === 1,
        kind: row[5] as 'auto' | 'manual', note: row[6] as string, hits: Number(row[7] as bigint), lastHitAt: row[8] === null ? null : Number(row[8] as bigint),
        createdAt: Number(row[9] as bigint), updatedAt: Number(row[10] as bigint),
    });
}

/** RomeDB rejects unused bindings. */
function strip(statement: { rql: string; params: { [key: string]: Value | undefined } }): Statement {
    const params = Object.fromEntries(Object.entries(statement.params).filter(([name, value]) => value !== undefined && new RegExp(`\\${name}(?![A-Za-z0-9_])`).test(statement.rql))) as { [key: string]: Value };
    return Object.keys(params).length ? { rql: statement.rql, params } : { rql: statement.rql };
}
