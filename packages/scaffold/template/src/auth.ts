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
import { createAuth, createCredentialVerifier, createSessionManager, hashPassword, type AuthSessionRecord } from '@cossackframework/auth';
export { hashPassword, verifyPassword } from '@cossackframework/auth';
import { MoreThan, Not, sql } from '@cossackframework/database';
import { ClientVisibleError } from '@cossackframework/core';
import { uuidv7 } from '@/lib/uuid';
import { User, type RoleAssignment } from '@/models/User';
import { Session } from '@/models/Session';

const SESSION_COOKIE = 'session_id';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Purpose tags separate auth sessions, password-reset tokens and the OAuth
// recipe's anonymous state records. Session listings show only auth rows.
type SessionMeta = { type: 'auth' } | { type: 'password_reset' } | { type: 'oauth_state'; provider: string };

let warnedAboutSessionDatabase = false;

/**
 * Session lookup must never make a public request fail just because the
 * database binding or auth migrations are not ready yet. The auth middleware
 * treats the request as a guest and emits one actionable warning per isolate.
 */
function warnAboutSessionDatabase(): void {
  if (warnedAboutSessionDatabase) return;
  warnedAboutSessionDatabase = true;
  console.warn(
    '[Cossack Auth] Session database is unavailable; continuing as guest. ' +
    'Configure the DB binding and run `pnpm migrate` before using auth.',
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
      await Session.insert({ id: record.id, userId: record.userId, data: null,
        createdAt: new Date(record.createdAt), expiresAt: new Date(record.expiresAt),
        meta: { type: 'auth' }, ipAddress: ip, userAgent, location });
    },
    async read(id) { return authSession(await Session.findOne({ where: { id } })); },
    async replace(expected, replacement, now) {
      // One SQL statement owns rotation. Match the complete prior record and
      // auth purpose so concurrent rotation or revocation can have only one winner.
      const result = await sql`
        UPDATE sessions SET id = ${replacement.id},
          created_at = ${new Date(replacement.createdAt).toISOString()},
          expires_at = ${new Date(replacement.expiresAt).toISOString()}
        WHERE id = ${expected.id} AND user_id = ${expected.userId}
          AND created_at = ${new Date(expected.createdAt).toISOString()}
          AND expires_at = ${new Date(expected.expiresAt).toISOString()}
          AND expires_at > ${new Date(Math.max(now, Date.now())).toISOString()}
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
  extractSessionId: (c) => getCookie(c, SESSION_COOKIE),
  validateSessionId: async (sessionId, c) => {
    try {
      return (await authSessions.validate(sessionId, c))?.userId ?? null;
    } catch {
      warnAboutSessionDatabase();
      return null;
    }
  },
  resolveUserById: async (userId) => {
    try {
      const row = await User.findOne({ where: { id: userId } });
      if (!row) return null;
      const roles = await loadUserRoles(userId);
      return publicUser(row, roles);
    } catch {
      warnAboutSessionDatabase();
      return null;
    }
  },
  createSession: async (user, c) => {
    const full = await User.findOne({ where: { id: user.id } });
    if (!full) throw new Error('User not found');
    return authSessions.create(full.id, c);
  },
});

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

export const loginUser = credentials.verify;

export async function registerUser(email: string, password: string, name?: string): Promise<PublicUser> {
  // Check for an existing email first so we surface a clean, user-facing
  // error instead of letting the raw UNIQUE-constraint rejection bubble up
  // as a generic HTTP 500.
  if (await User.exists({ email })) {
    throw new ClientVisibleError('An account with this email already exists.');
  }
  const id = uuidv7();
  const passwordHash = await hashPassword(password);
  await User.insert({
    id,
    email,
    name: name ?? null,
    passwordHash,
    avatar: null,
    meta: null,
    createdAt: new Date(),
  });
  return { id, email, name: name ?? '', avatar: null, meta: null, roles: [] };
}

// --- Profile updates -------------------------------------------------------
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
async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await User.findOne({ where: { email } });
  if (!user) return null; // do NOT leak whether the email exists
  const token = uuidv7();
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

/**
 * Creates a reset token and emails it. Reads the `EMAIL` binding and
 * `MAIL_FROM` via the global helpers — no `Context` parameter needed. If the
 * send_email binding is not configured, this is a graceful no-op.
 */
export async function requestPasswordReset(email: string, resetBaseUrl: string): Promise<void> {
  const token = await createPasswordResetToken(email);
  if (!token) return; // silently no-op for unknown emails
  const from = env('MAIL_FROM', 'no-reply@example.com');
  const emailBinding = binding<{ send: (m: unknown) => Promise<unknown> }>('EMAIL');
  if (!emailBinding) return; // send_email not configured — graceful no-op
  const resetUrl = `${resetBaseUrl.replace(/\/$/, '')}/auth/reset-password?token=${token}`;
  const html = `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 1 hour.</p>`;
  const text = `Reset your password: ${resetUrl}`;
  await emailBinding.send({ to: email, from, subject: 'Reset your password', html, text });
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
  id: string;
  expiresAt: string;
  /** When the session was created (the "Logged in" time). */
  createdAt: string;
  /** True when this row is the calling session (never revokable from its own page). */
  current: boolean;
  meta: Record<string, unknown> | null;
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

/**
 * Lists a user's active auth sessions (reset tokens and expired rows excluded).
 * Pass the calling session id to flag the current session.
 */
export async function listUserSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]> {
  const rows = await Session.find({
    where: { userId, expiresAt: MoreThan(new Date()) },
  });
  return rows
    .filter((row) => {
      // Only show real auth sessions, not password-reset tokens.
      const m = parseMeta(row.meta);
      return m?.type === 'auth';
    })
    .map((row) => ({
      id: row.id,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: (row.createdAt || row.expiresAt).toISOString(),
      current: row.id === currentSessionId,
      meta: parseMeta(row.meta),
      location: row.location,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
    }));
}

/** Revoke a single session by id. */
export async function revokeSession(sessionId: string): Promise<void> {
  await Session.delete({ id: sessionId });
}

/** Revoke all of a user's auth sessions, optionally keeping the current one. */
export async function revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await Session.delete({
    userId,
    ...(exceptSessionId ? { id: Not(exceptSessionId) } : {}),
  });
}

/** The session cookie name, exported so pages/middleware can read it. */
export const SESSION_COOKIE_NAME = SESSION_COOKIE;
