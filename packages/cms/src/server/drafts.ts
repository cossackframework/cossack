/**
 * Shared drafts: what an entry's room (every editor of the entry together) holds between saves,
 * one row per entry, so a restart or an evicted instance loses at most the room's write delay.
 * The row also names who is editing, for the entries list. A RomeDB request takes 64 KiB, so a
 * draft is capped well under that; an entry that large could not be saved either.
 */
import type { RomeDB } from '@cossackframework/romedb';
import { CmsError } from '../errors';

const WRITE = { kind: 'cms.drafts', retryConflicts: 5 } as const;
const KEY = /^[A-Za-z0-9_-]{1,80}$/;
/** The draft's values as JSON, at most, in UTF-8 bytes as the request carries them. */
export const DRAFT_MAX_BYTES = 48 * 1024;

const encoder = new TextEncoder();

/** The bytes a string parameter takes in a RomeDB request: UTF-8, quoted and escaped as JSON. */
export function requestBytes(value: string): number {
    return encoder.encode(JSON.stringify(value)).length;
}
/** An editor the room has not reported for this long is no longer editing. */
export const EDITING_WINDOW = 90_000;

export interface Draft {
    /** The record's revision the draft started from or was last saved as. */
    readonly baseRev: number;
    readonly values: Record<string, unknown>;
    /** Rich text step log versions by document path. */
    readonly versions: Record<string, number>;
    /** User IDs in the room when the row was last written. */
    readonly editors: readonly string[];
    readonly at: number;
}

export interface DraftInput {
    readonly baseRev: number;
    readonly values: Record<string, unknown>;
    readonly versions: Record<string, number>;
    readonly editors: readonly string[];
}

export class CmsDrafts {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** Store the room's draft, replacing the entry's previous one. */
    async save(resource: string, recordId: string, draft: DraftInput): Promise<number> {
        check(recordId);
        if (!Number.isSafeInteger(draft.baseRev) || draft.baseRev < 0) throw new CmsError('CMS_VALIDATION', 'baseRev must be a nonnegative integer.');
        const data = JSON.stringify(draft.values ?? {});
        if (requestBytes(data) > DRAFT_MAX_BYTES) throw new CmsError('CMS_LIMIT', `The draft is larger than ${DRAFT_MAX_BYTES / 1024} KB.`);
        const at = this.#now();
        await this.#db.write([{
            rql: `INSERT INTO cms_drafts (id, resource, record_id, base_rev, data, logs, editors, editors_at, at) VALUES ($id, $resource, $record, $rev, $data, $logs, $editors, $at, $at)
                ON CONFLICT (id) DO UPDATE SET base_rev = excluded.base_rev, data = excluded.data, logs = excluded.logs, editors = excluded.editors, editors_at = excluded.editors_at, at = excluded.at`,
            params: { $id: key(resource, recordId), $resource: resource, $record: recordId, $rev: draft.baseRev, $data: data, $logs: JSON.stringify(draft.versions ?? {}), $editors: JSON.stringify(editorList(draft.editors)), $at: at },
        }], WRITE);
        return at;
    }

    async get(resource: string, recordId: string): Promise<Draft | null> {
        check(recordId);
        const result = await this.#db.read([{ rql: 'SELECT base_rev, data, logs, editors, at FROM cms_drafts WHERE id = $id', params: { $id: key(resource, recordId) } }]);
        const row = result.results[0]!.rows[0];
        if (!row) return null;
        try {
            const values = JSON.parse(row[1] as string) as unknown;
            const versions = JSON.parse(row[2] as string) as unknown;
            return {
                baseRev: Number(row[0] as bigint), at: Number(row[4] as bigint),
                values: values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : {},
                versions: versions && typeof versions === 'object' && !Array.isArray(versions) ? versions as Record<string, number> : {},
                editors: editorList(JSON.parse(row[3] as string)),
            };
        } catch { return null; }
    }

    /**
     * Who is in the entry's room now, without touching the draft itself: the room reports its
     * editors as they come and go. An entry without a draft row gets one holding no values.
     */
    async editing(resource: string, recordId: string, editors: readonly string[]): Promise<void> {
        check(recordId);
        const at = this.#now();
        await this.#db.write([{
            rql: `INSERT INTO cms_drafts (id, resource, record_id, base_rev, data, logs, editors, editors_at, at) VALUES ($id, $resource, $record, 0, '{}', '{}', $editors, $at, 0)
                ON CONFLICT (id) DO UPDATE SET editors = excluded.editors, editors_at = excluded.editors_at`,
            params: { $id: key(resource, recordId), $resource: resource, $record: recordId, $editors: JSON.stringify(editorList(editors)), $at: at },
        }], WRITE);
    }

    /** The editors in each entry's room within the window, by record ID; entries nobody edits are left out. */
    async editors(resource: string, recordIds: readonly string[], window = EDITING_WINDOW): Promise<Map<string, string[]>> {
        const wanted = new Set(recordIds);
        const found = new Map<string, string[]>();
        if (!wanted.size) return found;
        const result = await this.#db.read([{ rql: 'SELECT record_id, editors FROM cms_drafts WHERE resource = $resource AND editors_at > $since LIMIT 1000', params: { $resource: resource, $since: this.#now() - window } }]);
        for (const row of result.results[0]!.rows) {
            const id = row[0] as string;
            if (!wanted.has(id)) continue;
            try { const editors = editorList(JSON.parse(row[1] as string)); if (editors.length) found.set(id, editors); } catch { /* an unreadable row names nobody */ }
        }
        return found;
    }

    /** The entry was saved as `rev` from the draft: a reopened room starts from the record again. */
    async discard(resource: string, recordId: string): Promise<void> {
        check(recordId);
        await this.#db.write([{ rql: 'DELETE FROM cms_drafts WHERE id = $id', params: { $id: key(resource, recordId) } }], WRITE);
    }

    /** Drop drafts untouched for `olderThanMs` (default 30 days). */
    async purge(olderThanMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
        const before = this.#now() - olderThanMs;
        const old = await this.#db.read([{ rql: 'SELECT 1 FROM cms_drafts WHERE at <= $before AND editors_at <= $before LIMIT 1', params: { $before: before } }]);
        if (!old.results[0]!.rows.length) return;
        await this.#db.write([{ rql: 'DELETE FROM cms_drafts WHERE id IN (SELECT id FROM cms_drafts WHERE at <= $before AND editors_at <= $before LIMIT 500)', params: { $before: before } }], WRITE);
    }
}

function key(resource: string, recordId: string): string {
    return `${resource}:${recordId}`;
}

function check(recordId: string): void {
    if (!KEY.test(recordId)) throw new CmsError('CMS_VALIDATION', 'Invalid entry.');
}

function editorList(value: unknown): string[] {
    return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && KEY.test(entry)))].slice(0, 100) : [];
}
