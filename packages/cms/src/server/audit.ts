/**
 * The audit trail: one row per write of a resource (who, what, which record, which revision,
 * when), written in the record's own batch by the repository. Read here for Tools → Activity and
 * pruned by maintenance after a year.
 */
import type { RomeDB, Statement, Value } from '@cossackframework/romedb';

export interface AuditEntry {
    readonly id: string;
    /** The actor as `principalId` wrote it: a user ID, `system:<reason>` or `anonymous`. */
    readonly actor: string | null;
    readonly action: string;
    readonly resource: string;
    readonly recordId: string;
    readonly revision: number | null;
    readonly at: number;
}

export interface AuditQuery {
    readonly limit?: number;
    readonly offset?: number;
    readonly resource?: string;
    readonly actor?: string;
    readonly action?: string;
    /** Rows at or after this time. */
    readonly since?: number;
}

/** Rows older than this are pruned. */
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60_000;
const WRITE = { kind: 'cms.audit', retryConflicts: 5 } as const;

/** The audit row of an unrestricted grant: who approved it, for Tools → Activity. */
export function unrestrictedGrantAudit(plugin: string, actor: string, at: number): Statement {
    return {
        rql: "INSERT INTO cms_audit (id, actor, action, resource, record_id, revision, at) VALUES ($id, $actor, 'grant-unrestricted', 'cms/plugins', $plugin, NULL, $at)",
        params: { $id: crypto.randomUUID(), $actor: actor, $plugin: plugin, $at: at },
    };
}

export class CmsAudit {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** Newest first, with the count of what matches. */
    async list(query: AuditQuery = {}): Promise<{ items: AuditEntry[]; total: number }> {
        const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
        const offset = Math.min(Math.max(query.offset ?? 0, 0), 100_000);
        const conditions: string[] = [];
        const params: { [name: string]: Value } = {};
        if (query.resource) { conditions.push('resource = $resource'); params.$resource = query.resource; }
        if (query.actor) { conditions.push('actor = $actor'); params.$actor = query.actor; }
        if (query.action) { conditions.push('action = $action'); params.$action = query.action; }
        if (query.since !== undefined) { conditions.push('at >= $since'); params.$since = query.since; }
        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const result = await this.#db.read([
            { rql: `SELECT id, actor, action, resource, record_id, revision, at FROM cms_audit${where} ORDER BY at DESC, id DESC LIMIT $limit OFFSET $offset`, params: { ...params, $limit: limit, $offset: offset } },
            { rql: `SELECT count(*) FROM cms_audit${where}`, params },
        ]);
        return {
            items: result.results[0]!.rows.map(row => ({ id: row[0] as string, actor: (row[1] as string | null) ?? null, action: row[2] as string, resource: row[3] as string, recordId: row[4] as string,
                revision: row[5] === null ? null : Number(row[5] as bigint), at: Number(row[6] as bigint) })),
            total: Number(result.results[1]!.rows[0]![0] as bigint),
        };
    }

    /** The distinct actions and resources seen lately, for the filters. */
    async facets(): Promise<{ actions: string[]; resources: string[] }> {
        const result = await this.#db.read([
            { rql: 'SELECT DISTINCT action FROM cms_audit ORDER BY action LIMIT 50' },
            { rql: 'SELECT DISTINCT resource FROM cms_audit ORDER BY resource LIMIT 200' },
        ]);
        return { actions: result.results[0]!.rows.map(row => row[0] as string), resources: result.results[1]!.rows.map(row => row[0] as string) };
    }

    /** Write one row for something that is not a resource write, such as an account recovery. */
    async record(entry: { actor: string; action: string; resource: string; recordId: string }): Promise<void> {
        await this.#db.write([{ rql: 'INSERT INTO cms_audit (id, actor, action, resource, record_id, revision, at) VALUES ($id, $actor, $action, $resource, $record, NULL, $at)',
            params: { $id: crypto.randomUUID(), $actor: entry.actor, $action: entry.action, $resource: entry.resource, $record: entry.recordId, $at: this.#now() } }], WRITE);
    }

    /** Drop rows older than the retention, a thousand at a time. */
    async prune(olderThanMs = AUDIT_RETENTION_MS): Promise<void> {
        const before = this.#now() - olderThanMs;
        const old = await this.#db.read([{ rql: 'SELECT 1 FROM cms_audit WHERE at < $before LIMIT 1', params: { $before: before } }]);
        if (!old.results[0]!.rows.length) return;
        await this.#db.write([{ rql: 'DELETE FROM cms_audit WHERE id IN (SELECT id FROM cms_audit WHERE at < $before LIMIT 1000)', params: { $before: before } }], WRITE);
    }
}
