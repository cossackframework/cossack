/**
 * Application passwords: named tokens a user creates for apps and scripts that call the
 * content API. A token is `cms_<id>.<secret>`; only the secret's SHA-256 is stored. Requests
 * act as the user with their current roles; `read` tokens may only read.
 */
import type { RomeDB } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { randomToken, sha256Hex, timingSafeEqual } from './tokens';

export type ApiTokenScope = 'read' | 'write';

export interface ApiToken {
    readonly id: string;
    readonly userId: string;
    readonly name: string;
    readonly scope: ApiTokenScope;
    readonly createdAt: number;
    readonly lastUsedAt: number | null;
    readonly expiresAt: number | null;
}

const WRITE = { kind: 'cms.tokens', retryConflicts: 5 } as const;
const FORMAT = /^cms_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
const COLUMNS = 'id, user_id, name, scope, created_at, last_used_at, expires_at';
/** Tokens a user can hold. */
export const API_TOKEN_LIMIT = 20;

export class CmsApiTokens {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /** A new token for the user. The returned `token` is shown once and cannot be read again. */
    async create(userId: string, input: { name: string; scope?: ApiTokenScope; expiresAt?: number | null }): Promise<{ token: string; record: ApiToken }> {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 80) throw new CmsError('CMS_VALIDATION', 'Name the application password in 1-80 characters.', { fields: { name: 'must be 1-80 characters.' } });
        const scope = input.scope ?? 'write';
        if (scope !== 'read' && scope !== 'write') throw new CmsError('CMS_VALIDATION', 'Access is read or write.');
        const now = this.#now();
        if (input.expiresAt !== undefined && input.expiresAt !== null && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now)) throw new CmsError('CMS_VALIDATION', 'The expiry must be in the future.');
        if ((await this.list(userId)).length >= API_TOKEN_LIMIT) throw new CmsError('CMS_LIMIT', `A user can have at most ${API_TOKEN_LIMIT} application passwords.`);
        const id = randomToken(12);
        const secret = randomToken(32);
        await this.#db.write([{
            rql: 'INSERT INTO cms_api_tokens (id, user_id, name, secret_hash, scope, created_at, expires_at) VALUES ($id, $user, $name, $hash, $scope, $now, $expires)',
            params: { $id: id, $user: userId, $name: name, $hash: await sha256Hex(secret), $scope: scope, $now: now, $expires: input.expiresAt ?? null },
        }], WRITE);
        return { token: `cms_${id}.${secret}`, record: { id, userId, name, scope, createdAt: now, lastUsedAt: null, expiresAt: input.expiresAt ?? null } };
    }

    async list(userId: string): Promise<ApiToken[]> {
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_api_tokens WHERE user_id = $user ORDER BY created_at DESC LIMIT 100`, params: { $user: userId } }]);
        return result.results[0]!.rows.map(tokenOf);
    }

    async revoke(userId: string, id: string): Promise<void> {
        const result = await this.#db.write([{ rql: 'DELETE FROM cms_api_tokens WHERE id = $id AND user_id = $user', params: { $id: id, $user: userId } }], WRITE);
        if (result.results[0]!.affected === 0n) throw new CmsError('CMS_NOT_FOUND', 'Application password not found.');
    }

    async revokeAll(userId: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_api_tokens WHERE user_id = $user', params: { $user: userId } }], WRITE);
    }

    /** The token's owner and access, or null for an unknown, wrong or expired token. Use is recorded at most every five minutes. */
    async verify(token: string): Promise<{ id: string; userId: string; scope: ApiTokenScope } | null> {
        const match = typeof token === 'string' ? FORMAT.exec(token) : null;
        if (!match) return null;
        const [, id, secret] = match;
        const result = await this.#db.read([{ rql: 'SELECT user_id, secret_hash, scope, expires_at, last_used_at FROM cms_api_tokens WHERE id = $id', params: { $id: id! } }]);
        const row = result.results[0]!.rows[0];
        if (!row || !timingSafeEqual(row[1] as string, await sha256Hex(secret!))) return null;
        const now = this.#now();
        if (row[3] !== null && Number(row[3] as bigint) <= now) return null;
        if (row[4] === null || now - Number(row[4] as bigint) > 5 * 60_000) {
            await this.#db.write([{ rql: 'UPDATE cms_api_tokens SET last_used_at = $now WHERE id = $id', params: { $now: now, $id: id! } }], WRITE).catch(() => undefined);
        }
        return { id: id!, userId: row[0] as string, scope: row[2] as ApiTokenScope };
    }
}

function tokenOf(row: readonly unknown[]): ApiToken {
    return Object.freeze({
        id: row[0] as string, userId: row[1] as string, name: row[2] as string, scope: row[3] as ApiTokenScope, createdAt: Number(row[4] as bigint),
        lastUsedAt: row[5] === null ? null : Number(row[5] as bigint), expiresAt: row[6] === null ? null : Number(row[6] as bigint),
    });
}
