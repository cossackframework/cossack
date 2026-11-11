/**
 * Second factors of CMS users: an authenticator app's secret, recovery codes, passkeys, and
 * the short-lived challenges of pending sign-ins and passkey ceremonies.
 */
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, verifyTotp } from '@cossackframework/auth';
import type { RomeDB, Value } from '@cossackframework/romedb';
import { CmsError } from '../errors';
import { randomToken, sha256Hex } from './tokens';

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
/**
 * Second-factor codes counted per account for a window, across every pending sign-in: a right
 * password does not give them back, so knowing the password does not buy more guesses.
 */
export const SECOND_FACTOR_LOCK = Object.freeze({ windowMs: 15 * 60_000, perAccount: 10 });
/**
 * Password sign-ins are counted per email and per client address for a window, a right password
 * giving its attempt back; past the limit the sign-in is refused until the window ends, whether
 * or not the account exists.
 */
export const SIGN_IN_LOCK = Object.freeze({ windowMs: 15 * 60_000, perEmail: 5, perAddress: 20 });
/** Password reset requests per email and per address in an hour; beyond them nothing is sent. */
export const RESET_REQUESTS = Object.freeze({ windowMs: 60 * 60_000, perEmail: 3, perAddress: 10 });

export class CmsSecurity {
    readonly #db: RomeDB;
    readonly #now: () => number;

    constructor(db: RomeDB, options: { now?: () => number } = {}) {
        this.#db = db;
        this.#now = options.now ?? Date.now;
    }

    /**
     * Start a password sign-in: one attempt is counted for the email and for the address before
     * the password is checked, in conditional writes, so attempts sent at once are held to the
     * limits as well as one after another. Refused while either is at its limit for the window.
     * A right password gives the attempt back (`signInSucceeded`); a wrong one leaves it counted.
     */
    async signInBegin(email: string, address: string): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
        const [emailId, addressId] = [await emailKey(email), addressKey(address)];
        const byEmail = await this.#count(emailId, SIGN_IN_LOCK.windowMs, SIGN_IN_LOCK.perEmail);
        const byAddress = byEmail && await this.#count(addressId, SIGN_IN_LOCK.windowMs, SIGN_IN_LOCK.perAddress);
        if (byEmail && byAddress) return { ok: true };
        // The email's attempt does not stand when the address refused it.
        if (byEmail) await this.#giveBack(emailId);
        const result = await this.#db.read([{ rql: 'SELECT until FROM cms_attempts WHERE key = $key', params: { $key: byEmail ? addressId : emailId } }]);
        const until = Number((result.results[0]!.rows[0]?.[0] as bigint | undefined) ?? 0n);
        return { ok: false, retryAfterMs: Math.max(1, until - this.#now()) };
    }

    /** A right password: the email's failures are forgotten, and the address gets this attempt back. */
    async signInSucceeded(email: string, address: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_attempts WHERE key = $key', params: { $key: await emailKey(email) } }], WRITE);
        await this.#giveBack(addressKey(address));
    }

    async #giveBack(key: string): Promise<void> {
        await this.#db.write([{ rql: 'UPDATE cms_attempts SET count = count - 1 WHERE key = $key AND count > 0', params: { $key: key } }], WRITE);
    }

    /**
     * Count an attempt of `kind` (such as `reset`) for a key within a window; false past `max`.
     * A refused attempt keeps the gate shut until the window ends.
     */
    async attempt(kind: string, key: string, max: number, windowMs: number): Promise<boolean> {
        return this.#count(attemptKey(kind, key), windowMs, max);
    }

    /** Give back an attempt `attempt()` counted, for one that did not go ahead after all. */
    async release(kind: string, key: string): Promise<void> {
        await this.#giveBack(attemptKey(kind, key));
    }

    /**
     * One more attempt for the key, unless it already has `max` in its window: true when this
     * one was counted. The database does the counting in one write (an ended window starts
     * again, then a conditional increment), so concurrent attempts are each counted once and
     * no more than `max` are let through.
     */
    async #count(key: string, windowMs: number, max: number): Promise<boolean> {
        const now = this.#now();
        const result = await this.#db.write([
            { rql: 'DELETE FROM cms_attempts WHERE key = $key AND until <= $now', params: { $key: key, $now: now } },
            { rql: 'INSERT INTO cms_attempts (key, count, until) VALUES ($key, 0, $until) ON CONFLICT (key) DO NOTHING', params: { $key: key, $until: now + windowMs } },
            { rql: 'UPDATE cms_attempts SET count = count + 1 WHERE key = $key AND count < $max', params: { $key: key, $max: max } },
        ], WRITE);
        return result.results[2]!.affected === 1n;
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

    /**
     * A new, unconfirmed authenticator secret. It takes effect once confirmed with a code. A
     * confirmed authenticator stays as it is: replacing it means turning it off first, which
     * asks for one of its codes, so starting a setup never removes the factor in use.
     */
    async startTotp(userId: string): Promise<string> {
        const secret = generateTotpSecret();
        const now = this.#now();
        const result = await this.#db.write([
            { rql: 'INSERT INTO cms_user_security (user_id, totp_secret, totp_confirmed_at, totp_last_step, recovery, updated_at) VALUES ($user, $secret, NULL, NULL, NULL, $now) ON CONFLICT (user_id) DO NOTHING',
                params: { $user: userId, $secret: secret, $now: now } },
            { rql: 'UPDATE cms_user_security SET totp_secret = $secret, totp_last_step = NULL, updated_at = $now WHERE user_id = $user AND totp_confirmed_at IS NULL',
                params: { $user: userId, $secret: secret, $now: now } },
        ], WRITE);
        if (result.results[1]!.affected !== 1n) throw new CmsError('CMS_VALIDATION', 'An authenticator app is already on. Turn it off with one of its codes before setting up another.');
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
            if ((error as { code?: string }).code === 'RDB_CONSTRAINT') throw new CmsError('CMS_CONFLICT', 'This passkey is already registered.', { cause: error });
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

    /**
     * Spend one try of a pending sign-in before its code is checked: counted on the challenge
     * (in a conditional write, so codes sent at once each take a try and no more than
     * `SIGN_IN_ATTEMPTS` are checked) and on the account (`SECOND_FACTOR_LOCK`). `expired` when
     * the challenge has no tries left or ended, `locked` when the account has used its codes.
     */
    async secondFactorAttempt(id: string, userId: string): Promise<{ left: number } | 'expired' | 'locked'> {
        const now = this.#now();
        const counted = await this.#db.write([{ rql: 'UPDATE cms_auth_challenges SET attempts = attempts + 1 WHERE id = $id AND kind = $kind AND user_id = $user AND attempts < $max AND expires_at > $now',
            params: { $id: id, $kind: 'signin', $user: userId, $max: SIGN_IN_ATTEMPTS, $now: now } }], WRITE);
        if (counted.results[0]!.affected !== 1n) return 'expired';
        if (!(await this.#count(secondFactorKey(userId), SECOND_FACTOR_LOCK.windowMs, SECOND_FACTOR_LOCK.perAccount))) {
            await this.#db.write([{ rql: 'DELETE FROM cms_auth_challenges WHERE id = $id', params: { $id: id } }], WRITE);
            return 'locked';
        }
        const live = await this.#db.read([{ rql: 'SELECT attempts FROM cms_auth_challenges WHERE id = $id', params: { $id: id } }]);
        const row = live.results[0]!.rows[0];
        return { left: row ? SIGN_IN_ATTEMPTS - Number(row[0] as bigint) : 0 };
    }

    /** A wrong code: the challenge ends once it has no tries left. */
    async failChallenge(id: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_auth_challenges WHERE id = $id AND attempts >= $max', params: { $id: id, $max: SIGN_IN_ATTEMPTS } }], WRITE);
    }

    /** A right code: the account's second-factor count starts again. */
    async secondFactorSucceeded(userId: string): Promise<void> {
        await this.#db.write([{ rql: 'DELETE FROM cms_attempts WHERE key = $key', params: { $key: secondFactorKey(userId) } }], WRITE);
    }

    async purgeExpired(): Promise<void> {
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_auth_challenges WHERE expires_at <= $now LIMIT 1', params: { $now: this.#now() } }]);
        if (!expired.results[0]!.rows.length) return;
        await this.#db.write([{ rql: 'DELETE FROM cms_auth_challenges WHERE id IN (SELECT id FROM cms_auth_challenges WHERE expires_at <= $now LIMIT 500)', params: { $now: this.#now() } }], WRITE);
    }

    /** Remove attempt counts whose window ended (500 at a time), which nothing else would. */
    async purgeAttempts(): Promise<void> {
        const now = this.#now();
        const expired = await this.#db.read([{ rql: 'SELECT 1 FROM cms_attempts WHERE until <= $now LIMIT 1', params: { $now: now } }]);
        if (!expired.results[0]!.rows.length) return;
        await this.#db.write([{ rql: 'DELETE FROM cms_attempts WHERE key IN (SELECT key FROM cms_attempts WHERE until <= $now LIMIT 500)', params: { $now: now } }], WRITE);
    }
}

function passkeyOf(row: readonly Value[]): StoredPasskeyRow {
    return Object.freeze({
        id: row[0] as string, userId: row[1] as string, name: row[2] as string, publicKey: row[3] as string, counter: Number(row[4] as bigint),
        transports: row[5] ? JSON.parse(row[5] as string) as string[] : null, deviceType: row[6] as string | null, backedUp: Number(row[7] as bigint) === 1,
        createdAt: Number(row[8] as bigint), lastUsedAt: row[9] === null ? null : Number(row[9] as bigint),
    });
}

/** The sign-in counter of an email: hashed, lower-cased. */
async function emailKey(email: string): Promise<string> {
    return `signin:e:${await sha256Hex(email.trim().toLowerCase())}`;
}

/** The second-factor counter of an account. */
function secondFactorKey(userId: string): string {
    return `signin:2fa:${userId.replace(/[^\x21-\x7e]/g, '-').slice(0, 100)}`;
}

/** The sign-in counter of a client address. */
function addressKey(address: string): string {
    return `signin:a:${(address || 'unknown').replace(/[^\x21-\x7e]/g, '-').slice(0, 100)}`;
}

function attemptKey(kind: string, key: string): string {
    return `attempt:${kind}:${key.replace(/[^\x21-\x7e]/g, '-').slice(0, 120)}`;
}
