import type { Context, MiddlewareHandler } from 'hono';

/**
 * Reasons a request might be considered unauthorized. Used by the
 * {@link AuthorizerOptions.onUnauthorized} callback to differentiate.
 */
export type UnauthorizedReason = 'unauthenticated' | 'forbidden';

export interface AuthorizerOptions<User> {
    /**
     * Decide whether the user has a role. The user object is whatever was set
     * on `c.get('user')` by an upstream authentication middleware.
     */
    hasRole?: (user: User, role: string, c: Context) => boolean | Promise<boolean>;
    /**
     * Decide whether the user has a permission, optionally against a resource.
     * The resource argument lets callers pass a domain object (e.g. a blog
     * post the user is trying to edit) into the check.
     */
    hasPermission?: (
        user: User,
        permission: string,
        resource: unknown | undefined,
        c: Context,
    ) => boolean | Promise<boolean>;
    /**
     * Produce the response when access is denied. Default:
     *  - unauthenticated -> 401 JSON
     *  - forbidden       -> 403 JSON
     * A common override is to redirect to `/login` for browser flows.
     */
    onUnauthorized?: (c: Context, reason: UnauthorizedReason) => Response | Promise<Response>;
}

export interface AuthorizerKit {
    /** Middleware that requires an authenticated user; denies otherwise. */
    requireUser: MiddlewareHandler;
    /** Middleware that requires the user to hold ANY of the given roles. */
    requireRole: (...roles: string[]) => MiddlewareHandler;
    /** Middleware that requires the user to hold ALL of the given roles. */
    requireAllRoles: (...roles: string[]) => MiddlewareHandler;
    /** Middleware that requires a single permission (optionally for a resource). */
    requirePermission: (permission: string, resource?: unknown) => MiddlewareHandler;
    /** Middleware that requires ALL of the given permissions. */
    requireAllPermissions: (
        ...permissions: string[]
    ) => MiddlewareHandler;
}

function defaultOnUnauthorized(c: Context, reason: UnauthorizedReason): Response {
    if (reason === 'unauthenticated') {
        return c.json({ error: 'Authentication required' }, 401);
    }
    return c.json({ error: 'Forbidden' }, 403);
}

/**
 * Create an authorization kit backed by developer-supplied callbacks.
 *
 * The kit is intentionally unopinionated: the framework has no knowledge of
 * how roles/permissions are stored on the user object. The callbacks receive
 * the authenticated user (whatever was placed on `c.get('user')` by an
 * upstream authentication middleware such as `createAuth().middleware`) and
 * must answer yes/no.
 *
 * Works identically for session login and OAuth login — both populate
 * `c.get('user')`.
 *
 * @example
 * ```ts
 * const guard = createAuthorizer<User>({
 *   hasRole: (u, role) => u.roles.includes(role),
 *   hasPermission: (u, perm) => u.permissions.includes(perm),
 *   onUnauthorized: (c, reason) =>
 *     c.redirect(reason === 'unauthenticated' ? '/login' : '/403'),
 * });
 *
 * @Page({ middlewares: [guard.requireUser] })
 * @Page({ middlewares: [guard.requireRole('admin')] })
 * @Page({ middlewares: [guard.requirePermission('posts.create')] })
 * ```
 */
export function createAuthorizer<User>(options: AuthorizerOptions<User>): AuthorizerKit {
    const onUnauthorized = options.onUnauthorized ?? defaultOnUnauthorized;

    async function getUser(c: Context): Promise<User | undefined> {
        return c.get('user') as User | undefined;
    }

    const requireUser: MiddlewareHandler = async (c, next) => {
        const user = await getUser(c);
        if (!user) return onUnauthorized(c, 'unauthenticated');
        await next();
    };

    const requireRole =
        (...roles: string[]): MiddlewareHandler =>
        async (c, next) => {
            const user = await getUser(c);
            if (!user) return onUnauthorized(c, 'unauthenticated');
            if (roles.length === 0) {
                await next();
                return;
            }
            if (!options.hasRole) {
                return onUnauthorized(c, 'forbidden');
            }
            // OR semantics: any role match grants access.
            for (const role of roles) {
                if (await options.hasRole(user, role, c)) {
                    await next();
                    return;
                }
            }
            return onUnauthorized(c, 'forbidden');
        };

    const requireAllRoles =
        (...roles: string[]): MiddlewareHandler =>
        async (c, next) => {
            const user = await getUser(c);
            if (!user) return onUnauthorized(c, 'unauthenticated');
            if (roles.length === 0) {
                await next();
                return;
            }
            if (!options.hasRole) {
                return onUnauthorized(c, 'forbidden');
            }
            for (const role of roles) {
                if (!(await options.hasRole(user, role, c))) {
                    return onUnauthorized(c, 'forbidden');
                }
            }
            await next();
        };

    const requirePermission =
        (permission: string, resource?: unknown): MiddlewareHandler =>
        async (c, next) => {
            const user = await getUser(c);
            if (!user) return onUnauthorized(c, 'unauthenticated');
            if (!options.hasPermission) {
                return onUnauthorized(c, 'forbidden');
            }
            if (!(await options.hasPermission(user, permission, resource, c))) {
                return onUnauthorized(c, 'forbidden');
            }
            await next();
        };

    const requireAllPermissions =
        (...permissions: string[]): MiddlewareHandler =>
        async (c, next) => {
            const user = await getUser(c);
            if (!user) return onUnauthorized(c, 'unauthenticated');
            if (permissions.length === 0) {
                await next();
                return;
            }
            if (!options.hasPermission) {
                return onUnauthorized(c, 'forbidden');
            }
            for (const permission of permissions) {
                if (!(await options.hasPermission(user, permission, undefined, c))) {
                    return onUnauthorized(c, 'forbidden');
                }
            }
            await next();
        };

    return {
        requireUser,
        requireRole,
        requireAllRoles,
        requirePermission,
        requireAllPermissions,
    };
}
