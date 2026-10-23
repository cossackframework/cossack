// src/auth.ts
//
// Authentication on the CMS. Users, roles, sessions and reset tokens live in FastDB host
// tables; the auth library owns password hashing, credential verification, session expiry,
// rotation and cookies. This module exports the same functions as the database variant, so
// the auth and dashboard pages are shared between both.

import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { createAuth, createSessionManager, totpUri, type AuthSessionRecord } from '@cossackframework/auth';
import {
    passkeyAuthenticationOptions, passkeyRegistrationOptions, verifyPasskeyAuthentication, verifyPasskeyRegistration,
    type AuthenticationResponseJSON, type PasskeyConfig, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON,
} from '@cossackframework/auth/passkeys';
import { ClientVisibleError, getRequestContext } from '@cossackframework/core';
import { ANONYMOUS, hasPermission, isCmsError, PERMISSIONS, userPrincipal, type Principal } from '@cossackframework/cms';
import type { ApiToken, CmsHost, CmsUser, SecurityStatus } from '@cossackframework/cms/server';
import { renderSVG } from 'uqr';
import { currentCms } from './cms/index';

const SESSION_COOKIE = 'session_id';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// --- Types -----------------------------------------------------------------
export interface RoleAssignment {
  id: string;
  name: string;
  permissions: string[];
}

/** The safe user shape exposed to pages (`this.user`). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  meta: Record<string, unknown> | null;
  roles: RoleAssignment[];
  /** What this user may do in the CMS, for repositories and permission checks. */
  principal: Principal;
}

declare module '@cossackframework/core' {
  interface User {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    meta: Record<string, unknown> | null;
    roles: RoleAssignment[];
    principal: Principal;
  }
}

/** The host on the given context, or the current request's. */
function cms(c?: Context): CmsHost {
  return (c?.get('cms') as CmsHost | undefined) ?? currentCms();
}

function publicUser(user: CmsUser): PublicUser {
  return {
    id: user.id, email: user.email, name: user.name, avatar: user.avatar, meta: null,
    roles: user.assignments.map(role => ({ id: role.id, name: role.name, permissions: [...role.permissions] })),
    principal: userPrincipal(user.id, user.roles, user.permissions),
  };
}

// --- Sessions --------------------------------------------------------------
export const authSessions = createSessionManager({
  ttlSeconds: SESSION_TTL_SECONDS,
  cookie: { name: SESSION_COOKIE },
  store: {
    create: (record, c) => cms(c).authSessions.create(record, c),
    read: (id, c) => cms(c).authSessions.read(id, c),
    replace: (expected: AuthSessionRecord, replacement: AuthSessionRecord, now: number, c) => cms(c).authSessions.replace(expected, replacement, now, c),
    revoke: (id, c) => cms(c).authSessions.revoke(id, c),
  },
});

async function sessionFingerprint(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export const auth = createAuth<PublicUser>({
  realtime: {
    key: 'cossack.session',
    async capture(sessionId, _userId, c) {
      // The public reference survives rotation; the fingerprint does not.
      const reference = await cms(c).authSessions.publicReference(sessionId);
      if (!reference) throw new Error('Session ended before subscription.');
      return { reference, fingerprint: await sessionFingerprint(sessionId) };
    },
    async validate(data, c) {
      const { reference, fingerprint } = (data ?? {}) as { reference?: unknown; fingerprint?: unknown };
      if (typeof reference !== 'string' || typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) return null;
      const row = await cms(c).authSessions.findByReference(reference);
      if (!row || row.expiresAt <= Date.now() || await sessionFingerprint(row.id) !== fingerprint) return null;
      return row.userId;
    },
  },
  extractSessionId: c => getCookie(c, SESSION_COOKIE),
  // Before setup the session table does not exist; the auth kit then treats the visitor as a guest.
  validateSessionId: async (sessionId, c) => (await authSessions.validate(sessionId, c))?.userId ?? null,
  resolveUserById: async (userId, c) => {
    const user = await cms(c).users.get(userId);
    return user && user.status === 'active' ? publicUser(user) : null;
  },
  createSession: async (user, c) => authSessions.create(user.id, c),
});

// --- Credentials -----------------------------------------------------------
export async function loginUser(email: string, password: string): Promise<PublicUser | null> {
  const user = await cms().users.verifier.verify(email, password);
  return user && user.status === 'active' ? publicUser(user) : null;
}

/** Whether visitors may create accounts: the "Anyone can register" setting. */
export async function registrationOpen(): Promise<boolean> {
  const host = cms();
  return (await host.installed()) && await host.settings.get('general.usersCanRegister');
}

/** True until the first administrator exists. /auth/login sends visitors to /auth/setup then. */
export async function setupRequired(): Promise<boolean> {
  const host = cms();
  try { return !(await host.installed()) || (await host.users.count()) === 0; }
  catch { return true; }
}

export async function registerUser(email: string, password: string, name?: string): Promise<PublicUser> {
  const host = cms();
  if (!(await registrationOpen())) throw new ClientVisibleError('Registration is closed on this site.');
  const role = await host.settings.get('general.defaultRole');
  const roles = role && (await host.users.role(role)) ? [role] : [];
  try {
    return publicUser(await host.users.create({ email, password, name: name?.trim() || email.split('@')[0]!, roles }));
  } catch (error) {
    if (isCmsError(error, 'CMS_CONFLICT')) throw new ClientVisibleError('An account with this email already exists.');
    throw error;
  }
}

// --- Profile updates -------------------------------------------------------
export interface ProfileUpdate {
  name?: string;
  avatar?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Update editable profile fields. */
export async function updateUserProfile(userId: string, patch: ProfileUpdate): Promise<void> {
  await cms().users.update(userId, { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}) });
}

/** Profile pictures are uploaded to the media library. */
export const avatarUploads = true;

/**
 * Store a profile picture and set it on the user; returns its URL. The signed-in user may
 * change their own picture, and user managers anyone's.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const principal = (getRequestContext()?.get('principal') as Principal | undefined) ?? ANONYMOUS;
  try { return await cms().uploadAvatar(userId, { name: file.name, contentType: file.type, size: file.size, body: file.stream() }, { principal }); }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

// --- Second factors ----------------------------------------------------------
/** This store keeps authenticator apps, recovery codes, passkeys and application passwords. */
export const twoFactorAvailable = true;

/** Cookie holding a pending sign-in between the password and the second factor. */
export const TWO_FACTOR_COOKIE = 'two_factor';

export type { SecurityStatus, ApiToken };

/**
 * After a correct password: null when the user signs in at once, or the ID of a pending
 * sign-in (5 minutes, 5 tries) that /auth/two-factor completes with a code.
 */
export async function beginTwoFactor(userId: string): Promise<string | null> {
  const host = cms();
  if (!(await host.security.requiresCode(userId))) return null;
  return host.security.createChallenge('signin', userId, 'password');
}

/** Finish a pending sign-in with an authenticator or recovery code. */
export async function completeTwoFactor(challengeId: string, code: string): Promise<{ user: PublicUser; recovery: boolean } | { error: string; expired: boolean }> {
  const host = cms();
  const pending = await host.security.challenge(challengeId, 'signin');
  if (!pending?.userId) return { error: 'The sign-in expired. Enter your password again.', expired: true };
  const used = await host.security.verifyCode(pending.userId, code);
  if (!used) {
    const left = await host.security.failChallenge(challengeId);
    return left > 0 ? { error: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, expired: false } : { error: 'Too many wrong codes. Enter your password again.', expired: true };
  }
  if (!(await host.security.takeChallenge(challengeId, 'signin'))) return { error: 'The sign-in expired. Enter your password again.', expired: true };
  const user = await host.users.get(pending.userId);
  if (!user || user.status !== 'active') return { error: 'This account cannot sign in.', expired: true };
  return { user: publicUser(user), recovery: used === 'recovery' };
}

export async function securityStatus(userId: string): Promise<SecurityStatus> {
  return cms().security.status(userId);
}

/**
 * Whether the user must add a second factor before using the dashboard: General settings ask
 * for it and they have neither an authenticator app nor a passkey.
 */
export async function secondFactorRequired(user: PublicUser): Promise<boolean> {
  const host = cms();
  if (!hasPermission(user.principal, PERMISSIONS.dashboard)) return false;
  if (!(await host.settings.get('general.requireTwoFactor').catch(() => false))) return false;
  return !(await host.security.hasSecondFactor(user.id));
}

/** A new authenticator secret, its `otpauth://` URI and a QR code of it as SVG. */
export async function startAuthenticator(user: PublicUser): Promise<{ secret: string; uri: string; qr: string }> {
  const host = cms();
  const secret = await host.security.startTotp(user.id);
  const issuer = await host.settings.get('general.siteTitle').catch(() => 'Cossack');
  const uri = totpUri({ secret, issuer, account: user.email });
  return { secret, uri, qr: renderSVG(uri, { border: 1 }) };
}

/** Confirm the authenticator with a code from it; returns the recovery codes, shown once. */
export async function confirmAuthenticator(userId: string, code: string): Promise<string[]> {
  try { return await cms().security.confirmTotp(userId, code); }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

/** Turning the authenticator off needs one of its codes, or a recovery code. */
export async function disableAuthenticator(userId: string, code: string): Promise<void> {
  const host = cms();
  if (!(await host.security.verifyCode(userId, code))) throw new ClientVisibleError('That code is not right.');
  await host.security.disableTotp(userId);
}

export async function newRecoveryCodes(userId: string, code: string): Promise<string[]> {
  const host = cms();
  if (!(await host.security.verifyCode(userId, code))) throw new ClientVisibleError('That code is not right.');
  return host.security.regenerateRecoveryCodes(userId);
}

/** Remove a user's second factors, for a user manager helping someone who lost their device. */
export async function resetSecondFactors(userId: string): Promise<void> {
  await cms().security.reset(userId);
}

/** The site's relying party for passkeys: this host, and the origins the browser may report. */
function passkeySite(c: Context, siteName: string): PasskeyConfig {
  const url = new URL(c.req.url);
  const origins = new Set([url.origin]);
  if (c.req.header('x-forwarded-proto') === 'https') origins.add(`https://${url.host}`);
  const configured = env('APP_URL', '');
  if (configured) { try { origins.add(new URL(configured).origin); } catch { /* not a URL */ } }
  return { rpName: siteName, rpID: url.hostname, origin: [...origins] };
}

export async function passkeyRegistration(c: Context, user: PublicUser): Promise<{ challenge: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const host = cms(c);
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const existing = await host.security.passkeys(user.id);
  const options = await passkeyRegistrationOptions(site, { id: user.id, name: user.email, displayName: user.name }, existing.map(passkey => ({ ...passkey, transports: passkey.transports ?? undefined })));
  return { challenge: await host.security.createChallenge('passkey-register', user.id, options.challenge), options };
}

export async function addPasskey(c: Context, user: PublicUser, challengeId: string, response: RegistrationResponseJSON, name: string): Promise<void> {
  const host = cms(c);
  const pending = await host.security.challenge(challengeId, 'passkey-register');
  if (!pending || pending.userId !== user.id || !(await host.security.takeChallenge(challengeId, 'passkey-register'))) throw new ClientVisibleError('The passkey request expired. Try again.');
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const passkey = await verifyPasskeyRegistration(site, response, pending.challenge);
  if (!passkey) throw new ClientVisibleError('The passkey could not be verified.');
  try { await host.security.addPasskey(user.id, passkey, name); }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

export async function removePasskey(userId: string, id: string): Promise<void> {
  await cms().security.removePasskey(userId, id);
}

export async function passkeySignIn(c: Context): Promise<{ challenge: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const host = cms(c);
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const options = await passkeyAuthenticationOptions(site);
  return { challenge: await host.security.createChallenge('passkey-signin', null, options.challenge), options };
}

/** The user a passkey signs in, after checking its signature against the challenge. */
export async function completePasskeySignIn(c: Context, challengeId: string, response: AuthenticationResponseJSON): Promise<PublicUser | null> {
  const host = cms(c);
  const pending = await host.security.challenge(challengeId, 'passkey-signin');
  if (!pending || !(await host.security.takeChallenge(challengeId, 'passkey-signin'))) return null;
  const passkey = await host.security.passkey(response?.id);
  if (!passkey) return null;
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const verified = await verifyPasskeyAuthentication(site, response, pending.challenge, { ...passkey, transports: passkey.transports ?? undefined });
  if (!verified) return null;
  await host.security.usePasskey(passkey.id, verified.counter);
  const user = await host.users.get(passkey.userId);
  return user && user.status === 'active' ? publicUser(user) : null;
}

// --- Application passwords -------------------------------------------------
/** Application passwords sign apps and scripts in to the content API. */
export const apiTokensAvailable = true;

export async function listApiTokens(userId: string): Promise<ApiToken[]> {
  return cms().apiTokens.list(userId);
}

/** A new application password; the token is shown once. */
export async function createApiToken(userId: string, name: string, scope: 'read' | 'write'): Promise<string> {
  try { return (await cms().apiTokens.create(userId, { name, scope })).token; }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

export async function revokeApiToken(userId: string, id: string): Promise<void> {
  await cms().apiTokens.revoke(userId, id).catch(() => undefined);
}

// --- Password reset ----------------------------------------------------------
/**
 * Creates a reset token and emails it. Reads the `EMAIL` binding and `MAIL_FROM` via the
 * global helpers. Unknown emails and a missing send_email binding are silent no-ops.
 */
export async function requestPasswordReset(email: string, resetBaseUrl: string): Promise<void> {
  const reset = await cms().users.createPasswordReset(email);
  if (!reset) return; // do NOT leak whether the email exists
  const from = env('MAIL_FROM', 'no-reply@example.com');
  const emailBinding = binding<{ send: (m: unknown) => Promise<unknown> }>('EMAIL');
  if (!emailBinding) return;
  const resetUrl = `${resetBaseUrl.replace(/\/$/, '')}/auth/reset-password?token=${reset.token}`;
  const html = `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 1 hour.</p>`;
  const text = `Reset your password: ${resetUrl}`;
  await emailBinding.send({ to: reset.user.email, from, subject: 'Reset your password', html, text });
}

/** One request can use a token; the account's sessions end with the change. */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  return cms().users.resetPassword(token, newPassword);
}

// --- Logout ----------------------------------------------------------------
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
  createdAt: string;
  current: boolean;
  location: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

function sessionOwner(c: Context): { userId: string; currentId: string } {
  const user = c.get('user') as PublicUser | undefined;
  const currentId = getCookie(c, SESSION_COOKIE);
  if (!user?.id || !currentId) throw new ClientVisibleError('Sign in to manage sessions.');
  return { userId: user.id, currentId };
}

/** Lists only the authenticated caller's active sessions as safe DTOs. */
export async function listUserSessions(c: Context): Promise<SessionInfo[]> {
  return sessionsOf(c, sessionOwner(c).userId);
}

/**
 * Any user's active sessions, for the user screen. The page decides who may see them;
 * the caller's own session is marked current.
 */
export async function sessionsOf(c: Context, userId: string): Promise<SessionInfo[]> {
  const host = cms(c);
  const currentId = getCookie(c, SESSION_COOKIE);
  const current = currentId ? await host.authSessions.publicReference(currentId) : null;
  return (await host.authSessions.listForUser(userId, Date.now())).map(row => ({
    reference: row.reference, createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString(),
    current: row.reference === current, location: null, userAgent: row.userAgent, ipAddress: row.ip,
  }));
}

/** End one of a user's sessions, never the caller's own. */
export async function revokeSessionOf(c: Context, userId: string, reference: string): Promise<boolean> {
  return cms(c).authSessions.revokeByReference(userId, reference, getCookie(c, SESSION_COOKIE));
}

/** End all of a user's sessions except the caller's own. */
export async function revokeSessionsOf(c: Context, userId: string): Promise<void> {
  await cms(c).authSessions.revokeAllForUser(userId, getCookie(c, SESSION_COOKIE));
}

/** Revoke one other session owned by the authenticated caller. */
export async function revokeSession(c: Context, reference: string): Promise<boolean> {
  const { userId, currentId } = sessionOwner(c);
  return cms(c).authSessions.revokeByReference(userId, reference, currentId);
}

/** Revoke the caller's sessions, optionally keeping the current one. */
export async function revokeAllUserSessions(c: Context, keepCurrent = false): Promise<void> {
  const { userId, currentId } = sessionOwner(c);
  await cms(c).authSessions.revokeAllForUser(userId, keepCurrent ? currentId : undefined);
}

/** The session cookie name, exported so pages/middleware can read it. */
export const SESSION_COOKIE_NAME = SESSION_COOKIE;
