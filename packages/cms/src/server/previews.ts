/**
 * Shareable preview links for unpublished entries. A link carries a random token; the table
 * keeps only its SHA-256, the entry and an expiry, so a database read cannot preview anything.
 */
import type { RomeDB } from '@cossackframework/romedb';
import { sha256Hex, randomToken } from './tokens';

const WRITE = { kind: 'cms.previews', retryConflicts: 5 } as const;
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

export interface PreviewLink {
    readonly token: string;
    readonly expiresAt: number;
}

export class CmsPreviews {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** A new link to the entry. Callers check that the principal may edit it. */
    async create(resource: string, recordId: string, createdBy: string | null, ttlMs = 7 * 24 * 60 * 60 * 1000): Promise<PreviewLink> {
        const token = randomToken(32);
        const now = this.#now();
        await this.#db.write([{
            rql: 'INSERT INTO cms_preview_tokens (id, resource, record_id, created_by, created_at, expires_at) VALUES ($id, $resource, $record, $by, $now, $expires)',
            params: { $id: await sha256Hex(token), $resource: resource, $record: recordId, $by: createdBy, $now: now, $expires: now + ttlMs },
        }], WRITE);
        return { token, expiresAt: now + ttlMs };
    }

    /** The entry a token opens, while it has not expired. */
    async verify(token: string): Promise<{ resource: string; recordId: string; expiresAt: number } | null> {
        if (typeof token !== 'string' || !TOKEN.test(token)) return null;
        const result = await this.#db.read([{ rql: 'SELECT resource, record_id, expires_at FROM cms_preview_tokens WHERE id = $id', params: { $id: await sha256Hex(token) } }]);
        const row = result.results[0]!.rows[0];
        if (!row || Number(row[2] as bigint) <= this.#now()) return null;
        return { resource: row[0] as string, recordId: row[1] as string, expiresAt: Number(row[2] as bigint) };
    }

    /** Links of an entry that have not expired. */
    async count(resource: string, recordId: string): Promise<number> {
        const result = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_preview_tokens WHERE resource = $resource AND record_id = $record AND expires_at > $now',
            params: { $resource: resource, $record: recordId, $now: this.#now() } }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    /** Revoke every link of an entry. */
    async revoke(resource: string, recordId: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_preview_tokens WHERE resource = $resource AND record_id = $record', params: { $resource: resource, $record: recordId } }], WRITE);
    }

    async purgeExpired(): Promise<void> {
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_preview_tokens WHERE expires_at <= $now LIMIT 1', params: { $now: this.#now() } }]);
        if (!expired.results[0]!.rows.length) return;
        await this.#db.write([{ rql: 'DELETE FROM cms_preview_tokens WHERE id IN (SELECT id FROM cms_preview_tokens WHERE expires_at <= $now LIMIT 500)', params: { $now: this.#now() } }], WRITE);
    }
}
