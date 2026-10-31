/**
 * Auth integration: `@cossackframework/auth` primitives backed by CMS users and RomeDB
 * auth sessions. The request user is a CMS principal resolved from current storage.
 */
import { createAuth, createSessionManager, type AuthKit, type AuthRealtimeProvider, type AuthSessionManager } from '@cossackframework/auth';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { ANONYMOUS, userPrincipal, type Principal } from '../permissions';
import type { CmsHost } from './host';
import type { CmsUser } from './users';

/** The user placed on the request context by the auth middleware. */
export interface CmsRequestUser extends CmsUser {
    readonly principal: Principal;
}

export interface CmsAuth {
    readonly sessions: AuthSessionManager;
    /** Realtime descriptor provider: a stable session reference plus a token fingerprint. */
    readonly realtime: AuthRealtimeProvider;
    readonly auth: AuthKit<CmsRequestUser>;
    readonly cookieName: string;
    /** Sign in with email and password; returns the cookie headers to apply, or null. */
    signIn(email: string, password: string, c: Context): Promise<{ user: CmsRequestUser; headers: Headers } | null>;
    signOut(c: Context): Promise<Headers>;
    /** The principal of the current request: the signed-in user, or anonymous. */
    principal(c: Context): Principal;
}

export interface CmsAuthOptions {
    /** Session lifetime in seconds. Default 7 days. */
    ttlSeconds?: number;
    cookieName?: string;
    secure?: boolean;
}

const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');

export function createCmsAuth(cms: CmsHost, options: CmsAuthOptions = {}): CmsAuth {
    const cookieName = options.cookieName ?? 'cms_session';
    const sessions = createSessionManager({
        store: cms.authSessions,
        ttlSeconds: options.ttlSeconds ?? 7 * 24 * 60 * 60,
        cookie: { name: cookieName, ...(options.secure === undefined ? {} : { secure: options.secure }) },
        now: () => cms.now(),
    });
    const resolve = async (userId: string): Promise<CmsRequestUser | null> => {
        const user = await cms.users.get(userId);
        if (!user || user.status !== 'active') return null;
        return Object.freeze({ ...user, principal: userPrincipal(user.id, user.roles, user.permissions) });
    };
    const realtime: AuthRealtimeProvider = {
        key: 'cossack.session',
        // The public reference survives rotation; the fingerprint does not.
        capture: async sessionId => ({ reference: await cms.authSessions.publicReference(sessionId), fingerprint: await sha256(sessionId) }),
        validate: async data => {
            const descriptor = data as { reference?: unknown; fingerprint?: unknown };
            if (typeof descriptor?.reference !== 'string' || typeof descriptor.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.fingerprint)) return null;
            const row = await cms.authSessions.findByReference(descriptor.reference);
            if (!row || row.expiresAt <= cms.now() || await sha256(row.id) !== descriptor.fingerprint) return null;
            return row.userId;
        },
    };
    const auth = createAuth<CmsRequestUser>({
        extractSessionId: c => getCookie(c, cookieName),
        validateSessionId: async (id, c) => (await sessions.validate(id, c))?.userId ?? null,
        resolveUserById: id => resolve(id),
        createSession: async (user, c) => ({ headers: (await sessions.create(user.id, c)).headers }),
        realtime,
    });
    return {
        sessions,
        realtime,
        auth,
        cookieName,
        async signIn(email, password, c) {
            const verified = await cms.users.verifier.verify(email, password);
            if (!verified || verified.status !== 'active') return null;
            const user = (await resolve(verified.id))!;
            return { user, headers: (await sessions.create(user.id, c)).headers };
        },
        async signOut(c) {
            const id = getCookie(c, cookieName);
            return id ? sessions.revoke(id, c) : sessions.expiredCookie();
        },
        principal(c) {
            return (c.get('user') as CmsRequestUser | undefined)?.principal ?? ANONYMOUS;
        },
    };
}
