/**
 * Accounts on the network database: who can sign in. The account holds the email, password
 * hash, status, profile and network role; sessions, second factors, reset tokens and
 * application passwords belong to it and live in the same database. Sites keep their members
 * in `cms_users` under the account's ID. Emails are normalized to lowercase.
 */
import { createCredentialVerifier, createPasswordHasher, type CredentialVerifier, type PasswordHasher } from '@cossackframework/auth';
import { ClientError, type RomeDB, type Value } from '@cossackframework/romedb';
import { uuidv7 } from '@cossackframework/core';
import { CmsError } from '../errors';
import { NETWORK_ADMIN } from '../permissions';

export interface CmsAccount {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly avatar: string | null;
    readonly status: 'active' | 'disabled';
    /** `network_admin`, or null for everyone else. */
    readonly networkRole: typeof NETWORK_ADMIN | null;
    readonly createdAt: number;
    /** When the account last started a session, or null when never. */
    readonly lastSignInAt: number | null;
}

export interface AccountProfile {
    name?: string;
    email?: string;
    avatar?: string | null;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
export const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const COLUMNS = 'id, email, name, avatar, status, network_role, created_at, last_sign_in_at';
const WRITE = { kind: 'cms.accounts', retryConflicts: 5 } as const;
/** Another active network admin remains, so this account may stop being one. */
const ANOTHER_ADMIN = `EXISTS (SELECT 1 FROM cms_accounts WHERE network_role = '${NETWORK_ADMIN}' AND status = 'active' AND id <> $id)`;

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');

export class CmsAccounts {
    readonly #db: RomeDB;
    readonly #hasher: PasswordHasher;
    readonly #now: () => number;
    readonly verifier: CredentialVerifier<CmsAccount>;

    constructor(db: RomeDB, options: { hasher?: PasswordHasher; now?: () => number } = {}) {
        this.#db = db;
        this.#hasher = options.hasher ?? createPasswordHasher();
        this.#now = options.now ?? Date.now;
        type Row = { id: string; hash: string | null; status: string };
        this.verifier = createCredentialVerifier<Row, CmsAccount>({
            find: async email => {
                const result = await this.#db.read([{ rql: 'SELECT id, password_hash, status FROM cms_accounts WHERE email = $email', params: { $email: normalizeEmail(email) } }]);
                const row = result.results[0]!.rows[0];
                return row ? { id: row[0] as string, hash: row[1] as string | null, status: row[2] as string } : null;
            },
            passwordHash: row => row.status === 'active' ? row.hash : null,
            user: async row => (await this.get(row.id))!,
            hasher: this.#hasher,
            replacePasswordHash: async (row, expected, replacement) => {
                const result = await this.#db.write([{ rql: 'UPDATE cms_accounts SET password_hash = $next, updated_at = $now WHERE id = $id AND password_hash = $expected',
                    params: { $next: replacement, $now: this.#now(), $id: row.id, $expected: expected } }], WRITE);
                return result.results[0]!.affected === 1n;
            },
        });
    }

    async create(input: AccountProfile & { email: string; name: string; password?: string; id?: string; networkRole?: typeof NETWORK_ADMIN | null }): Promise<CmsAccount> {
        const email = normalizeEmail(input.email);
        checkProfile({ email, name: input.name, avatar: input.avatar ?? null });
        if (input.password !== undefined) checkPassword(input.password);
        const id = input.id ?? uuidv7();
        if (!ACCOUNT_ID.test(id)) throw new CmsError('CMS_VALIDATION', 'Invalid user ID.');
        const hash = input.password === undefined ? null : await this.#hasher.hash(input.password);
        const now = this.#now();
        try {
            await this.#db.write([{
                rql: "INSERT INTO cms_accounts (id, email, name, password_hash, avatar, status, network_role, created_at, updated_at) VALUES ($id, $email, $name, $hash, $avatar, 'active', $role, $now, $now)",
                params: { $id: id, $email: email, $name: input.name.trim(), $hash: hash, $avatar: input.avatar ?? null, $role: input.networkRole ?? null, $now: now },
            }], WRITE);
        } catch (error) { throw uniqueEmail(error); }
        return (await this.get(id))!;
    }

    async get(id: string): Promise<CmsAccount | null> {
        if (!ACCOUNT_ID.test(id)) return null;
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_accounts WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? accountOf(row) : null;
    }

    async findByEmail(email: string): Promise<CmsAccount | null> {
        const result = await this.#db.read([{ rql: `SELECT ${COLUMNS} FROM cms_accounts WHERE email = $email`, params: { $email: normalizeEmail(email) } }]);
        const row = result.results[0]!.rows[0];
        return row ? accountOf(row) : null;
    }

    async count(): Promise<number> {
        const result = await this.#db.read([{ rql: 'SELECT count(*) FROM cms_accounts' }]);
        return Number(result.results[0]!.rows[0]![0] as bigint);
    }

    /** Change the name, email or avatar. Sites copy them to their member rows. */
    async update(id: string, patch: AccountProfile): Promise<CmsAccount | null> {
        const current = await this.get(id);
        if (!current) return null;
        const next = { name: patch.name ?? current.name, email: patch.email === undefined ? current.email : normalizeEmail(patch.email), avatar: patch.avatar === undefined ? current.avatar : patch.avatar || null };
        checkProfile(next);
        try {
            await this.#db.write([{ rql: 'UPDATE cms_accounts SET name = $name, email = $email, avatar = $avatar, updated_at = $now WHERE id = $id',
                params: { $name: next.name.trim(), $email: next.email, $avatar: next.avatar, $now: this.#now(), $id: id } }], WRITE);
        } catch (error) { throw uniqueEmail(error); }
        return this.get(id);
    }

    async setPassword(id: string, password: string): Promise<boolean> {
        checkPassword(password);
        const result = await this.#db.write([{ rql: 'UPDATE cms_accounts SET password_hash = $hash, updated_at = $now WHERE id = $id', params: { $hash: await this.#hasher.hash(password), $now: this.#now(), $id: id } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    /** Allow or stop sign-in. The last active network admin cannot be disabled. */
    async setStatus(id: string, status: 'active' | 'disabled'): Promise<boolean> {
        if (status !== 'active' && status !== 'disabled') throw new CmsError('CMS_VALIDATION', 'Unknown account status.');
        const guard = status === 'disabled' ? ` AND (network_role IS NULL OR ${ANOTHER_ADMIN})` : '';
        const result = await this.#db.write([{ rql: `UPDATE cms_accounts SET status = $status, updated_at = $now WHERE id = $id${guard}`, params: { $status: status, $now: this.#now(), $id: id } }], WRITE);
        if (result.results[0]!.affected === 1n) return true;
        return this.#refuseLastAdmin(id, 'disabled');
    }

    /** Make the account a network admin, or stop it being one. The network keeps at least one. */
    async setNetworkRole(id: string, role: typeof NETWORK_ADMIN | null): Promise<boolean> {
        if (role !== null && role !== NETWORK_ADMIN) throw new CmsError('CMS_VALIDATION', 'Unknown network role.');
        const guard = role === null ? ` AND (network_role IS NULL OR ${ANOTHER_ADMIN})` : '';
        const result = await this.#db.write([{ rql: `UPDATE cms_accounts SET network_role = $role, updated_at = $now WHERE id = $id${guard}`, params: { $role: role, $now: this.#now(), $id: id } }], WRITE);
        if (result.results[0]!.affected === 1n) return true;
        return this.#refuseLastAdmin(id, 'removed from the network role');
    }

    /**
     * Remove the account with everything that signs it in: sessions, reset tokens, second
     * factors, pending sign-ins and application passwords. Site members are removed by their sites.
     */
    async delete(id: string): Promise<boolean> {
        if (!ACCOUNT_ID.test(id)) return false;
        const params = { $id: id };
        // Credentials go only when the account row went: the last network admin stays whole.
        const gone = 'NOT EXISTS (SELECT 1 FROM cms_accounts WHERE id = $id)';
        const result = await this.#db.write([
            { rql: `DELETE FROM cms_accounts WHERE id = $id AND (network_role IS NULL OR ${ANOTHER_ADMIN})`, params },
            ...['cms_auth_sessions', 'cms_password_resets', 'cms_user_security', 'cms_passkeys', 'cms_auth_challenges', 'cms_api_tokens']
                .map(table => ({ rql: `DELETE FROM ${table} WHERE user_id = $id AND ${gone}`, params })),
        ], WRITE);
        if (result.results[0]!.affected === 1n) return true;
        return this.#refuseLastAdmin(id, 'deleted');
    }

    /** False for an unknown account; throws when the account is the last network admin. */
    async #refuseLastAdmin(id: string, change: string): Promise<false> {
        if (await this.get(id)) throw new CmsError('CMS_FORBIDDEN', `The last network admin cannot be ${change}.`);
        return false;
    }

    /**
     * A one-time reset token for an active account, or null for an unknown email. The token is
     * returned once; the table keeps only its SHA-256, and earlier tokens for the account end.
     */
    async createPasswordReset(email: string, options: { ttlMs?: number } = {}): Promise<{ token: string; account: CmsAccount } | null> {
        const account = await this.findByEmail(email);
        if (!account || account.status !== 'active') return null;
        const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const now = this.#now();
        await this.#db.write([
            { rql: 'DELETE FROM cms_password_resets WHERE user_id = $user', params: { $user: account.id } },
            { rql: 'INSERT INTO cms_password_resets (id, user_id, created_at, expires_at) VALUES ($id, $user, $now, $expires)',
                params: { $id: await sha256(token), $user: account.id, $now: now, $expires: now + (options.ttlMs ?? 60 * 60_000) } },
        ], WRITE);
        return { token, account };
    }

    /**
     * Set a new password with a reset token. One conditional delete consumes the token, so
     * only one request can use it; the account's sessions end with the change.
     */
    async resetPassword(token: string, password: string): Promise<boolean> {
        if (typeof token !== 'string' || !TOKEN.test(token)) return false;
        checkPassword(password);
        const id = await sha256(token);
        const found = await this.#db.read([{ rql: 'SELECT user_id FROM cms_password_resets WHERE id = $id AND expires_at > $now', params: { $id: id, $now: this.#now() } }]);
        const account = found.results[0]!.rows[0]?.[0] as string | undefined;
        if (!account) return false;
        const hash = await this.#hasher.hash(password);
        const guard = 'EXISTS (SELECT 1 FROM cms_password_resets WHERE id = $id AND user_id = $user AND expires_at > $now)';
        const params = { $id: id, $user: account, $now: this.#now() };
        // The password and sessions change only if this request still holds the token.
        const result = await this.#db.write([
            { rql: `UPDATE cms_accounts SET password_hash = $hash, updated_at = $now WHERE id = $user AND ${guard}`, params: { ...params, $hash: hash } },
            { rql: `DELETE FROM cms_auth_sessions WHERE user_id = $user AND ${guard}`, params },
            { rql: 'DELETE FROM cms_password_resets WHERE id = $id AND user_id = $user AND expires_at > $now', params },
        ], WRITE);
        return result.results[2]!.affected === 1n && result.results[0]!.affected === 1n;
    }

    async purgeExpiredResets(): Promise<number> {
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_password_resets WHERE expires_at <= $now LIMIT 1', params: { $now: this.#now() } }]);
        if (!expired.results[0]!.rows.length) return 0;
        const result = await this.#db.write([{ rql: 'DELETE FROM cms_password_resets WHERE id IN (SELECT id FROM cms_password_resets WHERE expires_at <= $now LIMIT 500)', params: { $now: this.#now() } }], WRITE);
        return Number(result.results[0]!.affected);
    }
}

function accountOf(row: readonly Value[]): CmsAccount {
    return Object.freeze({
        id: row[0] as string, email: row[1] as string, name: row[2] as string, avatar: row[3] as string | null, status: row[4] as CmsAccount['status'],
        networkRole: row[5] === NETWORK_ADMIN ? NETWORK_ADMIN : null, createdAt: Number(row[6] as bigint), lastSignInAt: row[7] === null ? null : Number(row[7] as bigint),
    });
}

export function checkProfile(profile: { email: string; name: string; avatar: string | null }): void {
    if (!EMAIL.test(profile.email)) throw new CmsError('CMS_VALIDATION', 'Enter a valid email address.', { fields: { email: 'is invalid.' } });
    if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 120) throw new CmsError('CMS_VALIDATION', 'Enter a name of at most 120 characters.', { fields: { name: 'is required.' } });
    if (profile.avatar !== null && (typeof profile.avatar !== 'string' || profile.avatar.length > 2048 || !/^(?:https:\/\/|\/)[^\s]*$/.test(profile.avatar))) {
        throw new CmsError('CMS_VALIDATION', 'The avatar must be an https URL or a site path.', { fields: { avatar: 'is invalid.' } });
    }
}

function checkPassword(password: string): void {
    if (typeof password !== 'string' || password.length < 8) throw new CmsError('CMS_VALIDATION', 'Passwords need at least 8 characters.', { fields: { password: 'is too short.' } });
    if (new TextEncoder().encode(password).length > 1024) throw new CmsError('CMS_VALIDATION', 'Passwords can be at most 1024 bytes.', { fields: { password: 'is too long.' } });
}

export function uniqueEmail(error: unknown): unknown {
    if (error instanceof ClientError && error.outcome === 'rolled-back' && /UNIQUE/i.test(error.message)) return new CmsError('CMS_CONFLICT', 'A user with this email already exists.', { fields: { email: 'is taken.' } });
    return error;
}

export function normalizeEmail(email: string): string {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}
