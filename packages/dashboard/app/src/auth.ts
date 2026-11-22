// src/auth.ts
//
// Application account/storage composition. The auth library owns password
// hashing, credential verification, session expiry, rotation and cookies.
// Password reset delivery, user models and role lookup remain application-owned.
//
// All data access uses Active Record models scoped by the ORM middleware.
// Runtime bindings (the send_email
// binding, env vars) are read via the global `binding()` / `env()` helpers,
// so credential and reset helpers need no Hono `Context`. Session operations
// receive the context for request metadata and cookie handling.

import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createAuth, createCredentialVerifier, createOAuth, createSessionManager, hashPassword, OAuthError, totpUri, type AuthSessionRecord, type OAuthKit, type OAuthStateStore, type OAuthUser, type TokenSet } from '@cossackframework/auth';
import {
  passkeyAuthenticationOptions, passkeyRegistrationOptions, verifyPasskeyAuthentication, verifyPasskeyRegistration,
  type AuthenticationResponseJSON, type PasskeyConfig, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON,
} from '@cossackframework/auth/passkeys';
export { hashPassword, verifyPassword } from '@cossackframework/auth';
import { In, MoreThan, sql } from '@cossackframework/database';
import { ClientVisibleError, getClientIp, getRequestContext } from '@cossackframework/core';
import { renderSVG } from 'uqr';
import { uuidv7 } from './lib/uuid';
import { authOptions } from './auth-options';
import { ALL_PERMISSIONS } from './lib/permissions';
import { siteName } from './brand';
import * as security from './services/security';
import * as apiTokens from './services/api-tokens';
import type { ApiToken } from './services/api-tokens';
// The models are the project's: its schema, its migrations.
import { User, type RoleAssignment } from '@/models/User';
import { Role } from '@/models/Role';
import { UserRole } from '@/models/UserRole';
import { Session } from '@/models/Session';
import { OAuthAccount } from '@/models/OAuthAccount';

const SESSION_COOKIE = 'session_id';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Purpose tags separate auth sessions, password-reset tokens and the OAuth
// recipe's anonymous state records. Session listings show only auth rows.
type SessionMeta = { type: 'auth' } | { type: 'password_reset' } | { type: 'verify' } | { type: 'magic' } | { type: 'oauth_state'; provider: string };

const warnedSessionErrors = new Set<string>();

/**
 * Session lookup must never make a public request fail just because the
 * database binding or auth migrations are not ready yet. The auth middleware
 * treats the request as a guest and warns once per isolate for each distinct
 * kind of error, naming its type and code, so a query bug is not mistaken for
 * a missing database.
 */
function warnAboutSessionDatabase(error: unknown): void {
  // The message can hold connection details or secrets, so only the error's
  // type and code are printed.
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  const kind = typeof code === 'string' || typeof code === 'number' ? `${name} ${code}` : name;
  if (warnedSessionErrors.has(kind)) return;
  warnedSessionErrors.add(kind);
  console.warn(
    `[Cossack Auth] Session lookup failed with ${kind}; continuing as guest.\n` +
    'If the database is not set up, configure the DB binding and run `pnpm migrate` before using auth.',
  );
}

// --- Types -----------------------------------------------------------------
/** The safe user shape exposed to pages (`this.user`) — no password_hash. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  meta: Record<string, unknown> | null;
  roles: RoleAssignment[];
  /** Set by `registerUser` when the account waits for the email's confirmation link instead of signing in. */
  verification?: 'sent';
  /** The account waits for an administrator's approval before it can sign in. */
  approval?: 'pending';
}

function publicUser(u: User, roles: RoleAssignment[] = []): PublicUser {
  return { id: u.id, email: u.email, name: u.name ?? '', avatar: u.avatar, meta: u.meta, roles };
}

// --- Roles -----------------------------------------------------------------
// Reads a user's assigned roles (with parsed permissions) by joining
// user_roles -> roles. Used by resolveUserById so c.get('user').roles is
// available to the authorizer (src/services/rbac.ts) and the dashboard nav.
async function loadUserRoles(userId: string): Promise<RoleAssignment[]> {
  const rows = (await sql<{ id: string; name: string; permissions: string | null }>`
    SELECT roles.id, roles.name, roles.permissions
    FROM user_roles
    INNER JOIN roles ON roles.id = user_roles.role_id
    WHERE user_roles.user_id = ${userId}
  `).rows;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: parsePermissions(r.permissions),
  }));
}

function parsePermissions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

// --- Session create / validate / resolve ----------------------------------
// Captures the request's origin metadata (IP, User-Agent, geo) for session
// tracking. location uses Cloudflare request.cf (country/city); off-CF it's null.
function captureRequestInfo(c: Context): { ip: string | null; userAgent: string | null; location: string | null } {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || null;
  const userAgent = c.req.header('user-agent') || null;
  const cf = (c.req.raw as Request & { cf?: { country?: string; city?: string } }).cf;
  const location = cf?.country ? [cf.city, cf.country].filter(Boolean).join(', ') : null;
  return { ip, userAgent, location };
}

function authSession(row: Session | null): AuthSessionRecord | null {
  if (!row || !row.userId || parseMeta(row.meta)?.type !== 'auth') return null;
  return { id: row.id, userId: row.userId, kind: 'auth',
    createdAt: row.createdAt.getTime(), expiresAt: row.expiresAt.getTime() };
}

export const authSessions = createSessionManager({
  ttlSeconds: SESSION_TTL_SECONDS,
  cookie: { name: SESSION_COOKIE },
  store: {
    async create(record, c) {
      const { ip, userAgent, location } = captureRequestInfo(c);
      await Session.insert({ id: record.id, publicId: crypto.randomUUID(), userId: record.userId, data: null,
        createdAt: new Date(record.createdAt), expiresAt: new Date(record.expiresAt),
        meta: { type: 'auth' }, ipAddress: ip, userAgent, location,
        // Set by createSession() for the session it is about to store.
        secondFactor: c.get('auth.signInSecondFactor') === true });
    },
    async read(id) { return authSession(await Session.findOne({ where: { id } })); },
    async replace(expected, replacement, now) {
      // One SQL statement owns rotation. Match the complete prior record and
      // auth purpose so concurrent rotation or revocation can have only one winner.
      // Pass Date values: the sql tag encodes them in the column's stored format.
      const result = await sql`
        UPDATE sessions SET id = ${replacement.id},
          created_at = ${new Date(replacement.createdAt)},
          expires_at = ${new Date(replacement.expiresAt)}
        WHERE id = ${expected.id} AND user_id = ${expected.userId}
          AND created_at = ${new Date(expected.createdAt)}
          AND expires_at = ${new Date(expected.expiresAt)}
          AND expires_at > ${new Date(Math.max(now, Date.now()))}
          AND meta = ${JSON.stringify({ type: 'auth' })}
      `;
      return result.meta.rowsAffected === 1;
    },
    async revoke(id) {
      await sql`DELETE FROM sessions WHERE id = ${id} AND meta = ${JSON.stringify({ type: 'auth' })}`;
    },
  },
});

export const auth = createAuth<PublicUser>({
  realtime: {
    key: 'cossack.session',
    async capture(sessionId, userId) {
      const stored = await Session.findOne({ where: { id: sessionId } });
      const row = stored ? await sessionWithReference(stored, userId) : null;
      if (!row) throw new Error('Session ended before subscription.');
      return { reference: row.publicId, fingerprint: await sessionFingerprint(sessionId) };
    },
    async validate(data, c) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const { reference, fingerprint } = data as { reference?: unknown; fingerprint?: unknown };
      if (typeof reference !== 'string' || !PUBLIC_SESSION_REFERENCE.test(reference) ||
          typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) return null;
      const row = await Session.findOne({ where: { publicId: reference } });
      const active = row ? await authSessions.validate(row.id, c) : null;
      if (!active || await sessionFingerprint(active.id) !== fingerprint) return null;
      return active.userId;
    },
  },
  extractSessionId: (c) => getCookie(c, SESSION_COOKIE),
  validateSessionId: async (sessionId, c) => {
    try {
      const session = await authSessions.validate(sessionId, c);
      // Read only while two-step sign-in is required: whether this session used a second factor.
      if (session && authOptions.security.requireTwoFactor) {
        c.set('auth.sessionSecondFactor', (await Session.findOne({ where: { id: session.id } }))?.secondFactor === true);
      }
      return session?.userId ?? null;
    } catch (error) {
      warnAboutSessionDatabase(error);
      return null;
    }
  },
  resolveUserById: async (userId) => {
    try {
      const row = await User.findOne({ where: { id: userId } });
      // An account that was turned off, or waits again, is a guest even with a live session.
      if (!row || row.status !== 'active') return null;
      const roles = await loadUserRoles(userId);
      return publicUser(row, roles);
    } catch (error) {
      warnAboutSessionDatabase(error);
      return null;
    }
  },
  createSession: async (user, c) => {
    const full = await User.findOne({ where: { id: user.id } });
    if (!full) throw new Error('User not found');
    return authSessions.create(full.id, c);
  },
});

async function sessionFingerprint(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// --- Credential helpers (used by the page @Server methods) -----------------
const credentials = createCredentialVerifier<User, PublicUser>({
  find: email => User.findOne({ where: { email } }),
  passwordHash: user => user.passwordHash,
  user: async user => publicUser(user, await loadUserRoles(user.id)),
  async replacePasswordHash(user, expected, replacement) {
    const result = await User.update({ id: user.id, passwordHash: expected }, { passwordHash: replacement });
    return result.meta.rowsAffected === 1;
  },
});

/**
 * Sign in with email and password. The attempt is counted for the email and for the client's
 * address before the password is checked, so guesses sent at once meet the limit too.
 */
export async function loginUser(email: string, password: string, address = clientAddress()): Promise<PublicUser | null> {
  const allowed = await security.signInBegin(email, address);
  if (!allowed.ok) throw new SignInLockedError(allowed.retryAfterMs);
  const user = await credentials.verify(email, password);
  if (!user) return null;
  await security.signInSucceeded(email, address);
  // Only an active account signs in. One that waits for approval hears so, once its password is right.
  const status = (await User.findOne({ where: { id: user.id } }))?.status;
  if (status === 'pending') throw new SignInPendingError();
  return status === 'active' ? user : null;
}

/** The password matched an account that waits for an administrator's approval. */
export class SignInPendingError extends ClientVisibleError {
  constructor() {
    super('Your account waits for an administrator to approve it. We will email you when it is ready.');
    this.name = 'SignInPendingError';
  }
}

/** Too many wrong passwords for the email or from the address: the sign-in is refused for a while. */
export class SignInLockedError extends ClientVisibleError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Too many sign-in attempts. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} minutes.`);
    this.name = 'SignInLockedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Two-step sign-in is required and the account's only second factor is a passkey: a password
 * alone is one step, so the account signs in with its passkey.
 */
export class SignInPasskeyError extends ClientVisibleError {
  constructor() {
    super('Two-step sign-in is required, and this account\'s second step is its passkey. Sign in with your passkey.');
    this.name = 'SignInPasskeyError';
  }
}

/** The client's address for sign-in and reset counters: the proxy header the deployment trusts, else the socket's. */
function clientAddress(): string {
  const c = getRequestContext();
  return c ? getClientIp(c) : 'unknown';
}

/** Wrong current passwords an account may give within the window before checks stop. */
const PASSWORD_CHECKS = { max: 10, windowMs: 15 * 60_000 };

/**
 * Whether this is the user's current password, before they change it. Wrong answers are
 * counted per account, so an open session cannot guess its way to the password.
 */
export async function passwordMatches(userId: string, password: string): Promise<boolean> {
  if (!(await security.attempt('password-check', userId, PASSWORD_CHECKS.max, PASSWORD_CHECKS.windowMs))) {
    throw new ClientVisibleError('Too many wrong passwords. Wait a few minutes, then try again.');
  }
  const row = await User.findOne({ where: { id: userId } });
  const matches = !!row && (await credentials.verify(row.email, password))?.id === userId;
  // Only wrong passwords count against the account.
  if (matches) await security.release('password-check', userId);
  return matches;
}

/** Whether visitors may create accounts on /auth/register (src/dashboard.config.ts: `registration.open`). */
export async function registrationOpen(): Promise<boolean> {
  return authOptions.registration.open;
}

/**
 * Whether the first account still has to be created on /auth/setup: SETUP_CODE is set and no
 * account exists. /auth/login sends visitors there then. Without SETUP_CODE the first account
 * comes from the seeder.
 */
export async function setupRequired(): Promise<boolean> {
  if (!env('SETUP_CODE', '')) return false;
  try { return (await User.count()) === 0; }
  catch { return false; }
}

/** Compare digests, so the time taken does not depend on how much of the code matches. */
async function sameSecret(candidate: string, expected: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(candidate), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

/**
 * First run: create the `admin` role with every permission and the first account, which holds
 * it. Needs SETUP_CODE, so a visitor cannot claim a fresh deployment, and works only while no
 * account exists.
 */
export async function completeSetup(code: string, account: { email: string; password: string; name?: string }): Promise<PublicUser> {
  // Wrong codes are counted per address: the code is the only thing between a visitor and the site.
  if (!(await security.attempt('setup', clientAddress(), 5, 60_000))) throw new ClientVisibleError('Too many attempts. Wait a minute, then try again.');
  const expected = env('SETUP_CODE', '');
  if (!expected || !(await sameSecret(code, expected))) throw new ClientVisibleError('The setup code is not right.');
  if (!(await setupRequired())) throw new ClientVisibleError('This site is already set up.');
  const now = new Date();
  let role = await Role.findOne({ where: { name: 'admin' } });
  if (!role) {
    const id = uuidv7();
    await Role.insert({ id, name: 'admin', permissions: [...ALL_PERMISSIONS], createdAt: now });
    role = await Role.findOne({ where: { id } });
  }
  if (!role) throw new Error('Unable to create the admin role.');
  const id = uuidv7();
  const email = account.email.trim().toLowerCase();
  await User.insert({ id, email, name: account.name?.trim() || null, passwordHash: await hashPassword(account.password), avatar: null, meta: null, status: 'active', createdAt: now });
  await UserRole.insert({ userId: id, roleId: role.id, createdAt: now });
  return (await userById(id))!;
}

/**
 * Where links in emails point: the site's own address (APP_URL), never the request's Host
 * header, which a client chooses. Without APP_URL, a request to this machine (development)
 * uses its own origin; otherwise null, and no link is sent.
 */
export function linkOrigin(): string | null {
  const configured = env('APP_URL', '').replace(/\/+$/, '');
  if (configured) return configured;
  const c = getRequestContext();
  if (!c) return null;
  const url = new URL(c.req.url);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? url.origin : null;
}

interface Mail { to: string; subject: string; text: string }

/** The email sender: the `EMAIL` binding (send_email on Workers). Null when none is configured. */
function mailer(): { send(mail: Mail): Promise<void> } | null {
  const sender = binding<{ send: (message: unknown) => Promise<unknown> }>('EMAIL');
  if (!sender) return null;
  const from = env('MAIL_FROM', 'no-reply@example.com');
  return { async send(mail) { await sender.send({ ...mail, from, html: `<p>${escapeHtml(mail.text).replace(/\n/g, '<br>')}</p>` }); } };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

// A link's token is kept as its hash, in the sessions table like reset tokens, with its own purpose.
type LinkKind = 'verify' | 'magic';
const LINK_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
/** How long a confirmation link lives. */
const VERIFICATION_TTL_MS = 48 * 60 * 60_000;
/** How long a sign-in link lives. */
const MAGIC_LINK_TTL_MS = 15 * 60_000;

async function linkId(kind: LinkKind, token: string): Promise<string> {
  return `${kind}:${await security.sha256Hex(token)}`;
}

async function createLink(kind: LinkKind, userId: string, ttlMs: number): Promise<string> {
  const token = security.randomToken(32);
  const now = new Date();
  await Session.insert({ id: await linkId(kind, token), userId, data: null, createdAt: now, expiresAt: new Date(now.getTime() + ttlMs),
    meta: { type: kind }, location: null, userAgent: null, ipAddress: null });
  return token;
}

async function liveLink(kind: LinkKind, token: string): Promise<Session | null> {
  if (!LINK_TOKEN.test(token)) return null;
  const row = await Session.findOne({ where: { id: await linkId(kind, token), expiresAt: MoreThan(new Date()) } });
  return row && parseMeta(row.meta)?.type === kind ? row : null;
}

/** Spend a link: the account's ID for the first request while it is live, null otherwise. */
async function takeLink(kind: LinkKind, token: string): Promise<string | null> {
  const row = await liveLink(kind, token);
  if (!row?.userId) return null;
  // One conditional delete, so two requests with the same link cannot both use it.
  const deleted = await Session.delete({ id: row.id, expiresAt: MoreThan(new Date()) });
  return deleted.meta.rowsAffected === 1 ? row.userId : null;
}

/**
 * The email of the account a sign-in or confirmation link is for, read without spending the
 * link: its page shows it, so someone opening a link another person sent sees whose account
 * it would sign them into. Null for a link that is not valid.
 */
export async function linkAccountEmail(kind: LinkKind, token: string): Promise<string | null> {
  const row = await liveLink(kind, token);
  if (!row?.userId) return null;
  return (await User.findOne({ where: { id: row.userId } }))?.email ?? null;
}

async function sendVerification(user: { id: string; email: string; name: string | null }): Promise<void> {
  const [mail, origin] = [mailer(), linkOrigin()];
  if (!mail || !origin) return;
  const token = await createLink('verify', user.id, VERIFICATION_TTL_MS);
  const title = await siteName().catch(() => '');
  await mail.send({ to: user.email, subject: `Confirm your email for ${title || 'the site'}`,
    text: `Hello ${user.name || user.email},\n\nConfirm your email address to finish creating your account on ${title || origin}:\n${origin}/auth/verify?token=${token}\n\nThe link works for two days. If you did not register, ignore this email.` });
}

/**
 * A new account, with the project's default role (src/dashboard.config.ts: `registration`).
 * The project may ask for the email's confirmation and for an administrator's approval, in
 * that order: the account then waits, and the result says which.
 */
export async function registerUser(email: string, password: string, name?: string): Promise<PublicUser> {
  const options = authOptions.registration;
  if (!options.open) throw new ClientVisibleError('Registration is closed on this site.');
  // With a sender and the project asking for it, the account waits for the email's link.
  const verify = options.verifyEmail && mailer() !== null;
  // Without the site's address no link can be sent: the account is not created active instead.
  if (verify && !linkOrigin()) {
    console.warn('[Cossack Auth] registration refused: email confirmation is on, but APP_URL is not set, so no confirmation link can be sent');
    throw new ClientVisibleError('Registration is not available right now. Ask the site\'s administrator.');
  }
  // An account that never confirmed this email gives way to a new registration, so a missed
  // link, or someone registering another person's address, never locks the address.
  const existing = await User.findOne({ where: { email } });
  if (existing?.status === 'unconfirmed') await removeAccount(existing.id);
  else if (existing) throw new ClientVisibleError('An account with this email already exists.');
  const id = uuidv7();
  const status = verify ? 'unconfirmed' : options.approve ? 'pending' : 'active';
  await User.insert({ id, email, name: name ?? null, passwordHash: await hashPassword(password), avatar: null, meta: null, status, createdAt: new Date() });
  const role = options.defaultRole ? await Role.findOne({ where: { name: options.defaultRole } }) : null;
  if (role) await UserRole.insert({ userId: id, roleId: role.id, createdAt: new Date() });
  const user: PublicUser = { id, email, name: name ?? '', avatar: null, meta: null, roles: role ? [{ id: role.id, name: role.name, permissions: role.permissions ?? [] }] : [] };
  if (verify) {
    await sendVerification({ id, email, name: name ?? null });
    return { ...user, verification: 'sent' };
  }
  return options.approve ? { ...user, approval: 'pending' } : user;
}

/** Remove an account with what belongs to it: sessions and links, roles, second factors. */
async function removeAccount(userId: string): Promise<void> {
  await Session.delete({ userId });
  await apiTokens.revokeAll(userId);
  await sql`DELETE FROM user_roles WHERE user_id = ${userId}`;
  await security.reset(userId);
  await User.delete({ id: userId });
}

/**
 * Open a confirmation link: the token is spent, and the account becomes active, or waits for
 * an administrator's approval (`pending`). Null for an unknown, spent or expired link.
 */
export async function verifyEmail(token: string): Promise<{ user: string; pending: boolean } | null> {
  const userId = await takeLink('verify', token);
  if (!userId) return null;
  const pending = authOptions.registration.approve;
  // Only an account still waiting for this link changes: one an administrator disabled since stays as it is.
  const updated = await User.update({ id: userId, status: 'unconfirmed' }, { status: pending ? 'pending' : 'active' });
  return updated.meta.rowsAffected === 1 ? { user: userId, pending } : null;
}

/** Whether new accounts wait for an administrator's approval. */
export async function registrationApproval(): Promise<boolean> {
  return authOptions.registration.approve;
}

export interface Registration { id: string; name: string; email: string; verified: boolean; createdAt: number }

/** The accounts that wait: for approval (`verified`), or still for their email's confirmation. */
export async function registrations(): Promise<Registration[]> {
  const rows = await User.find({ where: { status: In(['pending', 'unconfirmed']) }, order: { createdAt: 'asc' }, take: 200 });
  return rows.map(row => ({ id: row.id, name: row.name ?? '', email: row.email, verified: row.status === 'pending', createdAt: row.createdAt.getTime() }));
}

/**
 * Approve an account that waits for it: it becomes active and gets an email saying so. False
 * when it was not waiting for approval.
 */
export async function approveRegistration(userId: string): Promise<boolean> {
  const updated = await User.update({ id: userId, status: 'pending' }, { status: 'active' });
  if (updated.meta.rowsAffected !== 1) return false;
  const [user, mail, origin] = [await User.findOne({ where: { id: userId } }), mailer(), linkOrigin()];
  if (user && mail) {
    const title = await siteName().catch(() => '');
    const where = origin ? ` Sign in at:\n${origin}/auth/login\n` : '\n';
    await mail.send({ to: user.email, subject: `Your account on ${title || 'the site'} is ready`,
      text: `Hello ${user.name || user.email},\n\nAn administrator approved your account.${where}` }).catch(() => undefined);
  }
  return true;
}

/** Delete an account that waits for approval or confirmation. False when it does not wait. */
export async function deleteRegistration(userId: string): Promise<boolean> {
  const user = await User.findOne({ where: { id: userId } });
  if (!user || (user.status !== 'pending' && user.status !== 'unconfirmed')) return false;
  await removeAccount(userId);
  return true;
}

// --- Profile updates -------------------------------------------------------
/**
 * Whether profile pictures can be uploaded. Without file storage, users enter an image URL;
 * configure a storage provider and implement uploadAvatar to accept uploads.
 */
export const avatarUploads = false;

export async function uploadAvatar(_userId: string, _file: File): Promise<string> {
  throw new ClientVisibleError('Picture uploads need file storage. Enter an image URL instead.');
}

export interface ProfileUpdate {
  name?: string;
  avatar?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Update editable profile fields. */
export async function updateUserProfile(userId: string, patch: ProfileUpdate): Promise<void> {
  const values: Partial<User> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.avatar !== undefined) values.avatar = patch.avatar;
  if (patch.meta !== undefined) values.meta = patch.meta;
  if (Object.keys(values).length === 0) return;
  await User.update({ id: userId }, values);
}

// --- Password reset (uses the sessions table for tokens) -------------------
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await User.findOne({ where: { email } });
  if (!user) return null; // do NOT leak whether the email exists
  // A secret: 256 random bits, never a UUIDv7, whose time part is readable and leaves 74 random bits.
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  const meta: SessionMeta = { type: 'password_reset' };
  await Session.insert({
    id: token,
    userId: user.id,
    data: null,
    expiresAt,
    createdAt: now,
    meta,
    location: null,
    userAgent: null,
    ipAddress: null,
  });
  return token;
}

async function consumePasswordResetToken(token: string): Promise<string | null> {
  const row = await Session.findOne({
    where: { id: token, expiresAt: MoreThan(new Date()) },
  });
  if (!row || parseMeta(row.meta)?.type !== 'password_reset') return null;
  const deleted = await Session.delete({ id: token, expiresAt: MoreThan(new Date()) });
  return deleted.meta.rowsAffected === 1 ? row.userId : null;
}
// --- Second factors ----------------------------------------------------------
/** This store keeps authenticator apps, recovery codes and passkeys (src/services/security.ts). */
export const twoFactorAvailable = true;
/** Cookie holding a pending sign-in between the password and the second factor. */
export const TWO_FACTOR_COOKIE = 'two_factor';

export type SecurityStatus = security.AccountSecurity & {
  /** Set when another host keeps the account's passkeys: the page lists them and links there instead of adding or removing them. */
  passkeysManagedAt?: { name: string; href: string | null } | null;
};

export type { ApiToken };

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by createSession() for the session it is about to store. */
    'auth.signInSecondFactor': boolean;
    /** Whether the request's session was signed in with a second factor. */
    'auth.sessionSecondFactor': boolean;
  }
}

/**
 * Start a session for a sign-in. `secondFactor` says whether it used one (an authenticator
 * or recovery code, or a passkey). Required two-step sign-in asks that of the session: one
 * signed in with a password alone stays limited even after its account gains a factor.
 */
export async function createSession(userId: string, c: Context, options: { secondFactor?: boolean } = {}) {
  c.set('auth.signInSecondFactor', options.secondFactor === true);
  try { return await authSessions.create(userId, c); }
  finally { c.set('auth.signInSecondFactor', false); }
}

async function userById(userId: string): Promise<PublicUser | null> {
  const row = await User.findOne({ where: { id: userId } });
  return row?.status === 'active' ? publicUser(row, await loadUserRoles(userId)) : null;
}

/**
 * Whether the project asks this user for two-step sign-in (src/dashboard.config.ts:
 * `security.requireTwoFactor`), for everyone or for the roles `security.twoFactorRoles` names.
 */
function twoFactorAsked(user: Pick<PublicUser, 'roles'>): boolean {
  const { requireTwoFactor, twoFactorRoles } = authOptions.security;
  if (!requireTwoFactor) return false;
  return twoFactorRoles.length === 0 || user.roles.some(role => twoFactorRoles.includes(role.name));
}

/**
 * After a correct password: null when the user signs in at once, or the ID of a pending
 * sign-in (5 minutes, 5 tries) that /auth/two-factor completes with a code. When two-step
 * sign-in is required and the account's second factor is a passkey, having enrolled one is
 * not having used it: throws SignInPasskeyError.
 */
export async function beginTwoFactor(userId: string): Promise<string | null> {
  if (await security.requiresCode(userId)) return security.createChallenge('signin', userId, 'password');
  const user = await userById(userId);
  if (user && twoFactorAsked(user) && await security.hasSecondFactor(userId)) throw new SignInPasskeyError();
  return null;
}

/**
 * Finish a pending sign-in with an authenticator or recovery code. A try is spent before the
 * code is checked, on the pending sign-in and on the account, so codes sent at once count too.
 */
export async function completeTwoFactor(challengeId: string, code: string): Promise<{ user: PublicUser; recovery: boolean } | { error: string; expired: boolean }> {
  const expired = { error: 'The sign-in expired. Enter your password again.', expired: true };
  const pending = await security.challenge(challengeId, 'signin');
  if (!pending?.userId) return expired;
  const attempt = await security.secondFactorAttempt(challengeId, pending.userId);
  if (attempt === 'expired') return expired;
  if (attempt === 'locked') return { error: 'Too many wrong codes for this account. Try again in 15 minutes.', expired: true };
  const used = await security.verifyCode(pending.userId, code);
  if (!used) {
    await security.failChallenge(challengeId);
    const { left } = attempt;
    return left > 0
      ? { error: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, expired: false }
      : { error: 'Too many wrong codes. Enter your password again.', expired: true };
  }
  if (!(await security.takeChallenge(challengeId, 'signin'))) return expired;
  await security.secondFactorSucceeded(pending.userId);
  const user = await userById(pending.userId);
  if (!user) return { error: 'This account cannot sign in.', expired: true };
  return { user, recovery: used === 'recovery' };
}

export async function securityStatus(userId: string): Promise<SecurityStatus> {
  return security.status(userId);
}

/**
 * Whether the request's session may not act as the user yet: two-step sign-in is required of
 * them, and the session was signed in without a second factor. That covers a user with no
 * factor (they set one up) and a session signed in with a password alone (it signs in again
 * with the factor), so a factor added later does not trust a session that never used it.
 */
export async function secondFactorRequired(user: PublicUser, c: Context | undefined = getRequestContext()): Promise<boolean> {
  if (!twoFactorAsked(user)) return false;
  return c?.get('auth.sessionSecondFactor') !== true;
}

/**
 * Before a factor is added: a session limited by required two-step sign-in may add the
 * account's first one (that is the setup), but not one beside a factor it never used, which
 * would let a password alone take the account's two-step sign-in.
 */
async function requireFactorSetupAllowed(userId: string): Promise<void> {
  const c = getRequestContext();
  const user = c?.get('user') as PublicUser | undefined;
  if (!user || user.id !== userId || c?.get('auth.sessionSecondFactor') === true) return;
  if (!twoFactorAsked(user)) return;
  if (await security.hasSecondFactor(userId)) {
    throw new ClientVisibleError('This account already has two-step sign-in. Sign out, then sign in again with it.');
  }
}

/**
 * After the user added a factor in this session: the session counts as using it when it was
 * the account's first. Other sessions keep what their own sign-in used.
 */
async function factorAdded(userId: string, hadFactor: boolean): Promise<void> {
  const c = getRequestContext();
  const id = c ? getCookie(c, SESSION_COOKIE) : undefined;
  const user = c?.get('user') as PublicUser | undefined;
  if (!c || !id || user?.id !== userId) return;
  // Only the account's first factor counts for the session that set it up.
  if (hadFactor && c.get('auth.sessionSecondFactor') !== true) return;
  await Session.update({ id, userId }, { secondFactor: true });
  c.set('auth.sessionSecondFactor', true);
}

/**
 * Before a factor is removed or replaced: a session limited by required two-step sign-in never
 * used the account's factors, so it may not take them away. It signs in again with a factor first.
 */
function requireFactorUsed(userId: string): void {
  const c = getRequestContext();
  const user = c?.get('user') as PublicUser | undefined;
  if (!user || user.id !== userId || c?.get('auth.sessionSecondFactor') === true) return;
  if (!twoFactorAsked(user)) return;
  throw new ClientVisibleError('Sign out, then sign in again with two-step sign-in to change it.');
}

/** Check an authenticator or recovery code, counted against the account's tries as at sign-in. */
async function checkAccountCode(userId: string, code: string): Promise<void> {
  if (!(await security.codeAttempt(userId))) throw new ClientVisibleError('Too many wrong codes for this account. Try again in 15 minutes.');
  if (!(await security.verifyCode(userId, code))) throw new ClientVisibleError('That code is not right.');
  await security.secondFactorSucceeded(userId);
}

/** A new authenticator secret, its `otpauth://` URI and a QR code of it as SVG. */
export async function startAuthenticator(user: PublicUser): Promise<{ secret: string; uri: string; qr: string }> {
  await requireFactorSetupAllowed(user.id);
  const secret = await security.startTotp(user.id);
  const uri = totpUri({ secret, issuer: await siteName().catch(() => 'Cossack'), account: user.email });
  return { secret, uri, qr: renderSVG(uri, { border: 1 }) };
}

/** Confirm the authenticator with a code from it; returns the recovery codes, shown once. */
export async function confirmAuthenticator(userId: string, code: string): Promise<string[]> {
  await requireFactorSetupAllowed(userId);
  const hadFactor = await security.hasSecondFactor(userId);
  const codes = await security.confirmTotp(userId, code);
  await factorAdded(userId, hadFactor);
  return codes;
}

/** Turning the authenticator off needs one of its codes, or a recovery code. */
export async function disableAuthenticator(userId: string, code: string): Promise<void> {
  requireFactorUsed(userId);
  await checkAccountCode(userId, code);
  await security.disableTotp(userId);
}

export async function newRecoveryCodes(userId: string, code: string): Promise<string[]> {
  requireFactorUsed(userId);
  await checkAccountCode(userId, code);
  return security.regenerateRecoveryCodes(userId);
}

/** Remove a user's second factors, for a user manager helping someone who lost their device. The page checks who may. */
export async function resetSecondFactors(userId: string): Promise<void> {
  await security.reset(userId);
}

/** The site's relying party for passkeys: this host, and the origins the browser may report. */
async function passkeySite(c: Context): Promise<PasskeyConfig> {
  const url = new URL(c.req.url);
  const origins = new Set([url.origin]);
  if (c.req.header('x-forwarded-proto') === 'https') origins.add(`https://${url.host}`);
  const configured = env('APP_URL', '');
  if (configured) { try { origins.add(new URL(configured).origin); } catch { /* not a URL */ } }
  return { rpName: await siteName().catch(() => 'Cossack'), rpID: url.hostname, origin: [...origins] };
}

export async function passkeyRegistration(c: Context, user: PublicUser): Promise<{ challenge: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  await requireFactorSetupAllowed(user.id);
  const existing = await security.passkeys(user.id);
  const options = await passkeyRegistrationOptions(await passkeySite(c), { id: user.id, name: user.email, displayName: user.name },
    existing.map(passkey => ({ ...passkey, transports: passkey.transports ?? undefined })));
  return { challenge: await security.createChallenge('passkey-register', user.id, options.challenge), options };
}

export async function addPasskey(c: Context, user: PublicUser, challengeId: string, response: RegistrationResponseJSON, name: string): Promise<void> {
  const pending = await security.challenge(challengeId, 'passkey-register');
  if (!pending || pending.userId !== user.id || !(await security.takeChallenge(challengeId, 'passkey-register'))) {
    throw new ClientVisibleError('The passkey request expired. Try again.');
  }
  const passkey = await verifyPasskeyRegistration(await passkeySite(c), response, pending.challenge);
  if (!passkey) throw new ClientVisibleError('The passkey could not be verified.');
  await requireFactorSetupAllowed(user.id);
  const hadFactor = await security.hasSecondFactor(user.id);
  await security.addPasskey(user.id, passkey, name);
  await factorAdded(user.id, hadFactor);
}

export async function removePasskey(userId: string, id: string): Promise<void> {
  requireFactorUsed(userId);
  await security.removePasskey(userId, id);
}

/**
 * Passkey sign-in challenges anyone may ask for, each a stored row: per client address, and for
 * the whole host so many addresses together cannot fill the database (challenges live 5 minutes).
 */
export const PASSKEY_CHALLENGES = Object.freeze({ windowMs: 10 * 60_000, perAddress: 30, perHost: 2000 });

export async function passkeySignIn(c: Context): Promise<{ challenge: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  if (!(await security.attempt('passkey-options', `a:${clientAddress()}`, PASSKEY_CHALLENGES.perAddress, PASSKEY_CHALLENGES.windowMs))
    || !(await security.attempt('passkey-options', 'host', PASSKEY_CHALLENGES.perHost, PASSKEY_CHALLENGES.windowMs))) {
    throw new ClientVisibleError('Too many passkey sign-ins were started. Try again in a few minutes, or sign in with your password.');
  }
  const options = await passkeyAuthenticationOptions(await passkeySite(c));
  return { challenge: await security.createChallenge('passkey-signin', null, options.challenge), options };
}

/** The user a passkey signs in, after checking its signature against the challenge. */
export async function completePasskeySignIn(c: Context, challengeId: string, response: AuthenticationResponseJSON): Promise<PublicUser | null> {
  const pending = await security.challenge(challengeId, 'passkey-signin');
  if (!pending || !(await security.takeChallenge(challengeId, 'passkey-signin'))) return null;
  const passkey = await security.passkey(response?.id);
  if (!passkey) return null;
  const verified = await verifyPasskeyAuthentication(await passkeySite(c), response, pending.challenge, { ...passkey, transports: passkey.transports ?? undefined });
  if (!verified) return null;
  await security.usePasskey(passkey.id, verified.counter);
  return userById(passkey.userId);
}

// --- Application passwords -------------------------------------------------
/** Application passwords sign apps and scripts in to the project's API routes (`apiTokenUser`). */
export const apiTokensAvailable = true;

export async function listApiTokens(userId: string): Promise<ApiToken[]> {
  return apiTokens.list(userId);
}

/** A new application password; the token is shown once. */
export async function createApiToken(userId: string, name: string, scope: 'read' | 'write', expiresInDays: number | null = null): Promise<string> {
  // An application password signs in without a second factor: an account that must have one
  // gets passwords only once it does, and only from a session that used it.
  const owner = await userById(userId);
  const own = owner?.id === (getRequestContext()?.get('user') as PublicUser | undefined)?.id;
  if (owner && twoFactorAsked(owner) && (!(await security.hasSecondFactor(userId)) || (own && await secondFactorRequired(owner)))) {
    throw new ClientVisibleError('This site requires two-step sign-in. Set it up before creating application passwords.');
  }
  const expiresAt = expiresInDays && expiresInDays > 0 ? Date.now() + Math.trunc(expiresInDays) * 86_400_000 : null;
  return (await apiTokens.create(userId, { name, scope, expiresAt })).token;
}

export async function revokeApiToken(userId: string, id: string): Promise<void> {
  // A session that never used the account's second factor may not take its tokens away either.
  requireFactorUsed(userId);
  await apiTokens.revoke(userId, id);
}

/**
 * The user an application password signs in, for the project's API routes: pass the request's
 * `Authorization: Bearer app_...` token. Null for an unknown, wrong or expired token, and for
 * an account that is not active. `scope` is `read` for a token that may only read.
 */
export async function apiTokenUser(token: string): Promise<{ user: PublicUser; scope: 'read' | 'write' } | null> {
  const verified = await apiTokens.verify(token);
  if (!verified) return null;
  const user = await userById(verified.userId);
  return user ? { user, scope: verified.scope } : null;
}

/**
 * Creates a reset token and emails it. Reads the `EMAIL` binding and
 * `MAIL_FROM` via the global helpers — no `Context` parameter needed. If the
 * send_email binding is not configured, this is a graceful no-op.
 */
export async function requestPasswordReset(email: string, resetBaseUrl: string): Promise<void> {
  // Beyond the limits per email and per address nothing is sent, and the answer is the same.
  const key = await security.sha256Hex(email.trim().toLowerCase());
  if (!(await security.attempt('reset', `e:${key}`, security.RESET_REQUESTS.perEmail, security.RESET_REQUESTS.windowMs))
    || !(await security.attempt('reset', `a:${clientAddress()}`, security.RESET_REQUESTS.perAddress, security.RESET_REQUESTS.windowMs))) return;
  const token = await createPasswordResetToken(email);
  if (!token) return; // silently no-op for unknown emails
  const mail = mailer();
  if (!mail) return; // send_email not configured: graceful no-op
  const resetUrl = `${resetBaseUrl.replace(/\/$/, '')}/auth/reset-password?token=${token}`;
  await mail.send({ to: email, subject: 'Reset your password',
    text: `We received a request to reset your password. Choose a new one here; the link works for one hour:\n${resetUrl}\n\nIf you did not ask for it, ignore this email.` });
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const userId = await consumePasswordResetToken(token);
  if (!userId) return false;
  const passwordHash = await hashPassword(newPassword);
  await User.update({ id: userId }, { passwordHash });
  await Session.delete({ userId });
  return true;
}

// --- Logout ----------------------------------------------------------------
/**
 * Deletes the calling session's row and returns headers that expire the
 * session cookie. Needs `c` to read the cookie and is applied to the response
 * by the caller (mirrors `auth.createSession`'s `{ headers }` contract).
 */
export async function logout(c: Context): Promise<{ headers: Headers }> {
  return { headers: await authSessions.revoke(getCookie(c, SESSION_COOKIE) ?? '', c) };
}

/** Clear the same cookie policy used for creation and rotation. */
export const expiredSessionCookie = authSessions.expiredCookie;

// --- Session management (for the /dashboard/sessions page) -----------------
export interface SessionInfo {
  /** Public management reference. Never the bearer token used in the cookie. */
  reference: string;
  expiresAt: string;
  /** When the session was created (the "Logged in" time). */
  createdAt: string;
  /** True when this row is the calling session (never revokable from its own page). */
  current: boolean;
  /** Origin metadata captured at login (null if unavailable). */
  location: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

function parseMeta(raw: Record<string, unknown> | string | null): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const PUBLIC_SESSION_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sessionOwner(c: Context): { userId: string; currentId: string } {
  const user = c.get('user') as PublicUser | undefined;
  const currentId = getCookie(c, SESSION_COOKIE);
  if (!user || typeof user.id !== 'string' || !user.id || !currentId) {
    throw new ClientVisibleError('Sign in to manage sessions.');
  }
  return { userId: user.id, currentId };
}

function validSessionReference(row: Session): boolean {
  return typeof row.publicId === 'string' && PUBLIC_SESSION_REFERENCE.test(row.publicId) && row.publicId !== row.id;
}

async function sessionWithReference(row: Session, userId: string): Promise<Session | null> {
  if (row.userId !== userId || parseMeta(row.meta)?.type !== 'auth' || row.expiresAt.getTime() <= Date.now()) return null;
  if (row.publicId == null) {
    // Conditional assignment and re-read retain one winner across tabs.
    await sql`UPDATE sessions SET public_id = ${crypto.randomUUID()}
      WHERE id = ${row.id} AND user_id = ${userId} AND public_id IS NULL
        AND meta = ${JSON.stringify({ type: 'auth' })}
        AND expires_at > ${new Date()}`;
    const stored = await Session.findOne({ where: { id: row.id, userId } });
    if (!stored || parseMeta(stored.meta)?.type !== 'auth' || stored.expiresAt.getTime() <= Date.now()) return null;
    row = stored;
  }
  if (!validSessionReference(row)) throw new Error('Invalid session management reference.');
  return row;
}

async function currentSessionReference(userId: string, currentId: string): Promise<string> {
  const row = await Session.findOne({ where: { id: currentId, userId } });
  const current = row ? await sessionWithReference(row, userId) : null;
  if (!current) throw new ClientVisibleError('Sign in to manage sessions.');
  return current.publicId!;
}

/** Lists only the authenticated caller's active auth sessions as safe DTOs. */
export async function listUserSessions(c: Context): Promise<SessionInfo[]> {
  return sessionsOf(c, sessionOwner(c).userId);
}

/**
 * Any user's active auth sessions, for the user screen. The page decides who may see
 * them; the caller's own session is marked current.
 */
export async function sessionsOf(c: Context, userId: string): Promise<SessionInfo[]> {
  const currentId = getCookie(c, SESSION_COOKIE);
  const rows = await Session.find({
    where: { userId, expiresAt: MoreThan(new Date()) },
  });
  const sessions: SessionInfo[] = [];
  for (const candidate of rows) {
    // Existing auth rows get an independent reference on first listing.
    const row = await sessionWithReference(candidate, userId);
    if (!row) continue;
    sessions.push({
      reference: row.publicId!,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: (row.createdAt || row.expiresAt).toISOString(),
      current: row.id === currentId,
      location: row.location,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
    });
  }
  return sessions;
}

/** Revoke one other auth session owned by the authenticated caller. */
export async function revokeSession(c: Context, reference: string): Promise<boolean> {
  const { userId, currentId } = sessionOwner(c);
  if (typeof reference !== 'string' || !PUBLIC_SESSION_REFERENCE.test(reference)) return false;
  const currentReference = await currentSessionReference(userId, currentId);
  const result = await sql`DELETE FROM sessions
    WHERE public_id = ${reference} AND user_id = ${userId} AND id <> ${currentId}
      AND public_id <> ${currentReference}
      AND meta = ${JSON.stringify({ type: 'auth' })}
      AND expires_at > ${new Date()}`;
  return result.meta.rowsAffected === 1;
}

/** End one of a user's auth sessions, never the caller's own. */
export async function revokeSessionOf(c: Context, userId: string, reference: string): Promise<boolean> {
  if (typeof reference !== 'string' || !PUBLIC_SESSION_REFERENCE.test(reference)) return false;
  const result = await sql`DELETE FROM sessions
    WHERE public_id = ${reference} AND user_id = ${userId} AND id <> ${getCookie(c, SESSION_COOKIE) ?? ''}
      AND meta = ${JSON.stringify({ type: 'auth' })}
      AND expires_at > ${new Date()}`;
  return result.meta.rowsAffected === 1;
}

/** End all of a user's auth sessions except the caller's own. */
export async function revokeSessionsOf(c: Context, userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${getCookie(c, SESSION_COOKIE) ?? ''}
    AND meta = ${JSON.stringify({ type: 'auth' })}`;
}

/** Revoke the caller's auth rows. Reset and OAuth-state rows remain separate. */
export async function revokeAllUserSessions(c: Context, keepCurrent = false): Promise<void> {
  const { userId, currentId } = sessionOwner(c);
  if (keepCurrent) {
    const currentReference = await currentSessionReference(userId, currentId);
    await sql`DELETE FROM sessions WHERE user_id = ${userId}
      AND id <> ${currentId} AND (public_id IS NULL OR public_id <> ${currentReference})
      AND meta = ${JSON.stringify({ type: 'auth' })}`;
  } else {
    await sql`DELETE FROM sessions WHERE user_id = ${userId} AND meta = ${JSON.stringify({ type: 'auth' })}`;
  }
}

/** The session cookie name, exported so pages/middleware can read it. */
export const SESSION_COOKIE_NAME = SESSION_COOKIE;

/** A person deletes their own account: the password confirms it, every session ends, and the row goes. Returns the headers that clear the browser's session. */
export async function deleteOwnAccount(c: Context, userId: string, password: string): Promise<{ headers: Headers }> {
  if (!(await passwordMatches(userId, password))) throw new ClientVisibleError('The password is not right.');
  await revokeSessionsOf(c, userId);
  const { headers } = await logout(c);
  await removeAccount(userId);
  return { headers };
}

/**
 * Email a one-time sign-in link to an active account. Nothing says whether the email exists; a
 * flood for one address or from one client stops after a few. Without a mail sender, nothing is sent.
 */
export async function requestMagicLink(email: string, _requestOrigin?: string): Promise<void> {
  const [mail, origin] = [mailer(), linkOrigin()];
  if (!origin) return;
  const key = await security.sha256Hex(email.trim().toLowerCase());
  const allowedEmail = await security.attempt('magic', `e:${key}`, security.RESET_REQUESTS.perEmail, security.RESET_REQUESTS.windowMs);
  const allowedAddress = await security.attempt('magic', `a:${clientAddress()}`, security.RESET_REQUESTS.perAddress, security.RESET_REQUESTS.windowMs);
  if (!allowedEmail || !allowedAddress || !mail) return;
  const account = await User.findOne({ where: { email } });
  if (!account || account.status !== 'active') return;
  const token = await createLink('magic', account.id, MAGIC_LINK_TTL_MS);
  const title = await siteName().catch(() => '');
  await mail.send({ to: account.email, subject: `Sign in to ${title || 'the site'}`,
    text: `Open this link to sign in; it works once, for fifteen minutes:\n${origin}/auth/magic?token=${token}\n\nIf you did not ask for it, ignore this email.` });
}

/** Spend a sign-in link: the account's ID, or null for a link that is unknown, spent or expired. */
export async function consumeMagicLink(token: string): Promise<string | null> {
  const userId = await takeLink('magic', token);
  if (!userId) return null;
  return (await User.findOne({ where: { id: userId } }))?.status === 'active' ? userId : null;
}

// --- OAuth -------------------------------------------------------------------
// The providers are the project's choice (src/dashboard.config.ts: `oauth`). Each reads
// <PROVIDER>_CLIENT_ID and <PROVIDER>_CLIENT_SECRET; OAUTH_SECRET signs the state.
// /auth/<provider>/redirect and /auth/<provider>/callback are the pages beside the sign-in page.
const oauthVariables = (provider: string) => ({
  clientId: `${provider.toUpperCase()}_CLIENT_ID`,
  clientSecret: `${provider.toUpperCase()}_CLIENT_SECRET`,
});

/** Whether the project offers this provider. */
export function oauthProvider(provider: string): boolean {
  return authOptions.authMethods.includes('oauth') && (authOptions.oauth as readonly string[]).includes(provider);
}

function oauthConfigurationError(c: Context, provider: string): OAuthError | null {
  if (!oauthProvider(provider)) return new OAuthError('COSSACK_OAUTH_PROVIDER_UNKNOWN');
  const variables = oauthVariables(provider);
  const missing = [variables.clientId, variables.clientSecret].filter((name) => !String(c.env[name] ?? '').trim());
  if (missing.length) {
    return new OAuthError('COSSACK_OAUTH_CREDENTIALS_MISSING');
  }

  if (String(c.env.OAUTH_SECRET ?? '').length < 16) {
    return new OAuthError('COSSACK_OAUTH_SECRET_INVALID');
  }
  return null;
}

function oauthUnavailable(c: Context, error: OAuthError): Response {
  console.warn('[Cossack OAuth]', error.toJSON());
  const { message, ...diagnostic } = error.toJSON();
  return c.json({ error: message, ...diagnostic }, error.status);
}

export const oauthStateStore: OAuthStateStore = {
  async create(record) {
    await Session.insert({ id: record.key, userId: null, data: null,
      meta: { type: 'oauth_state', provider: record.provider },
      createdAt: new Date(record.createdAt), expiresAt: new Date(record.expiresAt),
      location: null, userAgent: null, ipAddress: null });
  },
  async consume(key, provider, now) {
    // One conditional write owns callback replay. Never read then delete.
    const result = await sql`DELETE FROM sessions WHERE id = ${key}
      AND user_id IS NULL AND meta = ${JSON.stringify({ type: 'oauth_state', provider })}
      AND expires_at > ${new Date(Math.max(now, Date.now()))}`;
    return result.meta.rowsAffected === 1;
  },
};

function createOAuthForRequest(c: Context): OAuthKit {
  return createOAuth({
    secret: String(c.env.OAUTH_SECRET ?? ''),
    stateStore: oauthStateStore,
    providers: Object.fromEntries(authOptions.oauth.map((provider) => {
      const variables = oauthVariables(provider);
      return [provider, {
        clientId: String(c.env[variables.clientId] ?? ''),
        clientSecret: String(c.env[variables.clientSecret] ?? ''),
        redirectUrl: `/auth/${provider}/callback`,
      }];
    })),
  });
}

export const oauth: OAuthKit = {
  redirect: (provider) => async (c, next) => {
    const error = oauthConfigurationError(c, provider);
    if (error) return oauthUnavailable(c, error);
    return createOAuthForRequest(c).redirect(provider)(c, next);
  },
  callback: (provider, options) => async (c, next) => {
    const error = oauthConfigurationError(c, provider);
    if (error) return oauthUnavailable(c, error);
    return createOAuthForRequest(c).callback(provider, options)(c, next);
  },
};

export async function handleOAuthUser(
  provider: string,
  oauthUser: OAuthUser,
  _tokens: TokenSet,
  c: Context,
) {
  const account = await OAuthAccount.findOne({
    where: { provider, providerUserId: oauthUser.id },
  });
  let user = account
    ? await User.findOne({ where: { id: account.userId } })
    : null;
  // Only an address the provider verified may identify or claim an account.
  const verifiedEmail = oauthUser.emailVerified === true ? oauthUser.email : null;
  if (!user && verifiedEmail) {
    const existing = await User.findOne({ where: { email: verifiedEmail } });
    if (existing) throw new ClientVisibleError('Sign in to your existing account before linking an OAuth provider.');
  }
  if (!user) {
    const id = uuidv7();
    await User.insert({
      id,
      email: verifiedEmail ?? `${provider}-${oauthUser.id}@oauth.invalid`,
      name: oauthUser.name ?? oauthUser.nickname ?? null,
      passwordHash: null,
      avatar: oauthUser.avatar ?? null,
      meta: null,
      createdAt: new Date(),
    });
    user = await User.findOne({ where: { id } });
  }
  if (!user) throw new Error('Unable to provision OAuth user.');
  if (!account) {
    await OAuthAccount.insert({
      id: uuidv7(),
      userId: user.id,
      provider,
      providerUserId: oauthUser.id,
      createdAt: new Date(),
    });
  }
  if (auth.createSession) {
    const { headers } = await auth.createSession(publicUser(user), c);
    headers.forEach((value, key) => c.header(key, value));
  }
  return c.redirect(config('auth.redirectAfterLogin'));
}
