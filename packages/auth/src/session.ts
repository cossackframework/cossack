import type { Context, MiddlewareHandler } from 'hono';

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
}

export type SessionCreator<User> = (user: User, c: Context) => Promise<{ headers: Headers }>;

export type LoginHandlerOptions<User> = {
    validateCredentials: (credentials: any, c: Context) => Promise<User | null>;
    /**
     * Per-call session creator. Overrides any `createSession` configured on
     * the {@link AuthProvider} for this login handler.
     */
    createSession: SessionCreator<User>;
};

export type AuthKit<User> = {
    middleware: MiddlewareHandler<{ Variables: { user?: User } }>;
    createLoginHandler: (options: LoginHandlerOptions<User>) => MiddlewareHandler;
    /**
     * The session creator configured on the provider, if any. Reusable by any
     * authentication path (login handler, OAuth callback, custom flows).
     */
    createSession?: SessionCreator<User>;
};

/**
 * Creates an Auth Kit backed by the given {@link AuthProvider}.
 *
 * The kit exposes:
 *  - `middleware`: populates `c.get('user')` on every request.
 *  - `createLoginHandler`: builds a credentials-based login route.
 *  - `createSession`: the reusable session creator (if configured on the provider).
 */
export function createAuth<User>(provider: AuthProvider<User>): AuthKit<User> {
    const middleware: MiddlewareHandler<{ Variables: { user?: User } }> = async (c, next) => {
        const sessionId = await provider.extractSessionId(c);
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
        } catch (err) {
            console.warn('[Cossack Auth] validateSessionId threw — treating as guest:', err);
            return await next();
        }
        if (!userId) {
            return await next();
        }

        let user: User | null;
        try {
            user = await provider.resolveUserById(userId, c);
        } catch (err) {
            console.warn('[Cossack Auth] resolveUserById threw — treating as guest:', err);
            return await next();
        }
        if (user) {
            c.set('user', user);
        }

        await next();
    };

    const createLoginHandler = (loginOptions: LoginHandlerOptions<User>): MiddlewareHandler => {
        return async (c: Context) => {
            const credentials = await c.req.json();
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
