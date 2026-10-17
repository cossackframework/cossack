/**
 * Autosaves: the editor's unsaved form values, one row per user and entry, so a closed tab or
 * a crash loses at most a few seconds of work. `new` stands for an entry not saved yet.
 */
import type { FastDB } from '@cossackframework/fastdb';
import { CmsError } from '../errors';

const WRITE = { kind: 'cms.autosaves', retryConflicts: 5 } as const;
const KEY = /^[A-Za-z0-9_-]{1,80}$/;

export interface Autosave {
    readonly data: unknown;
    readonly at: number;
}

export class CmsAutosaves {
    readonly #db: FastDB;
    readonly #now: () => number;

    constructor(db: FastDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** Store the values, replacing the user's previous autosave of the entry. At most 1 MB. */
    async save(resource: string, recordId: string, userId: string, data: unknown): Promise<number> {
        check(recordId, userId);
        const json = JSON.stringify(data ?? null);
        if (json.length > 1024 * 1024) throw new CmsError('CMS_LIMIT', 'The autosave is larger than 1 MB.');
        const at = this.#now();
        await this.#db.write([{
            sql: `INSERT INTO cms_autosaves (id, resource, record_id, user_id, data, at) VALUES ($id, $resource, $record, $user, $data, $at)
                ON CONFLICT (id) DO UPDATE SET data = excluded.data, at = excluded.at`,
            params: { $id: key(resource, recordId, userId), $resource: resource, $record: recordId, $user: userId, $data: json, $at: at },
        }], WRITE);
        return at;
    }

    async get(resource: string, recordId: string, userId: string): Promise<Autosave | null> {
        check(recordId, userId);
        const result = await this.#db.read([{ sql: 'SELECT data, at FROM cms_autosaves WHERE id = $id', params: { $id: key(resource, recordId, userId) } }]);
        const row = result.results[0]!.rows[0];
        if (!row) return null;
        try { return { data: JSON.parse(row[0] as string), at: Number(row[1] as bigint) }; } catch { return null; }
    }

    async discard(resource: string, recordId: string, userId: string): Promise<void> {
        check(recordId, userId);
        await this.#db.write([{ sql: 'DELETE FROM cms_autosaves WHERE id = $id', params: { $id: key(resource, recordId, userId) } }], WRITE);
    }

    /** Drop autosaves older than `olderThanMs` (default 30 days). */
    async purge(olderThanMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
        const old = await this.#db.read([{ sql: 'SELECT 1 FROM cms_autosaves WHERE at <= $before LIMIT 1', params: { $before: this.#now() - olderThanMs } }]);
        if (!old.results[0]!.rows.length) return;
        await this.#db.write([{ sql: 'DELETE FROM cms_autosaves WHERE id IN (SELECT id FROM cms_autosaves WHERE at <= $before LIMIT 500)', params: { $before: this.#now() - olderThanMs } }], WRITE);
    }
}

function key(resource: string, recordId: string, userId: string): string {
    return `${resource}:${recordId}:${userId}`;
}

function check(recordId: string, userId: string): void {
    if (!KEY.test(recordId) || !KEY.test(userId)) throw new CmsError('CMS_VALIDATION', 'Invalid entry or user.');
}
