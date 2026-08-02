// src/auth.ts
//
// Authentication module: password hashing, the auth kit (session create /
// validate / resolve), credential helpers, password reset, logout, and
// session management (list / revoke).
//
// All data access uses Active Record models scoped by the ORM middleware.
// Runtime bindings (the send_email
// binding, env vars) are read via the global `binding()` / `env()` helpers,
// so none of the credential or reset helpers need a Hono `Context`. Only
// `logout` takes `c`, because reading the session cookie and setting response
// headers is inherently request-level.

import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createAuth } from '@cossackframework/auth';
import { MoreThan, Not, sql } from '@cossackframework/database';
import { ClientVisibleError } from '@cossackframework/core';
import { uuidv7 } from '@/lib/uuid';
import { User, type RoleAssignment } from '@/models/User';
import { Session } from '@/models/Session';

const SESSION_COOKIE = 'session_id';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// The sessions table stores BOTH auth sessions and password-reset tokens (both
// are just rows keyed by a random id with a user_id + expiry). We use the
// `meta` JSON column to discriminate them so session listings only show real
// auth sessions.
type SessionMeta = { type: 'auth' } | { type: 'password_reset' };

let warnedAboutSessionDatabase = false;

/**
 * Session lookup must never make a public request fail just because the
 * database binding or auth migrations are not ready yet. The auth middleware
 * treats the request as a guest and emits one actionable warning per isolate.
 */
function warnAboutSessionDatabase(error: unknown): void {
  if (warnedAboutSessionDatabase) return;
  warnedAboutSessionDatabase = true;
  const detail = error instanceof Error ? ` (${error.message})` : '';
  console.warn(
    '[Cossack Auth] Session database is unavailable; continuing as guest. ' +
    'Configure the DB binding and run `pnpm migrate` before using auth.' +
    detail,
  );
}

// --- Password hashing (PBKDF2 / Web Crypto, no extra deps) -----------------
const ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  return `pbkdf2$${toHex(salt.buffer)}$${toHex(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const key = await deriveKey(password, salt);
  // Constant-time-ish compare.
  const a = toHex(key);
  if (a.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    KEY_LENGTH * 8,
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
  const cf = (c.req.raw as any)?.cf;
  const location = cf?.country ? [cf.city, cf.country].filter(Boolean).join(', ') : null;
  return { ip, userAgent, location };
}

async function createSessionRow(user: User, c: Context): Promise<{ headers: Headers }> {
  const id = uuidv7();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const meta: SessionMeta = { type: 'auth' };
  const { ip, userAgent, location } = captureRequestInfo(c);
  await Session.insert({
    id,
    userId: user.id,
    data: null,
    expiresAt,
    createdAt: now,
    meta,
    ipAddress: ip,
    userAgent,
    location,
  });
  // Serialize the Set-Cookie header directly into the returned headers bag so
  // the createAuth contract stays pure (callers apply it to the response).
  const cookieParts = [
    SESSION_COOKIE + '=' + id,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure',
    'Max-Age=' + SESSION_TTL_SECONDS,
  ];
  const headers = new Headers();
  headers.append('Set-Cookie', cookieParts.join('; '));
  return { headers };
}

export const auth = createAuth<PublicUser>({
  extractSessionId: (c) => getCookie(c, SESSION_COOKIE),
  validateSessionId: async (sessionId) => {
    try {
      const row = await Session.findOne({
        where: { id: sessionId, expiresAt: MoreThan(new Date()) },
      });
      return row?.userId ?? null;
    } catch (error) {
      warnAboutSessionDatabase(error);
      return null;
    }
  },
  resolveUserById: async (userId) => {
    try {
      const row = await User.findOne({ where: { id: userId } });
      if (!row) return null;
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
    return createSessionRow(full, c);
  },
});

// --- Credential helpers (used by the page @Server methods) -----------------
export async function loginUser(email: string, password: string): Promise<PublicUser | null> {
  const row = await User.findOne({ where: { email } });
  if (!row || !row.passwordHash) return null;
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;
  const roles = await loadUserRoles(row.id);
  return publicUser(row, roles);
}

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
  if (!row) return null;
  await Session.delete({ id: token });
  return row.userId;
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
  return true;
}

// --- Logout ----------------------------------------------------------------
/**
 * Deletes the calling session's row and returns headers that expire the
 * session cookie. Needs `c` to read the cookie and is applied to the response
 * by the caller (mirrors `auth.createSession`'s `{ headers }` contract).
 */
export async function logout(c: Context): Promise<{ headers: Headers }> {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    await Session.delete({ id: sessionId });
  }
  return { headers: expiredSessionCookie() };
}

/**
 * Headers that expire (clear) the session cookie. Used by `logout` and by
 * `revokeAllUserSessions`-from-the-current-session (the dashboard "sign out
 * everywhere" action) so the browser drops the cookie even though the row is
 * already gone — keeping the two paths symmetric.
 */
export function expiredSessionCookie(): Headers {
  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    [SESSION_COOKIE + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=0'].join('; '),
  );
  return headers;
}

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
