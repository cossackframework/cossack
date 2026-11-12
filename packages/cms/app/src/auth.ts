// src/auth.ts
//
// Authentication on the CMS. Users, roles, sessions and reset tokens live in RomeDB host
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
import { ClientVisibleError, getClientIp, getRequestContext } from '@cossackframework/core';
import { ANONYMOUS, hasPermission, holdsAll, isCmsError, isNetworkAdmin, PERMISSIONS, type Principal } from '@cossackframework/cms';
import { MAIN_SITE, networkSite, randomToken, RESET_REQUESTS, sha256Hex, type ApiToken, type CmsHost, type CmsMember, type SecurityStatus as AccountSecurity } from '@cossackframework/cms/server';
import { renderSVG } from 'uqr';
import { currentCms, networkFor, type CmsBindings } from './cms/index';
import { handoffSite, pendingSite } from './cms/handoff';
import { mailOrigin } from './cms/seo';

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
  /** Set by `registerUser` when the account waits for the email's confirmation link instead of signing in. */
  verification?: 'sent';
  /** The account waits for an administrator's approval before it can sign in. */
  approval?: 'pending';
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

function publicUser(user: CmsMember): PublicUser {
  return {
    id: user.id, email: user.email, name: user.name, avatar: user.avatar, meta: null,
    roles: user.assignments.map(role => ({ id: role.id, name: role.name, permissions: [...role.permissions] })),
    principal: user.principal,
  };
}

/**
 * The member a signed-in account acts as on this site, or null when it is not one or is
 * disabled. On a site other than the main one, the child session's network role stands in for
 * the account, so the request reads only the site's database.
 */
async function member(id: string, c?: Context): Promise<PublicUser | null> {
  const context = c ?? getRequestContext();
  const child = context?.get('site')?.id !== MAIN_SITE ? context?.get('cms.networkRole') : undefined;
  const user = await cms(c).users.resolve(id, child === undefined ? undefined : { networkRole: child });
  return user ? publicUser(user) : null;
}

// --- Sessions --------------------------------------------------------------
export const authSessions = createSessionManager({
  ttlSeconds: SESSION_TTL_SECONDS,
  cookie: { name: SESSION_COOKIE },
  store: {
    create: (record, c) => {
      // A handoff in progress makes the session a child of the network session.
      const child = (c as Context).get('cms.child');
      // createSession() says whether this sign-in used a second factor; a child session copies its network session's.
      const secondFactor = (c as Context).get('cms.signInSecondFactor') === true;
      // Every sign-in ends here, whatever its method: plugins hear of it through cms.user.signed-in,
      // queued in the session's own write.
      return (async () => {
        const host = cms(c);
        const user = await host.users.get(record.userId).catch(() => null);
        const also = user ? [await host.userSignedInStatement(user, record.id)] : [];
        const result = child ? await host.authSessions.createChild(record, child, c, { also }) : await host.authSessions.create(record, c, { secondFactor, also });
        if (also.length) host.outboxWritten();
        return result;
      })();
    },
    read: async (id, c) => {
      const session = await cms(c).authSessions.read(id, c);
      if (session?.parentId) (c as Context).set('cms.networkRole', session.networkRole);
      if (session) (c as Context).set('cms.sessionSecondFactor', session.secondFactor);
      return session;
    },
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
      c.set('cms.sessionSecondFactor', row.secondFactor);
      return row.userId;
    },
  },
  extractSessionId: c => getCookie(c, SESSION_COOKIE),
  // Before setup the session table does not exist; the auth kit then treats the visitor as a guest.
  validateSessionId: async (sessionId, c) => (await authSessions.validate(sessionId, c))?.userId ?? null,
  resolveUserById: (userId, c) => member(userId, c),
  createSession: async (user, c) => authSessions.create(user.id, c),
});

/**
 * Start a session for a sign-in, recording whether it used a second factor (an authenticator or
 * recovery code, or a passkey). Required two-step sign-in asks that of the session: a session
 * signed in with a password alone stays limited even after its account gains a factor.
 */
export async function createSession(userId: string, c: Context, options: { secondFactor?: boolean } = {}) {
  c.set('cms.signInSecondFactor', options.secondFactor === true);
  try { return await authSessions.create(userId, c); }
  finally { c.set('cms.signInSecondFactor', false); }
}

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by createSession() for the session it is about to store. */
    'cms.signInSecondFactor': boolean;
    /** Whether the request's session was signed in with a second factor. */
    'cms.sessionSecondFactor': boolean;
  }
}

// --- Credentials -----------------------------------------------------------
/**
 * Email and password sign in this host's accounts: network accounts on the main site, the
 * site's own accounts on an added site. Network accounts reach an added site through the
 * network's sign-in (`/auth/handoff`).
 */
export async function loginUser(email: string, password: string, address = clientAddress()): Promise<PublicUser | null> {
  const host = cms();
  // The attempt is counted before the password is checked, so guesses sent at once meet the limit too.
  const allowed = await host.security.signInBegin(email, address);
  if (!allowed.ok) throw new SignInLockedError(allowed.retryAfterMs);
  const account = await host.signIn.accounts.verifier.verify(email, password);
  if (!account) {
    // The verifier signs in active accounts only. One that waits for approval hears so, once its password is right.
    const waiting = await host.signIn.accounts.disabledWithPassword(email, password).catch(() => null);
    if (waiting && await host.users.awaitingApproval(waiting.id).catch(() => false)) {
      await host.security.signInSucceeded(email, address);
      throw new SignInPendingError();
    }
    return null;
  }
  await host.security.signInSucceeded(email, address);
  if (account.status !== 'active') return null;
  return member(account.id);
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

/** The password matched an account that waits for an administrator's approval. */
export class SignInPendingError extends ClientVisibleError {
  constructor() {
    super('Your account waits for an administrator to approve it. We will email you when it is ready.');
    this.name = 'SignInPendingError';
  }
}

/**
 * Two-step sign-in is required (Settings → General) and the account's only second factor is a
 * passkey: a password or an email link alone is one step, so the account signs in with its passkey.
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
 * Whether this is the user's current password, before they change it: their site account's, or
 * their network account's. Wrong answers are counted per account, so an open session cannot
 * guess its way to the password (and from there the email or the account).
 */
export async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const host = cms();
  if (!(await host.security.attempt('password-check', userId, PASSWORD_CHECKS.max, PASSWORD_CHECKS.windowMs))) {
    throw new ClientVisibleError('Too many wrong passwords. Wait a few minutes, then try again.');
  }
  const { accounts } = await host.storesOf(userId);
  const account = await accounts.get(userId);
  const matches = !!account && (await accounts.verifier.verify(account.email, password))?.id === userId;
  // Only wrong passwords count against the account.
  if (matches) await host.security.release('password-check', userId).catch(() => undefined);
  return matches;
}

/** What others see on an added site instead of a network account's profile, password and sign-in methods. */
export const NETWORK_ACCOUNT_LOCKED = 'A network account: its name, email, password and sign-in methods change on the network, by the person or a network admin. This site manages its roles.';

/**
 * Whether the request's user may change this account's profile, password, second factors,
 * application passwords, status and membership here. On an added site a network account is the
 * person's or a network admin's to change; on the main site, theirs, a network admin's, or one who
 * holds every permission the account has on each of its sites. The dashboard's user permissions
 * govern the rest.
 */
export async function manageableHere(userId: string): Promise<boolean> {
  const host = cms();
  const request = getRequestContext();
  // The signed-in person's own account, read from the session: until they add a second factor
  // that General settings require, their request principal is anonymous, yet adding one is theirs to do.
  if ((request?.get('user') as PublicUser | undefined)?.id === userId) return true;
  const principal = (request?.get('principal') as Principal | undefined) ?? ANONYMOUS;
  if (principal.kind === 'user' && (principal.id === userId || isNetworkAdmin(principal))) return true;
  if (host.siteAccounts) return (await host.users.get(userId))?.account !== 'network';
  // On the main site the account signs in everywhere: whoever changes it must hold every
  // permission it holds on each site it belongs to, or setting its password takes those sites too.
  return request ? heldOnEverySite(networkFor(request.env as CmsBindings), principal, userId) : true;
}

async function heldOnEverySite(network: ReturnType<typeof networkFor>, principal: Principal, userId: string): Promise<boolean> {
  try {
    for (const site of await network.memberSites(userId)) {
      if (site.id === MAIN_SITE) continue;
      const member = await network.hostOf(site).users.get(userId);
      if (member && !holdsAll(principal, member.permissions)) return false;
    }
    return true;
  } catch { return false; }
}

async function requireManageable(userId: string): Promise<void> {
  if (!(await manageableHere(userId))) throw new ClientVisibleError(NETWORK_ACCOUNT_LOCKED);
}

/** Whether visitors may create accounts: the "Anyone can register" setting. */
export async function registrationOpen(): Promise<boolean> {
  const c = getRequestContext();
  const host = (c ? await handoffSite(c, networkFor(c.env as CmsBindings)) : null) ?? cms();
  return (await host.installed()) && await host.settings.get('general.usersCanRegister');
}

/**
 * True until an active network admin exists: a fresh install, or a site's database taking over
 * as its own install. /auth/login sends visitors to /auth/setup then.
 */
export async function setupRequired(): Promise<boolean> {
  const host = cms();
  try { return !(await host.installed()) || !(await host.accounts.hasNetworkAdmin()); }
  catch { return true; }
}

/**
 * A new account, with the site's default role. On an added site it is a site account. On the
 * network host for another site (the visitor came from its network sign-in) it is a network
 * account, a member of that site only. `cms.user.before-register` filters may refuse it, change
 * its roles or hold it for approval; Settings → General may ask for both the email's
 * confirmation and an administrator's approval, in that order.
 */
export async function registerUser(email: string, password: string, name?: string): Promise<PublicUser> {
  const c = getRequestContext();
  const network = c ? networkFor(c.env as CmsBindings) : null;
  // Registering on the network host for another site: that site's settings apply, whoever hosts the form.
  const site = c && network ? await handoffSite(c, network) : null;
  const siteRecord = site && c && network ? await pendingSite(c, network) : null;
  const host = site ?? cms();
  if (!(await registrationOpen())) throw new ClientVisibleError('Registration is closed on this site.');
  const role = await host.settings.get('general.defaultRole');
  const origin = linkOrigin() ?? '';
  let draft;
  try {
    draft = await host.registrationDraft({ email, name: name?.trim() || email.split('@')[0]!, roles: role && (await host.users.role(role)) ? [role] : [], approval: await host.settings.get('general.approveRegistrations').catch(() => false) }, { origin });
  } catch (error) {
    if (isCmsError(error, 'CMS_VALIDATION')) throw new ClientVisibleError(error.message);
    throw error;
  }
  // With a sender (the one that sends the link: this request's host) and the site asking for it, the account waits for the email's link.
  const verify = Boolean(cms().mail) && await host.settings.get('general.verifyEmail').catch(() => true);
  // Without the site's address no link can be sent: the account is not created active instead.
  if (verify && !origin) {
    console.warn('[cms] registration refused: email confirmation is on, but APP_URL is not set, so no confirmation link can be sent');
    throw new ClientVisibleError('Registration is not available right now. Ask the site\'s administrator.');
  }
  await replaceUnconfirmed(host, email, site !== null);
  try {
    const user = await host.users.create({ email, password, name: draft.name, roles: draft.roles, ...(site ? { network: true } : {}), ...(verify && !draft.approval ? { status: 'disabled' as const } : {}) });
    const bare = { id: user.id, email: user.email, name: user.name, avatar: user.avatar, meta: null, roles: [], principal: ANONYMOUS };
    if (draft.approval) await host.users.holdForApproval(user.id, { verified: !verify });
    await host.userRegistered(user, verify ? 'verification' : draft.approval ? 'approval' : 'active').catch(() => undefined);
    if (verify) {
      await sendVerification(cms(), user.id, user.email, user.name, siteRecord?.id ?? null);
      return { ...bare, verification: 'sent' };
    }
    if (draft.approval) return { ...bare, approval: 'pending' };
    // The network host signs the account in; the handoff then takes it to its site.
    return site ? bare : (await member(user.id))!;
  } catch (error) {
    if (isCmsError(error, 'CMS_CONFLICT')) throw new ClientVisibleError('An account with this email already exists.');
    throw error;
  }
}

/**
 * An account registered with this email that never confirmed it (created waiting, untouched since,
 * never signed in) gives way to a new registration, so a missed or expired link, or someone
 * registering another person's address, never locks the address. One waiting for approval stays.
 */
async function replaceUnconfirmed(host: CmsHost, email: string, network: boolean): Promise<void> {
  const accounts = network ? host.accounts : host.signIn.accounts;
  const account = await accounts.findByEmail(email).catch(() => null);
  if (!account?.unconfirmed || await host.users.awaitingApproval(account.id).catch(() => false)) return;
  await host.users.delete(account.id).catch(() => undefined);
  await accounts.delete(account.id).catch(() => undefined);
}

/**
 * Where links in this request's emails point: the site's own address (APP_URL for the main site,
 * its domain for an added one), never the request's Host header, which a client chooses. Without
 * a configured address, a request to this machine (development) uses its own origin; otherwise
 * null, and no link is sent.
 */
export function linkOrigin(): string | null {
  const c = getRequestContext();
  if (!c) return env('APP_URL', '').replace(/\/+$/, '') || null;
  return mailOrigin(c);
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
  await requireManageable(userId);
  const principal = (getRequestContext()?.get('principal') as Principal | undefined) ?? ANONYMOUS;
  try { return await cms().uploadAvatar(userId, { name: file.name, contentType: file.type, size: file.size, body: file.stream() }, { principal }); }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

// --- Second factors ----------------------------------------------------------
/** This store keeps authenticator apps, recovery codes, passkeys and application passwords. */
export const twoFactorAvailable = true;

/** Cookie holding a pending sign-in between the password and the second factor. */
export const TWO_FACTOR_COOKIE = 'two_factor';

export type { ApiToken };

/** An account's second factors and passkeys; on an added site, a network account's passkeys are the network host's. */
export type SecurityStatus = AccountSecurity & { passkeysManagedAt?: { name: string; href: string | null } | null };

/**
 * After a correct password or email link: null when the user signs in at once, or the ID of a
 * pending sign-in (5 minutes, 5 tries) that /auth/two-factor completes with a code. When
 * two-step sign-in is required for the dashboard and the account's second factor is a passkey,
 * having enrolled one is not having used it: throws SignInPasskeyError.
 */
export async function beginTwoFactor(userId: string): Promise<string | null> {
  const host = cms();
  const { security } = host.signIn;
  if (await security.requiresCode(userId)) return security.createChallenge('signin', userId, 'password');
  if (!(await host.settings.get('general.requireTwoFactor').catch(() => false))) return null;
  const user = await member(userId);
  if (user && hasPermission(user.principal, PERMISSIONS.dashboard) && await security.hasSecondFactor(userId)) throw new SignInPasskeyError();
  return null;
}

/**
 * Finish a pending sign-in with an authenticator or recovery code. A try is spent before the
 * code is checked, on the pending sign-in and on the account, so codes sent at once count too.
 */
export async function completeTwoFactor(challengeId: string, code: string): Promise<{ user: PublicUser; recovery: boolean } | { error: string; expired: boolean }> {
  const { security } = cms().signIn;
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
    return left > 0 ? { error: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, expired: false } : { error: 'Too many wrong codes. Enter your password again.', expired: true };
  }
  if (!(await security.takeChallenge(challengeId, 'signin'))) return expired;
  await security.secondFactorSucceeded(pending.userId);
  const user = await member(pending.userId);
  if (!user) return { error: 'This account cannot sign in.', expired: true };
  return { user, recovery: used === 'recovery' };
}

/** The second factors, passkeys and application passwords of a user's account: its site's for a site account, the network's otherwise. */
async function storesOf(userId: string) {
  return cms().storesOf(userId);
}

export async function securityStatus(userId: string): Promise<SecurityStatus> {
  const [status, elsewhere] = await Promise.all([(await storesOf(userId)).security.status(userId), networkPasskeys(userId)]);
  return { ...status, passkeysManagedAt: elsewhere };
}

/**
 * Where a network account's passkeys are kept when this is an added site: the network host.
 * They are bound to its address and sign in there, so this site lists them and links there
 * rather than adding or removing them. Null for site accounts and on the main site.
 */
async function networkPasskeys(userId: string): Promise<{ name: string; href: string | null } | null> {
  const host = cms();
  if (!host.siteAccounts || (await host.storesOf(userId)).kind !== 'network') return null;
  const c = getRequestContext();
  const network = networkFor(c?.env as CmsBindings);
  const name = (await network.settings()).name || await network.main.settings.get('general.siteTitle').catch(() => 'the network');
  let href: string | null = null;
  try { href = new URL('/dashboard/profile/security', env('APP_URL', '')).href; } catch { /* no network address */ }
  return { name, href };
}

async function requireLocalPasskeys(userId: string): Promise<void> {
  const elsewhere = await networkPasskeys(userId);
  if (elsewhere) throw new ClientVisibleError(`Add or remove this account's passkeys on ${elsewhere.name}.`);
}

async function twoFactorAsked(user: Pick<PublicUser, 'principal'>): Promise<boolean> {
  return hasPermission(user.principal, PERMISSIONS.dashboard) && await cms().settings.get('general.requireTwoFactor').catch(() => false) === true;
}

/**
 * Whether the request's session may not act as the user yet: General settings require two-step
 * sign-in of staff, and the session was signed in without a second factor. That covers staff
 * with no factor (they set one up) and a session signed in with a password alone (it signs in
 * again with the factor), so a factor added later does not trust a session that never used it.
 */
export async function secondFactorRequired(user: PublicUser, c: Context | undefined = getRequestContext()): Promise<boolean> {
  if (!(await twoFactorAsked(user))) return false;
  return c?.get('cms.sessionSecondFactor') !== true;
}

/** Whether an account itself still lacks the second factor General settings require: for application passwords, which have no sign-in of their own. */
export async function accountNeedsSecondFactor(user: Pick<PublicUser, 'id' | 'principal'>): Promise<boolean> {
  if (!(await twoFactorAsked(user))) return false;
  return !(await (await storesOf(user.id)).security.hasSecondFactor(user.id));
}

/**
 * Before a factor is added: a session limited by required two-step sign-in may add the
 * account's first one (that is the setup), but not one beside a factor it never used, which
 * would let a password alone take the account's two-step sign-in.
 */
async function requireFactorSetupAllowed(userId: string): Promise<void> {
  const c = getRequestContext();
  const user = c?.get('user') as PublicUser | undefined;
  if (!user || user.id !== userId || c?.get('cms.sessionSecondFactor') === true) return;
  if (!(await twoFactorAsked(user))) return;
  if (await (await storesOf(userId)).security.hasSecondFactor(userId)) {
    throw new ClientVisibleError('This account already has two-step sign-in. Sign out, then sign in again with it.');
  }
}

/**
 * After the user added a factor in this session: the session counts as using it. Other sessions
 * keep what their own sign-in used, so a password-only one stays limited; they are not ended,
 * since whoever added the first factor (the owner, or someone with the password) would otherwise
 * sign the other out.
 */
async function factorAdded(userId: string): Promise<void> {
  const c = getRequestContext();
  const id = c ? getCookie(c, SESSION_COOKIE) : undefined;
  const user = c?.get('user') as PublicUser | undefined;
  if (!c || !id || user?.id !== userId) return;
  await cms(c).authSessions.markSecondFactor(id);
  c.set('cms.sessionSecondFactor', true);
}

/** A new authenticator secret, its `otpauth://` URI and a QR code of it as SVG. */
export async function startAuthenticator(user: PublicUser): Promise<{ secret: string; uri: string; qr: string }> {
  await requireFactorSetupAllowed(user.id);
  const host = cms();
  const secret = await (await storesOf(user.id)).security.startTotp(user.id);
  const issuer = await host.settings.get('general.siteTitle').catch(() => 'Cossack');
  const uri = totpUri({ secret, issuer, account: user.email });
  return { secret, uri, qr: renderSVG(uri, { border: 1 }) };
}

/** Confirm the authenticator with a code from it; returns the recovery codes, shown once. */
export async function confirmAuthenticator(userId: string, code: string): Promise<string[]> {
  await requireFactorSetupAllowed(userId);
  let codes: string[];
  try { codes = await (await storesOf(userId)).security.confirmTotp(userId, code); }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
  await factorAdded(userId);
  return codes;
}

/** Turning the authenticator off needs one of its codes, or a recovery code. */
export async function disableAuthenticator(userId: string, code: string): Promise<void> {
  const { security } = await storesOf(userId);
  if (!(await security.verifyCode(userId, code))) throw new ClientVisibleError('That code is not right.');
  await security.disableTotp(userId);
}

export async function newRecoveryCodes(userId: string, code: string): Promise<string[]> {
  const { security } = await storesOf(userId);
  if (!(await security.verifyCode(userId, code))) throw new ClientVisibleError('That code is not right.');
  return security.regenerateRecoveryCodes(userId);
}

/** Remove a user's second factors, for a user manager helping someone who lost their device. */
export async function resetSecondFactors(userId: string): Promise<void> {
  await requireManageable(userId);
  await (await storesOf(userId)).security.reset(userId);
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
  await requireLocalPasskeys(user.id);
  await requireFactorSetupAllowed(user.id);
  const host = cms(c);
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const { security } = await host.storesOf(user.id);
  const existing = await security.passkeys(user.id);
  const options = await passkeyRegistrationOptions(site, { id: user.id, name: user.email, displayName: user.name }, existing.map(passkey => ({ ...passkey, transports: passkey.transports ?? undefined })));
  return { challenge: await security.createChallenge('passkey-register', user.id, options.challenge), options };
}

export async function addPasskey(c: Context, user: PublicUser, challengeId: string, response: RegistrationResponseJSON, name: string): Promise<void> {
  await requireLocalPasskeys(user.id);
  const host = cms(c);
  const { security } = await host.storesOf(user.id);
  const pending = await security.challenge(challengeId, 'passkey-register');
  if (!pending || pending.userId !== user.id || !(await security.takeChallenge(challengeId, 'passkey-register'))) throw new ClientVisibleError('The passkey request expired. Try again.');
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const passkey = await verifyPasskeyRegistration(site, response, pending.challenge);
  if (!passkey) throw new ClientVisibleError('The passkey could not be verified.');
  await requireFactorSetupAllowed(user.id);
  try { await security.addPasskey(user.id, passkey, name); }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
  await factorAdded(user.id);
}

export async function removePasskey(userId: string, id: string): Promise<void> {
  await requireLocalPasskeys(userId);
  await (await storesOf(userId)).security.removePasskey(userId, id);
}

/** A passkey signs in this host's accounts, bound to this host: the network's on the main site, the site's own on an added site. */
export async function passkeySignIn(c: Context): Promise<{ challenge: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const host = cms(c);
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const options = await passkeyAuthenticationOptions(site);
  return { challenge: await host.signIn.security.createChallenge('passkey-signin', null, options.challenge), options };
}

/** The user a passkey signs in, after checking its signature against the challenge. */
export async function completePasskeySignIn(c: Context, challengeId: string, response: AuthenticationResponseJSON): Promise<PublicUser | null> {
  const host = cms(c);
  const { security } = host.signIn;
  const pending = await security.challenge(challengeId, 'passkey-signin');
  if (!pending || !(await security.takeChallenge(challengeId, 'passkey-signin'))) return null;
  const passkey = await security.passkey(response?.id);
  if (!passkey) return null;
  const site = passkeySite(c, await host.settings.get('general.siteTitle').catch(() => 'Cossack'));
  const verified = await verifyPasskeyAuthentication(site, response, pending.challenge, { ...passkey, transports: passkey.transports ?? undefined });
  if (!verified) return null;
  await security.usePasskey(passkey.id, verified.counter);
  return member(passkey.userId, c);
}

// --- Application passwords -------------------------------------------------
/** Application passwords sign apps and scripts in to the content API. */
export const apiTokensAvailable = true;

export async function listApiTokens(userId: string): Promise<ApiToken[]> {
  return await manageableHere(userId) ? (await storesOf(userId)).apiTokens.list(userId) : [];
}

/** A new application password; the token is shown once. A network account's work on every site it belongs to. */
export async function createApiToken(userId: string, name: string, scope: 'read' | 'write', expiresInDays: number | null = null): Promise<string> {
  await requireManageable(userId);
  // An application password signs in without a second factor: an account that General settings
  // require to have one gets passwords only once it does.
  const owner = await member(userId);
  if (owner && (await accountNeedsSecondFactor(owner) || (owner.id === (getRequestContext()?.get('user') as PublicUser | undefined)?.id && await secondFactorRequired(owner)))) throw new ClientVisibleError('This site requires two-step sign-in: set it up under Profile → Security before creating application passwords.');
  const expiresAt = expiresInDays && expiresInDays > 0 ? Date.now() + Math.trunc(expiresInDays) * 86_400_000 : null;
  try { return (await (await storesOf(userId)).apiTokens.create(userId, { name, scope, expiresAt })).token; }
  catch (error) { throw isCmsError(error) ? new ClientVisibleError(error.message) : error; }
}

export async function revokeApiToken(userId: string, id: string): Promise<void> {
  await requireManageable(userId);
  await (await storesOf(userId)).apiTokens.revoke(userId, id).catch(() => undefined);
}

// --- Password reset ----------------------------------------------------------
/**
 * Creates a reset token and emails it. Reads the `EMAIL` binding and `MAIL_FROM` via the
 * global helpers. Unknown emails and a missing send_email binding are silent no-ops. On an
 * added site, a member with a network account gets the network's reset link.
 */
export async function requestPasswordReset(email: string, _requestOrigin?: string): Promise<void> {
  const host = cms();
  // The link goes to the site's own address, never the Host the request named.
  let resetBaseUrl = linkOrigin();
  if (!resetBaseUrl) {
    console.warn('[cms] A password reset was requested, but the site has no address (APP_URL): the link was not sent.');
    return;
  }
  // A flood of requests for one email or from one address sends nothing after the first few.
  const address = clientAddress();
  const byEmail = await host.security.attempt('reset', `e:${email.trim().toLowerCase()}`, RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs);
  const byAddress = await host.security.attempt('reset', `a:${address}`, RESET_REQUESTS.perAddress, RESET_REQUESTS.windowMs);
  if (!byEmail || !byAddress) return;
  let reset = await host.signIn.accounts.createPasswordReset(email);
  if (!reset && host.siteAccounts && (await host.users.findByEmail(email).catch(() => null))?.account === 'network') {
    const network = env('APP_URL', '');
    reset = network ? await host.accounts.createPasswordReset(email) : null;
    resetBaseUrl = network;
  }
  if (!reset) return; // do NOT leak whether the email exists
  if (!host.mail) {
    console.warn('[cms] A password reset was requested, but no email sender is configured (an EMAIL binding, or SMTP_HOST on Node): the link was not sent.');
    return;
  }
  const resetUrl = `${resetBaseUrl.replace(/\/$/, '')}/auth/reset-password?token=${reset.token}`;
  await host.mail.send({ kind: 'reset', to: reset.account.email, subject: 'Reset your password',
    text: `We received a request to reset your password. Choose a new one here; the link works for one hour:\n${resetUrl}\n\nIf you did not ask for it, ignore this email.` });
}

/** One request can use a token; the account's sessions end with the change. */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  return cms().signIn.accounts.resetPassword(token, newPassword);
}

// --- Logout ----------------------------------------------------------------
/** Signing out of a site signs out of the network too, and so of every site the session reached. */
export async function logout(c: Context): Promise<{ headers: Headers }> {
  const id = getCookie(c, SESSION_COOKIE) ?? '';
  const session = id ? await cms(c).authSessions.read(id, c).catch(() => null) : null;
  const headers = await authSessions.revoke(id, c);
  if (session?.parentId) await networkFor(c.env as CmsBindings).main.authSessions.revokeByReference(session.userId, session.parentId).catch(() => false);
  return { headers };
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

/**
 * A person deletes their own account: the password confirms it, the site's only administrator
 * may not, every session ends, and the account goes with its memberships. Returns the headers
 * that clear the browser's session.
 */
export async function deleteOwnAccount(c: Context, userId: string, password: string): Promise<{ headers: Headers }> {
  if (!(await passwordMatches(userId, password))) throw new ClientVisibleError('The password is not right.');
  const host = cms();
  const me = await host.users.get(userId);
  if (!me) throw new ClientVisibleError('The account was not found.');
  if (me.permissions.includes('*')) {
    const admins = await host.users.list({ role: 'admin', limit: 2 });
    if (admins.total <= 1) throw new ClientVisibleError('You are the only administrator. Make someone else an administrator first.');
  }
  await revokeSessionsOf(c, userId);
  const { headers } = await logout(c);
  await host.users.delete(userId);
  return { headers };
}

/** How long a confirmation link lives. */
const VERIFICATION_TTL_MS = 48 * 60 * 60_000;

/**
 * Send the confirmation link, from and to the host that registered the account (this request's);
 * the token's hash in its cache names the account, and the site it registered for when that is
 * another (a network registration), until it is opened or two days pass.
 */
async function sendVerification(host: CmsHost, userId: string, email: string, name: string, site: string | null): Promise<void> {
  const origin = linkOrigin();
  if (!host.mail || !origin) return;
  const token = randomToken(32);
  await host.cache.set(`verify:${await sha256Hex(token)}`, { user: userId, ...(site ? { site } : {}) }, VERIFICATION_TTL_MS);
  const title = await host.settings.get('general.siteTitle').catch(() => '');
  await host.mail.send({ kind: 'verification', to: email, from: host.mailFrom, subject: `Confirm your email for ${title || 'the site'}`,
    text: `Hello ${name || email},\n\nConfirm your email address to finish creating your account on ${title || origin}:\n${origin.replace(/\/$/, '')}/auth/verify?token=${token}\n\nThe link works for two days. If you did not register, ignore this email.` });
}

/**
 * Open a confirmation link: the token is spent, and the account becomes active, or keeps
 * waiting for an administrator's approval (`pending`). Null for an unknown or expired link.
 */
/**
 * The email of the account a sign-in or confirmation link is for, read without spending the
 * link: its page shows it, so someone opening a link another person sent sees whose account
 * it would sign them into. Null for a link that is not valid.
 */
export async function linkAccountEmail(kind: 'magic' | 'verify', token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  const host = cms();
  const found = await host.cache.get<{ user: string }>(`${kind}:${await sha256Hex(token)}`).catch(() => undefined);
  if (!found?.user) return null;
  const user = await host.users.get(found.user).catch(() => null);
  if (user?.email) return user.email;
  const account = await host.accounts.get(found.user).catch(() => null);
  return account?.email ?? null;
}

export async function verifyEmail(token: string): Promise<{ user: string; pending: boolean; site?: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  const key = `verify:${await sha256Hex(token)}`;
  const found = await cms().cache.take<{ user: string; site?: string }>(key);
  if (!found?.user) return null;
  // A network registration for another site waits on that site: its approval, its member.
  const c = getRequestContext();
  const record = found.site && c ? await networkFor(c.env as CmsBindings).sites.get(found.site).catch(() => null) : null;
  const host = record ? networkFor(c!.env as CmsBindings).hostOf(networkSite(record)) : cms();
  if (await host.users.confirmRegistration(found.user)) return { user: found.user, pending: true };
  // Only an account still waiting for this link becomes active: one an administrator disabled (or changed) since stays as it is.
  const account = await (await host.storesOf(found.user)).accounts.get(found.user).catch(() => null);
  if (!account?.unconfirmed) return null;
  await host.users.setStatus(found.user, 'active');
  return { user: found.user, pending: false, ...(record ? { site: record.id } : {}) };
}

/**
 * Approve a member who waits for it: their account becomes active and they get an email saying
 * so. False when they were not waiting; `CMS_VALIDATION` before their email is confirmed.
 */
export async function approveRegistration(userId: string, origin: string): Promise<boolean> {
  const host = cms();
  if (!(await host.users.approve(userId))) return false;
  const user = await host.users.get(userId);
  if (user && host.mail) {
    const title = await host.settings.get('general.siteTitle').catch(() => '');
    await host.mail.send({ to: user.email, from: host.mailFrom, subject: `Your account on ${title || 'the site'} is ready`,
      text: `Hello ${user.name || user.email},\n\nAn administrator approved your account. Sign in at:\n${origin.replace(/\/$/, '')}/auth/login\n` }).catch(() => undefined);
  }
  return true;
}

/** How long a sign-in link lives. */
const MAGIC_LINK_TTL_MS = 15 * 60_000;

/**
 * Email a one-time sign-in link to an active account. Nothing says whether the email exists; a
 * flood for one address or from one client stops after a few. Without a mail sender, nothing is sent.
 */
export async function requestMagicLink(email: string, _requestOrigin?: string): Promise<void> {
  const host = cms();
  const origin = linkOrigin();
  if (!origin) return;
  const address = clientAddress();
  const allowedEmail = await host.security.attempt('magic', `e:${email.trim().toLowerCase()}`, RESET_REQUESTS.perEmail, RESET_REQUESTS.windowMs);
  const allowedAddress = await host.security.attempt('magic', `a:${address}`, RESET_REQUESTS.perAddress, RESET_REQUESTS.windowMs);
  if (!allowedEmail || !allowedAddress || !host.mail) return;
  const account = await host.signIn.accounts.findByEmail(email).catch(() => null);
  if (!account || account.status !== 'active') return;
  const token = randomToken(32);
  await host.cache.set(`magic:${await sha256Hex(token)}`, { user: account.id }, MAGIC_LINK_TTL_MS);
  const title = await host.settings.get('general.siteTitle').catch(() => '');
  await host.mail.send({ kind: 'magic-link', to: account.email, from: host.mailFrom, subject: `Sign in to ${title || 'the site'}`,
    text: `Open this link to sign in; it works once, for fifteen minutes:\n${origin}/auth/magic?token=${token}\n\nIf you did not ask for it, ignore this email.` });
}

/** Spend a sign-in link: the account's ID, or null for a link that is unknown, spent or expired. */
export async function consumeMagicLink(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  const host = cms();
  const key = `magic:${await sha256Hex(token)}`;
  // Taken in one conditional delete, so two requests with the same link cannot both sign in.
  const found = await host.cache.take<{ user: string }>(key);
  if (!found?.user) return null;
  const account = await host.signIn.accounts.get(found.user).catch(() => null);
  return account && account.status === 'active' ? account.id : null;
}
