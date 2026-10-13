import type { Context, MiddlewareHandler } from 'hono';

/** Server-only, JSON descriptor. Never put a bearer credential in data. */
export interface AuthRealtimeIdentity {
    version: 1;
    provider: string;
    data: unknown;
}

export interface AuthRealtimeProvider {
    /** Stable application-owned name for descriptor validation. */
    key: string;
    capture: (sessionId: string, userId: string, c: Context) => unknown | Promise<unknown>;
    /** Check the descriptor against current storage and return its current owner. */
    validate: (data: unknown, c: Context) => Promise<string | null>;
}

export interface AuthProvider<User> {
    extractSessionId: (c: Context) => string | undefined | Promise<string | undefined>;
    validateSessionId: (sessionId: string, c: Context) => Promise<string | null>;
    resolveUserById: (userId: string, c: Context) => Promise<User | null>;
    /**
     * Optional session creator. When provided here, it is exposed on the kit
     * (`auth.createSession`) so it can be reused by OAuth callbacks (or any
     * other code path) without having to be supplied again.
     */
    createSession?: (user: User, c: Context) => Promise<{ headers: Headers }>;
    realtime?: AuthRealtimeProvider;
}

export type SessionCreator<User> = (user: User, c: Context) => Promise<{ headers: Headers }>;

export type LoginHandlerOptions<User> = {
    validateCredentials: (credentials: any, c: Context) => Promise<User | null>;
    /**
     * Per-call session creator. Overrides any `createSession` configured on
     * the {@link AuthProvider} for this login handler. Omit to use the provider.
     */
    createSession?: SessionCreator<User>;
};

export type AuthKit<User> = {
    middleware: MiddlewareHandler<{ Variables: {
        user?: User;
        'cossack.realtimeIdentity'?: unknown;
        'cossack.captureRealtimeIdentity'?: () => Promise<AuthRealtimeIdentity>;
    } }>;
    /**
     * Credentials login route. Requires `Content-Type: application/json`
     * (415 otherwise) and a JSON object body (400 otherwise). Rejects
     * cross-site requests with 403: `Sec-Fetch-Site` must be `same-origin`,
     * `same-site`, `none` or absent, and a present `Origin` must match the
     * request origin.
     */
    createLoginHandler: (options: LoginHandlerOptions<User>) => MiddlewareHandler;
    /**
     * The session creator configured on the provider, if any. Reusable by any
     * authentication path (login handler, OAuth callback, custom flows).
     */
    createSession?: SessionCreator<User>;
};

/**
 * Login CSRF guard. Browsers send `Sec-Fetch-Site` and `Origin` on
 * cross-site POSTs; non-browser clients usually send neither. A present
 * `Origin` must equal the request origin (or its https form behind a
 * TLS-terminating proxy that sets `X-Forwarded-Proto: https`).
 */
function isSameOriginRequest(c: Context): boolean {
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && !['same-origin', 'same-site', 'none'].includes(site.toLowerCase())) return false;
    const origin = c.req.header('origin');
    if (origin === undefined) return true;
    let url: URL;
    try { url = new URL(c.req.url); } catch { return false; }
    if (origin === url.origin) return true;
    return c.req.header('x-forwarded-proto')?.toLowerCase() === 'https' && origin === `https://${url.host}`;
}

/** Only `application/json` (with optional parameters). Forms cannot send it cross-site without CORS preflight. */
function isJsonContentType(value: string | undefined): boolean {
    return value !== undefined && value.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

/**
 * Creates an Auth Kit backed by the given {@link AuthProvider}.
 *
 * The kit exposes:
 *  - `middleware`: populates `c.get('user')` on every request.
 *  - `createLoginHandler`: builds a credentials-based login route.
 *  - `createSession`: the reusable session creator (if configured on the provider).
 */
export function createAuth<User>(provider: AuthProvider<User>): AuthKit<User> {
    if (provider.realtime && (typeof provider.realtime.key !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(provider.realtime.key))) {
        throw new TypeError('Realtime auth needs a stable provider key.');
    }
    const middleware: AuthKit<User>['middleware'] = async (c, next) => {
        // A reused context must not retain an earlier identity after failure.
        c.set('user', undefined);
        c.set('cossack.captureRealtimeIdentity', undefined);
        const restored: unknown = c.get('cossack.realtimeIdentity');
        if (restored !== undefined) {
            const matchesProvider = provider.realtime && restored && typeof restored === 'object' &&
                !Array.isArray(restored) && (restored as AuthRealtimeIdentity).version === 1 &&
                (restored as AuthRealtimeIdentity).provider === provider.realtime.key && Object.hasOwn(restored, 'data');
            try {
                const userId = matchesProvider
                    ? await provider.realtime!.validate((restored as AuthRealtimeIdentity).data, c) : null;
                if (userId) c.set('user', await provider.resolveUserById(userId, c) ?? undefined);
            } catch {
                console.warn('[Cossack Auth] COSSACK_AUTH_REALTIME_VALIDATION_FAILED: continuing as guest. Check realtime session storage.');
            }
            return await next();
        }
        let sessionId: string | undefined;
        try { sessionId = await provider.extractSessionId(c); }
        catch {
            console.warn('[Cossack Auth] COSSACK_AUTH_SESSION_EXTRACTION_FAILED: continuing as guest. Check session extraction.');
            return await next();
        }
        if (!sessionId) {
            return await next();
        }

        // Degrade to guest on any provider error rather than surfacing a 500.
        // The provider's validateSessionId/resolveUserById typically query the
        // database (e.g. a `sessions` table); if the DB is unreachable or the
        // schema is not yet migrated, the request must still render. A stale or
        // corrupt session cookie should never take down every route — the user
        // is simply treated as logged out, and the cookie will be ignored until
        // it expires or is overwritten on the next successful login.
        let userId: string | null;
        try {
            userId = await provider.validateSessionId(sessionId, c);
        } catch {
            console.warn('[Cossack Auth] COSSACK_AUTH_SESSION_VALIDATION_FAILED: continuing as guest. Check session storage and validation.');
            return await next();
        }
        if (!userId) {
            return await next();
        }

        let user: User | null;
        try {
            user = await provider.resolveUserById(userId, c);
        } catch {
            console.warn('[Cossack Auth] COSSACK_AUTH_USER_RESOLUTION_FAILED: continuing as guest. Check user lookup.');
            return await next();
        }
        if (user) {
            c.set('user', user);
            if (provider.realtime) {
                c.set('cossack.captureRealtimeIdentity', async (): Promise<AuthRealtimeIdentity> => ({
                    version: 1, provider: provider.realtime!.key,
                    data: await provider.realtime!.capture(sessionId!, userId!, c),
                }));
            }
        }

        await next();
    };

    const createLoginHandler = (loginOptions: LoginHandlerOptions<User>): MiddlewareHandler => {
        return async (c: Context) => {
            if (!isSameOriginRequest(c)) {
                return c.json({ error: 'Cross-site login requests are not allowed' }, 403);
            }
            if (!isJsonContentType(c.req.header('content-type'))) {
                return c.json({ error: 'Login requires Content-Type: application/json' }, 415);
            }
            let credentials: unknown;
            try { credentials = await c.req.json(); }
            catch { return c.json({ error: 'Malformed JSON body' }, 400); }
            if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
                return c.json({ error: 'Credentials must be a JSON object' }, 400);
            }
            const user = await loginOptions.validateCredentials(credentials, c);

            if (!user) {
                return c.json({ error: 'Invalid credentials' }, 401);
            }

            const sessionCreator = loginOptions.createSession ?? provider.createSession;
            if (!sessionCreator) {
                return c.json(
                    { error: 'No createSession configured: provide it in LoginHandlerOptions or on the AuthProvider.' },
                    500,
                );
            }
            const { headers } = await sessionCreator(user, c);
            const response = c.json({ success: true });

            headers.forEach((value, key) => {
                response.headers.append(key, value);
            });

            return response;
        };
    };

    return { middleware, createLoginHandler, createSession: provider.createSession };
}
