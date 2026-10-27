/**
 * Second factors of CMS users: an authenticator app's secret, recovery codes, passkeys, and
 * the short-lived challenges of pending sign-ins and passkey ceremonies.
 */
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, verifyTotp } from '@cossackframework/auth';
import type { RomeDB, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { randomToken } from './tokens';

export interface PasskeyInfo {
    readonly id: string;
    readonly name: string;
    readonly deviceType: string | null;
    readonly backedUp: boolean;
    readonly createdAt: number;
    readonly lastUsedAt: number | null;
}

export interface StoredPasskeyRow extends PasskeyInfo {
    readonly userId: string;
    readonly publicKey: string;
    readonly counter: number;
    readonly transports: readonly string[] | null;
}

export interface SecurityStatus {
    /** An authenticator app is set up and confirmed. */
    readonly totp: boolean;
    /** Unused recovery codes. */
    readonly recoveryCodes: number;
    readonly passkeys: readonly PasskeyInfo[];
}

export type ChallengeKind = 'signin' | 'passkey-register' | 'passkey-signin';

const WRITE = { kind: 'cms.security', retryConflicts: 5 } as const;
const PASSKEY_COLUMNS = 'id, user_id, name, public_key, counter, transports, device_type, backed_up, created_at, last_used_at';
/** Wrong codes a pending sign-in allows. */
export const SIGN_IN_ATTEMPTS = 5;

export class CmsSecurity {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    async status(userId: string): Promise<SecurityStatus> {
        const result = await this.#db.read([
            { rql: 'SELECT totp_confirmed_at, recovery FROM cms_user_security WHERE user_id = $user', params: { $user: userId } },
            { rql: `SELECT ${PASSKEY_COLUMNS} FROM cms_passkeys WHERE user_id = $user ORDER BY created_at LIMIT 50`, params: { $user: userId } },
        ]);
        const row = result.results[0]!.rows[0];
        const recovery = row?.[1] ? (JSON.parse(row[1] as string) as string[]) : [];
        return { totp: Boolean(row?.[0]), recoveryCodes: row?.[0] ? recovery.length : 0, passkeys: result.results[1]!.rows.map(passkeyOf).map(({ userId: _u, publicKey: _p, counter: _c, transports: _t, ...info }) => info) };
    }

    /** Whether the user has an authenticator app or a passkey. */
    async hasSecondFactor(userId: string): Promise<boolean> {
        const status = await this.status(userId);
        return status.totp || status.passkeys.length > 0;
    }

    /** Whether a code from the authenticator app is required at sign-in (passkeys sign in on their own). */
    async requiresCode(userId: string): Promise<boolean> {
        return (await this.status(userId)).totp;
    }

    /** A new, unconfirmed authenticator secret. It takes effect once confirmed with a code. */
    async startTotp(userId: string): Promise<string> {
        const secret = generateTotpSecret();
        await this.#db.write([{
            rql: `INSERT INTO cms_user_security (user_id, totp_secret, totp_confirmed_at, totp_last_step, recovery, updated_at) VALUES ($user, $secret, NULL, NULL, NULL, $now)
                ON CONFLICT (user_id) DO UPDATE SET totp_secret = excluded.totp_secret, totp_confirmed_at = NULL, totp_last_step = NULL, updated_at = excluded.updated_at`,
            params: { $user: userId, $secret: secret, $now: this.#now() },
        }], WRITE);
        return secret;
    }

    /** The pending or confirmed secret, for showing the QR code again while setting up. */
    async pendingSecret(userId: string): Promise<string | null> {
        const result = await this.#db.read([{ rql: 'SELECT totp_secret, totp_confirmed_at FROM cms_user_security WHERE user_id = $user', params: { $user: userId } }]);
        const row = result.results[0]!.rows[0];
        return row && row[0] && !row[1] ? row[0] as string : null;
    }

    /** Confirm the authenticator with a current code. Returns new recovery codes, shown once. */
    async confirmTotp(userId: string, code: string): Promise<string[]> {
        const secret = await this.pendingSecret(userId);
        if (!secret) throw new CmsError('CMS_VALIDATION', 'Start the authenticator setup again.');
        const step = await verifyTotp(secret, code, { now: this.#now() });
        if (step === null) throw new CmsError('CMS_VALIDATION', 'That code is not right. Check the time on your device and try again.', { fields: { code: 'is not right.' } });
        const codes = generateRecoveryCodes();
        const hashes = await Promise.all(codes.map(hashRecoveryCode));
        await this.#db.write([{
            rql: 'UPDATE cms_user_security SET totp_confirmed_at = $now, totp_last_step = $step, recovery = $recovery, updated_at = $now WHERE user_id = $user AND totp_secret = $secret',
            params: { $now: this.#now(), $step: step, $recovery: JSON.stringify(hashes), $user: userId, $secret: secret },
        }], WRITE);
        return codes;
    }

    /** New recovery codes, replacing the old ones. Needs a confirmed authenticator. */
    async regenerateRecoveryCodes(userId: string): Promise<string[]> {
        if (!(await this.status(userId)).totp) throw new CmsError('CMS_VALIDATION', 'Set up an authenticator app first.');
        const codes = generateRecoveryCodes();
        await this.#db.write([{ rql: 'UPDATE cms_user_security SET recovery = $recovery, updated_at = $now WHERE user_id = $user',
            params: { $recovery: JSON.stringify(await Promise.all(codes.map(hashRecoveryCode))), $now: this.#now(), $user: userId } }], WRITE);
        return codes;
    }

    async disableTotp(userId: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_user_security WHERE user_id = $user', params: { $user: userId } }], WRITE);
    }

    /**
     * Check a second-factor code: the authenticator's current code (each step once) or an
     * unused recovery code, which is used up.
     */
    async verifyCode(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
        const result = await this.#db.read([{ rql: 'SELECT totp_secret, totp_confirmed_at, totp_last_step, recovery FROM cms_user_security WHERE user_id = $user', params: { $user: userId } }]);
        const row = result.results[0]!.rows[0];
        if (!row || !row[1]) return null;
        const last = row[2] === null ? null : Number(row[2] as bigint);
        const step = await verifyTotp(row[0] as string, code, { now: this.#now(), afterStep: last });
        if (step !== null) {
            // The step is recorded only if no other sign-in used it first.
            const update = await this.#db.write([{
                rql: 'UPDATE cms_user_security SET totp_last_step = $step WHERE user_id = $user AND (totp_last_step IS NULL OR totp_last_step < $step)',
                params: { $step: step, $user: userId },
            }], WRITE);
            return update.results[0]!.affected === 1n ? 'totp' : null;
        }
        const hashes = row[3] ? JSON.parse(row[3] as string) as string[] : [];
        const hash = await hashRecoveryCode(code);
        if (!hashes.includes(hash)) return null;
        const update = await this.#db.write([{ rql: 'UPDATE cms_user_security SET recovery = $next, updated_at = $now WHERE user_id = $user AND recovery = $current',
            params: { $next: JSON.stringify(hashes.filter(entry => entry !== hash)), $now: this.#now(), $user: userId, $current: row[3] as string } }], WRITE);
        return update.results[0]!.affected === 1n ? 'recovery' : null;
    }

    async passkeys(userId: string): Promise<StoredPasskeyRow[]> {
        const result = await this.#db.read([{ rql: `SELECT ${PASSKEY_COLUMNS} FROM cms_passkeys WHERE user_id = $user ORDER BY created_at LIMIT 50`, params: { $user: userId } }]);
        return result.results[0]!.rows.map(passkeyOf);
    }

    async passkey(id: string): Promise<StoredPasskeyRow | null> {
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(id)) return null;
        const result = await this.#db.read([{ rql: `SELECT ${PASSKEY_COLUMNS} FROM cms_passkeys WHERE id = $id`, params: { $id: id } }]);
        const row = result.results[0]!.rows[0];
        return row ? passkeyOf(row) : null;
    }

    async addPasskey(userId: string, passkey: { id: string; publicKey: string; counter: number; transports?: readonly string[]; deviceType?: string; backedUp?: boolean }, name: string): Promise<void> {
        const label = name.trim().slice(0, 80) || 'Passkey';
        if ((await this.passkeys(userId)).length >= 20) throw new CmsError('CMS_LIMIT', 'A user can have at most 20 passkeys.');
        try {
            await this.#db.write([{
                rql: `INSERT INTO cms_passkeys (id, user_id, name, public_key, counter, transports, device_type, backed_up, created_at) VALUES ($id, $user, $name, $key, $counter, $transports, $device, $backed, $now)`,
                params: { $id: passkey.id, $user: userId, $name: label, $key: passkey.publicKey, $counter: passkey.counter, $transports: passkey.transports ? JSON.stringify(passkey.transports) : null,
                    $device: passkey.deviceType ?? null, $backed: passkey.backedUp ? 1 : 0, $now: this.#now() },
            }], WRITE);
        } catch (error) {
            if ((error as { code?: string }).code === 'FDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', 'This passkey is already registered.', { cause: error });
            throw error;
        }
    }

    async renamePasskey(userId: string, id: string, name: string): Promise<void> {
        await this.#db.write([{ rql: 'UPDATE cms_passkeys SET name = $name WHERE id = $id AND user_id = $user', params: { $name: name.trim().slice(0, 80) || 'Passkey', $id: id, $user: userId } }], WRITE);
    }

    async removePasskey(userId: string, id: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_passkeys WHERE id = $id AND user_id = $user', params: { $id: id, $user: userId } }], WRITE);
    }

    /** Record a passkey sign-in; the counter only moves forward. */
    async usePasskey(id: string, counter: number): Promise<void> {
        await this.#db.write([{ rql: 'UPDATE cms_passkeys SET counter = $counter, last_used_at = $now WHERE id = $id', params: { $counter: counter, $now: this.#now(), $id: id } }], WRITE);
    }

    /** Remove every second factor, for a user who lost their device. */
    async reset(userId: string): Promise<void> {
        await this.#db.write([
            { rql: 'DELETE FROM cms_user_security WHERE user_id = $user', params: { $user: userId } },
            { rql: 'DELETE FROM cms_passkeys WHERE user_id = $user', params: { $user: userId } },
        ], WRITE);
    }

    /** A challenge kept for `ttlMs`; its random ID goes into a cookie or form. */
    async createChallenge(kind: ChallengeKind, userId: string | null, challenge: string, ttlMs = 5 * 60_000): Promise<string> {
        const id = randomToken(24);
        await this.#db.write([{ rql: 'INSERT INTO cms_auth_challenges (id, kind, user_id, challenge, attempts, expires_at) VALUES ($id, $kind, $user, $challenge, 0, $expires)',
            params: { $id: id, $kind: kind, $user: userId, $challenge: challenge, $expires: this.#now() + ttlMs } }], WRITE);
        return id;
    }

    /** A live challenge of the kind, without using it up. */
    async challenge(id: string, kind: ChallengeKind): Promise<{ userId: string | null; challenge: string; attempts: number } | null> {
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) return null;
        const result = await this.#db.read([{ rql: 'SELECT user_id, challenge, attempts, expires_at FROM cms_auth_challenges WHERE id = $id AND kind = $kind', params: { $id: id, $kind: kind } }]);
        const row = result.results[0]!.rows[0];
        if (!row || Number(row[3] as bigint) <= this.#now()) return null;
        return { userId: row[0] as string | null, challenge: row[1] as string, attempts: Number(row[2] as bigint) };
    }

    /** Use up a challenge: true only for the first caller while it is live. */
    async takeChallenge(id: string, kind: ChallengeKind): Promise<boolean> {
        const result = await this.#db.write([{ rql: 'DELETE FROM cms_auth_challenges WHERE id = $id AND kind = $kind AND expires_at > $now', params: { $id: id, $kind: kind, $now: this.#now() } }], WRITE);
        return result.results[0]!.affected === 1n;
    }

    /** Count a wrong code; the challenge ends after too many. Returns the attempts left. */
    async failChallenge(id: string): Promise<number> {
        await this.#db.write([
            { rql: 'UPDATE cms_auth_challenges SET attempts = attempts + 1 WHERE id = $id', params: { $id: id } },
            { rql: 'DELETE FROM cms_auth_challenges WHERE id = $id AND attempts >= $max', params: { $id: id, $max: SIGN_IN_ATTEMPTS } },
        ], WRITE);
        const live = await this.#db.read([{ rql: 'SELECT attempts FROM cms_auth_challenges WHERE id = $id', params: { $id: id } }]);
        const row = live.results[0]!.rows[0];
        return row ? SIGN_IN_ATTEMPTS - Number(row[0] as bigint) : 0;
    }

    async purgeExpired(): Promise<void> {
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_auth_challenges WHERE expires_at <= $now LIMIT 1', params: { $now: this.#now() } }]);
        if (!expired.results[0]!.rows.length) return;
        await this.#db.write([{ rql: 'DELETE FROM cms_auth_challenges WHERE id IN (SELECT id FROM cms_auth_challenges WHERE expires_at <= $now LIMIT 500)', params: { $now: this.#now() } }], WRITE);
    }
}

function passkeyOf(row: readonly Value[]): StoredPasskeyRow {
    return Object.freeze({
        id: row[0] as string, userId: row[1] as string, name: row[2] as string, publicKey: row[3] as string, counter: Number(row[4] as bigint),
        transports: row[5] ? JSON.parse(row[5] as string) as string[] : null, deviceType: row[6] as string | null, backedUp: Number(row[7] as bigint) === 1,
        createdAt: Number(row[8] as bigint), lastUsedAt: row[9] === null ? null : Number(row[9] as bigint),
    });
}
