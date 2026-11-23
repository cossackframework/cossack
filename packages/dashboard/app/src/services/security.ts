// Second factors and sign-in limits on the ORM: an authenticator app's secret, recovery
// codes, passkeys, the short-lived steps of pending sign-ins and passkey ceremonies, and the
// counters that limit guesses. Every check that guards a limit is one conditional write, so
// requests sent at once are each counted once.
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, verifyTotp } from '@cossackframework/auth';
import { ClientVisibleError } from '@cossackframework/core';
import { atomic, currentDialect, isWriteConflict, LessThanOrEqual, MoreThan, sql } from '@cossackframework/database';
import { AuthAttempt } from '@/models/AuthAttempt';
import { AuthChallenge } from '@/models/AuthChallenge';
import { Passkey } from '@/models/Passkey';
import { UserSecurity } from '@/models/UserSecurity';

export interface PasskeyInfo {
  id: string;
  name: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface StoredPasskey extends PasskeyInfo {
  userId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
}

export interface AccountSecurity {
  /** An authenticator app is set up and confirmed. */
  totp: boolean;
  /** Unused recovery codes. */
  recoveryCodes: number;
  passkeys: PasskeyInfo[];
}

export type ChallengeKind = 'signin' | 'passkey-register' | 'passkey-signin';

/** Wrong codes a pending sign-in allows. */
export const SIGN_IN_ATTEMPTS = 5;
/**
 * Second-factor codes counted per account for a window, across every pending sign-in: a right
 * password does not give them back, so knowing the password does not buy more guesses.
 */
export const SECOND_FACTOR_LOCK = Object.freeze({ windowMs: 15 * 60_000, perAccount: 10 });
/**
 * Password sign-ins are counted per email and per client address for a window. A right
 * password gives its attempt back. Past the limit the sign-in is refused until the window
 * ends, whether or not the account exists.
 */
export const SIGN_IN_LOCK = Object.freeze({ windowMs: 15 * 60_000, perEmail: 5, perAddress: 20 });
/** Password reset requests per email and per address in an hour; beyond them nothing is sent. */
export const RESET_REQUESTS = Object.freeze({ windowMs: 60 * 60_000, perEmail: 3, perAddress: 10 });

/**
 * The time this store reads. An application whose host has its own clock (the CMS, and tests
 * that move time) sets `clock.now`.
 */
export const clock = { now: (): number => Date.now() };

/** A secret for a link or a cookie: 256 random bits, URL-safe. */
export function randomToken(bytes = 32): string {
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...random)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The sign-in counter of an email: hashed, lower-cased. */
async function emailKey(email: string): Promise<string> {
  return `signin:e:${await sha256Hex(email.trim().toLowerCase())}`;
}

/** The sign-in counter of a client address. */
function addressKey(address: string): string {
  return `signin:a:${(address || 'unknown').replace(/[^\x21-\x7e]/g, '-').slice(0, 100)}`;
}

/** The second-factor counter of an account. */
function secondFactorKey(userId: string): string {
  return `signin:2fa:${userId.replace(/[^\x21-\x7e]/g, '-').slice(0, 100)}`;
}

function attemptKey(kind: string, key: string): string {
  return `attempt:${kind}:${key.replace(/[^\x21-\x7e]/g, '-').slice(0, 120)}`;
}

/**
 * One more attempt for the key, unless it already has `max` in its window: true when this one
 * was counted. An ended window starts again, then one conditional increment counts the
 * attempt, so attempts sent at once are each counted once and no more than `max` pass.
 */
async function count(key: string, windowMs: number, max: number): Promise<boolean> {
  const now = clock.now();
  const until = new Date(now + windowMs);
  // The row may exist already: then the insert does nothing and the increment decides.
  const insert = currentDialect() === 'mysql'
    ? sql.fragment`INSERT IGNORE INTO auth_attempts (id, attempts, expires_at) VALUES (${key}, 0, ${until})`
    : sql.fragment`INSERT INTO auth_attempts (id, attempts, expires_at) VALUES (${key}, 0, ${until}) ON CONFLICT (id) DO NOTHING`;
  try {
    const results = await atomic([
      sql.fragment`DELETE FROM auth_attempts WHERE id = ${key} AND expires_at <= ${new Date(now)}`,
      insert,
      sql.fragment`UPDATE auth_attempts SET attempts = attempts + 1 WHERE id = ${key} AND attempts < ${max}`,
    ]);
    return results[2]!.meta.rowsAffected === 1;
  } catch (error) {
    // A key under a burst of attempts can keep conflicting: refuse this attempt, as the limit
    // would, rather than fail the request.
    if (isWriteConflict(error)) return false;
    throw error;
  }
}

/**
 * A write that gives attempts back. Under a burst on the same key it can keep conflicting:
 * the attempt then stays counted (the limit errs shut), and the request goes on.
 */
async function bestEffort(write: () => Promise<unknown>): Promise<void> {
  try { await write(); }
  catch (error) {
    if (!isWriteConflict(error)) throw error;
    console.warn('[Cossack Auth] a sign-in attempt could not be given back: the key is busy');
  }
}

async function giveBack(key: string): Promise<void> {
  await bestEffort(async () => { await sql`UPDATE auth_attempts SET attempts = attempts - 1 WHERE id = ${key} AND attempts > 0`; });
}

/**
 * Start a password sign-in: one attempt is counted for the email and for the address before
 * the password is checked. Refused while either is at its limit for the window. A right
 * password gives the attempt back (`signInSucceeded`); a wrong one leaves it counted.
 */
export async function signInBegin(email: string, address: string): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const [emailId, addressId] = [await emailKey(email), addressKey(address)];
  const byEmail = await count(emailId, SIGN_IN_LOCK.windowMs, SIGN_IN_LOCK.perEmail);
  const byAddress = byEmail && await count(addressId, SIGN_IN_LOCK.windowMs, SIGN_IN_LOCK.perAddress);
  if (byEmail && byAddress) return { ok: true };
  // The email's attempt does not stand when the address refused it.
  if (byEmail) await giveBack(emailId);
  const row = await AuthAttempt.findOne({ where: { id: byEmail ? addressId : emailId } });
  return { ok: false, retryAfterMs: Math.max(1, (row?.expiresAt.getTime() ?? 0) - clock.now()) };
}

/** A right password: the email's failures are forgotten, and the address gets this attempt back. */
export async function signInSucceeded(email: string, address: string): Promise<void> {
  const key = await emailKey(email);
  await bestEffort(() => AuthAttempt.delete({ id: key }));
  await giveBack(addressKey(address));
}

/**
 * Count an attempt of `kind` (such as `reset`) for a key within a window; false past `max`.
 * A refused attempt keeps the gate shut until the window ends.
 */
export function attempt(kind: string, key: string, max: number, windowMs: number): Promise<boolean> {
  return count(attemptKey(kind, key), windowMs, max);
}

/** Give back an attempt `attempt()` counted, for one that did not go ahead after all. */
export function release(kind: string, key: string): Promise<void> {
  return giveBack(attemptKey(kind, key));
}

function passkeyOf(row: Passkey): StoredPasskey {
  return {
    id: row.id, userId: row.userId, name: row.name, publicKey: row.publicKey, counter: row.signCount,
    transports: row.transports, deviceType: row.deviceType, backedUp: row.backedUp,
    createdAt: row.createdAt.getTime(), lastUsedAt: row.lastUsedAt?.getTime() ?? null,
  };
}

export async function passkeys(userId: string): Promise<StoredPasskey[]> {
  return (await Passkey.find({ where: { userId }, order: { createdAt: 'asc' }, take: 50 })).map(passkeyOf);
}

export async function passkey(id: string): Promise<StoredPasskey | null> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(id)) return null;
  const row = await Passkey.findOne({ where: { id } });
  return row ? passkeyOf(row) : null;
}

export async function status(userId: string): Promise<AccountSecurity> {
  const [row, keys] = await Promise.all([UserSecurity.findOne({ where: { userId } }), passkeys(userId)]);
  const confirmed = Boolean(row?.totpConfirmedAt);
  return {
    totp: confirmed,
    recoveryCodes: confirmed ? (row?.recovery ?? []).length : 0,
    passkeys: keys.map(({ userId: _user, publicKey: _key, counter: _counter, transports: _transports, ...info }) => info),
  };
}

/** Whether the user has an authenticator app or a passkey. */
export async function hasSecondFactor(userId: string): Promise<boolean> {
  const current = await status(userId);
  return current.totp || current.passkeys.length > 0;
}

/** Whether a code from the authenticator app is required at sign-in (passkeys sign in on their own). */
export async function requiresCode(userId: string): Promise<boolean> {
  return Boolean((await UserSecurity.findOne({ where: { userId } }))?.totpConfirmedAt);
}

/**
 * A new, unconfirmed authenticator secret. It takes effect once confirmed with a code. A
 * confirmed authenticator stays as it is: replacing it means turning it off first, which asks
 * for one of its codes, so starting a setup never removes the factor in use.
 */
export async function startTotp(userId: string): Promise<string> {
  const secret = generateTotpSecret();
  const now = new Date(clock.now());
  const insert = currentDialect() === 'mysql'
    ? sql.fragment`INSERT IGNORE INTO user_security (user_id, totp_secret, updated_at) VALUES (${userId}, ${secret}, ${now})`
    : sql.fragment`INSERT INTO user_security (user_id, totp_secret, updated_at) VALUES (${userId}, ${secret}, ${now}) ON CONFLICT (user_id) DO NOTHING`;
  const results = await atomic([
    insert,
    sql.fragment`UPDATE user_security SET totp_secret = ${secret}, totp_last_step = NULL, updated_at = ${now}
      WHERE user_id = ${userId} AND totp_confirmed_at IS NULL`,
  ]);
  if (results[1]!.meta.rowsAffected !== 1) {
    throw new ClientVisibleError('An authenticator app is already on. Turn it off with one of its codes before setting up another.');
  }
  return secret;
}

/** The secret of a setup that is not confirmed yet, for showing the QR code again. */
export async function pendingSecret(userId: string): Promise<string | null> {
  const row = await UserSecurity.findOne({ where: { userId } });
  return row?.totpSecret && !row.totpConfirmedAt ? row.totpSecret : null;
}

/** Confirm the authenticator with a current code. Returns new recovery codes, shown once. */
export async function confirmTotp(userId: string, code: string): Promise<string[]> {
  const secret = await pendingSecret(userId);
  if (!secret) throw new ClientVisibleError('Start the authenticator setup again.');
  const step = await verifyTotp(secret, code, { now: clock.now() });
  if (step === null) throw new ClientVisibleError('That code is not right. Check the time on your device and try again.');
  const codes = generateRecoveryCodes();
  const now = new Date(clock.now());
  await UserSecurity.update({ userId, totpSecret: secret },
    { totpConfirmedAt: now, totpLastStep: step, recovery: await Promise.all(codes.map(hashRecoveryCode)), updatedAt: now });
  return codes;
}

/** New recovery codes, replacing the old ones. Needs a confirmed authenticator. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  if (!(await requiresCode(userId))) throw new ClientVisibleError('Set up an authenticator app first.');
  const codes = generateRecoveryCodes();
  await UserSecurity.update({ userId }, { recovery: await Promise.all(codes.map(hashRecoveryCode)), updatedAt: new Date(clock.now()) });
  return codes;
}

export async function disableTotp(userId: string): Promise<void> {
  await UserSecurity.delete({ userId });
}

/**
 * Check a second-factor code: the authenticator's current code (each step once) or an unused
 * recovery code, which is used up.
 */
export async function verifyCode(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
  const row = await UserSecurity.findOne({ where: { userId } });
  if (!row?.totpSecret || !row.totpConfirmedAt) return null;
  const step = await verifyTotp(row.totpSecret, code, { now: clock.now(), afterStep: row.totpLastStep });
  if (step !== null) {
    // The step is recorded only if no other sign-in used it first.
    const update = await sql`UPDATE user_security SET totp_last_step = ${step}
      WHERE user_id = ${userId} AND (totp_last_step IS NULL OR totp_last_step < ${step})`;
    return update.meta.rowsAffected === 1 ? 'totp' : null;
  }
  const hashes = row.recovery ?? [];
  const hash = await hashRecoveryCode(code);
  if (!hashes.includes(hash)) return null;
  // The code is used up only if the list is still the one that was read.
  const update = await sql`UPDATE user_security SET recovery = ${sql.json(hashes.filter(entry => entry !== hash))}, updated_at = ${new Date(clock.now())}
    WHERE user_id = ${userId} AND recovery = ${sql.json(hashes)}`;
  return update.meta.rowsAffected === 1 ? 'recovery' : null;
}

export async function addPasskey(
  userId: string,
  credential: { id: string; publicKey: string; counter: number; transports?: readonly string[]; deviceType?: string; backedUp?: boolean },
  name: string,
): Promise<void> {
  if ((await Passkey.count({ userId })) >= 20) throw new ClientVisibleError('A user can have at most 20 passkeys.');
  if (await Passkey.exists({ id: credential.id })) throw new ClientVisibleError('This passkey is already registered.');
  await Passkey.insert({
    id: credential.id, userId, name: name.trim().slice(0, 80) || 'Passkey', publicKey: credential.publicKey, signCount: credential.counter,
    transports: credential.transports ? [...credential.transports] : null, deviceType: credential.deviceType ?? null,
    backedUp: credential.backedUp === true, createdAt: new Date(clock.now()), lastUsedAt: null,
  });
}

export async function renamePasskey(userId: string, id: string, name: string): Promise<void> {
  await Passkey.update({ id, userId }, { name: name.trim().slice(0, 80) || 'Passkey' });
}

export async function removePasskey(userId: string, id: string): Promise<void> {
  // A missing ID must not widen the delete to every passkey of the user.
  if (typeof id !== 'string' || !id) return;
  await Passkey.delete({ id, userId });
}

/** Record a passkey sign-in. */
export async function usePasskey(id: string, counter: number): Promise<void> {
  await Passkey.update({ id }, { signCount: counter, lastUsedAt: new Date(clock.now()) });
}

/** Remove every second factor, for a user who lost their device. */
export async function reset(userId: string): Promise<void> {
  await UserSecurity.delete({ userId });
  await Passkey.delete({ userId });
}

/** A step kept for `ttlMs`; its random ID goes into a cookie or form. */
export async function createChallenge(kind: ChallengeKind, userId: string | null, challenge: string, ttlMs = 5 * 60_000): Promise<string> {
  const id = randomToken(24);
  await AuthChallenge.insert({ id, kind, userId, challenge, attempts: 0, expiresAt: new Date(clock.now() + ttlMs) });
  return id;
}

/** A live step of the kind, without using it up. */
export async function challenge(id: string, kind: ChallengeKind): Promise<{ userId: string | null; challenge: string; attempts: number } | null> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) return null;
  const row = await AuthChallenge.findOne({ where: { id, kind, expiresAt: MoreThan(new Date(clock.now())) } });
  return row ? { userId: row.userId, challenge: row.challenge, attempts: row.attempts } : null;
}

/** Use up a step: true only for the first caller while it is live. */
export async function takeChallenge(id: string, kind: ChallengeKind): Promise<boolean> {
  return (await AuthChallenge.delete({ id, kind, expiresAt: MoreThan(new Date(clock.now())) })).meta.rowsAffected === 1;
}

/**
 * Spend one try of a pending sign-in before its code is checked: counted on the step (a
 * conditional write, so codes sent at once each take a try and no more than `SIGN_IN_ATTEMPTS`
 * are checked) and on the account (`SECOND_FACTOR_LOCK`). `expired` when the step has no tries
 * left or ended, `locked` when the account has used its codes.
 */
export async function secondFactorAttempt(id: string, userId: string): Promise<{ left: number } | 'expired' | 'locked'> {
  const counted = await sql`UPDATE auth_challenges SET attempts = attempts + 1
    WHERE id = ${id} AND kind = ${'signin'} AND user_id = ${userId} AND attempts < ${SIGN_IN_ATTEMPTS} AND expires_at > ${new Date(clock.now())}`;
  if (counted.meta.rowsAffected !== 1) return 'expired';
  if (!(await count(secondFactorKey(userId), SECOND_FACTOR_LOCK.windowMs, SECOND_FACTOR_LOCK.perAccount))) {
    await AuthChallenge.delete({ id });
    return 'locked';
  }
  const live = await AuthChallenge.findOne({ where: { id } });
  return { left: live ? SIGN_IN_ATTEMPTS - live.attempts : 0 };
}

/**
 * Spend one of the account's code tries outside a sign-in (turning the authenticator off, new
 * recovery codes): the same per-account count as at sign-in, so codes cannot be guessed
 * faster on the security page. False when the account is locked.
 */
export function codeAttempt(userId: string): Promise<boolean> {
  return count(secondFactorKey(userId), SECOND_FACTOR_LOCK.windowMs, SECOND_FACTOR_LOCK.perAccount);
}

/** A wrong code: the step ends once it has no tries left. */
export async function failChallenge(id: string): Promise<void> {
  await sql`DELETE FROM auth_challenges WHERE id = ${id} AND attempts >= ${SIGN_IN_ATTEMPTS}`;
}

/** A right code: the account's second-factor count starts again. */
export async function secondFactorSucceeded(userId: string): Promise<void> {
  await AuthAttempt.delete({ id: secondFactorKey(userId) });
}

/** Remove pending steps whose time ended, which nothing else would. Call it from a schedule. */
export async function purgeExpired(): Promise<void> {
  await AuthChallenge.delete({ expiresAt: LessThanOrEqual(new Date(clock.now())) });
}

/** Remove attempt counts whose window ended. Call it from a schedule. */
export async function purgeAttempts(): Promise<void> {
  await AuthAttempt.delete({ expiresAt: LessThanOrEqual(new Date(clock.now())) });
}
