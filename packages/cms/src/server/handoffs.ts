/**
 * Sign-in handoffs on the network database. Accounts sign in only on the network host; a site
 * gets its own session from a one-use code bound to the site and the network session, valid for
 * a minute. The network remembers which sites each session reached, to end their child
 * sessions with it.
 */
import type { RomeDB } from '@cossackframework/romedb';
import type { EndedSessions } from './stores';

const CODE = /^[a-f0-9]{64}$/;
const WRITE = { kind: 'cms.handoffs', retryConflicts: 5 } as const;

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');

export interface Handoff {
    /** The network session's public reference: the child session's parent. */
    readonly session: string;
    readonly user: string;
    /** The account's network role now, which the child session copies. */
    readonly networkRole: string | null;
    /** When the network session expires; the child session ends no later. */
    readonly expiresAt: number;
}

export class CmsHandoffs {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** A code for the network session to sign in on the site. Only its SHA-256 is stored. */
    async issue(input: { session: string; user: string; site: string; ttlMs?: number }): Promise<string> {
        const code = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const now = this.#now();
        await this.#db.write([{ rql: 'INSERT INTO cms_handoffs (id, session_id, user_id, site_id, created_at, expires_at) VALUES ($id, $session, $user, $site, $now, $expires)',
            params: { $id: await sha256(code), $session: input.session, $user: input.user, $site: input.site, $now: now, $expires: now + (input.ttlMs ?? 60_000) } }], WRITE);
        return code;
    }

    /**
     * The handoff a code names for this site, used at most once. Null when the code is unknown,
     * expired, for another site or used, or when its network session or active account is gone.
     */
    async consume(code: string, site: string): Promise<Handoff | null> {
        if (typeof code !== 'string' || !CODE.test(code)) return null;
        const id = await sha256(code);
        const now = this.#now();
        const found = await this.#db.read([{
            rql: `SELECT h.session_id, h.user_id, a.network_role, s.expires_at FROM cms_handoffs h JOIN cms_accounts a ON a.id = h.user_id
                JOIN cms_auth_sessions s ON s.public_id = h.session_id AND s.user_id = h.user_id
                WHERE h.id = $id AND h.site_id = $site AND h.expires_at > $now AND s.expires_at > $now AND a.status = 'active'`,
            params: { $id: id, $site: site, $now: now },
        }]);
        const row = found.results[0]!.rows[0];
        // Delete it either way; only the request whose delete removed it may use it.
        const taken = await this.#db.write([{ rql: 'DELETE FROM cms_handoffs WHERE id = $id', params: { $id: id } }], WRITE);
        if (!row || taken.results[0]!.affected !== 1n) return null;
        const handoff = { session: row[0] as string, user: row[1] as string, networkRole: row[2] as string | null, expiresAt: Number(row[3]) };
        await this.#db.write([{
            rql: 'INSERT INTO cms_session_sites (session_id, site_id, user_id, created_at) SELECT $session, $site, $user, $now WHERE 1 = 1 ON CONFLICT (session_id, site_id) DO NOTHING',
            params: { $session: handoff.session, $site: site, $user: handoff.user, $now: now },
        }], WRITE);
        return Object.freeze(handoff);
    }

    /** The sites these network sessions reached; `forget` drops the record once their child sessions ended. */
    async reached(ended: EndedSessions): Promise<string[]> {
        const result = await this.#db.read(['session' in ended
            ? { rql: 'SELECT DISTINCT site_id FROM cms_session_sites WHERE session_id = $session', params: { $session: ended.session } }
            : { rql: `SELECT DISTINCT site_id FROM cms_session_sites WHERE user_id = $user${ended.except ? ' AND session_id != $except' : ''}`, params: { $user: ended.user, ...(ended.except ? { $except: ended.except } : {}) } }]);
        return result.results[0]!.rows.map(row => row[0] as string);
    }

    async forget(ended: EndedSessions): Promise<void> {
        await this.#db.write(['session' in ended
            ? { rql: 'DELETE FROM cms_session_sites WHERE session_id = $session', params: { $session: ended.session } }
            : { rql: `DELETE FROM cms_session_sites WHERE user_id = $user${ended.except ? ' AND session_id != $except' : ''}`, params: { $user: ended.user, ...(ended.except ? { $except: ended.except } : {}) } }], WRITE);
    }

    async purgeExpired(): Promise<void> {
        const now = this.#now();
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_handoffs WHERE expires_at <= $now LIMIT 1', params: { $now: now } }]);
        if (!expired.results[0]!.rows.length) return;
        await this.#db.write([
            { rql: 'DELETE FROM cms_handoffs WHERE id IN (SELECT id FROM cms_handoffs WHERE expires_at <= $now LIMIT 500)', params: { $now: now } },
            // Records of network sessions that ended without telling the sites, after their expiry.
            { rql: 'DELETE FROM cms_session_sites WHERE session_id IN (SELECT ss.session_id FROM cms_session_sites ss WHERE NOT EXISTS (SELECT 1 FROM cms_auth_sessions s WHERE s.public_id = ss.session_id) LIMIT 500)' },
        ], WRITE);
    }
}
