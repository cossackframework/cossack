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

    // --- Boolean helpers (for conditional UI / imperative checks) ---
    // These complement the route-protection middleware: use them inside
    // render(), event handlers, or anywhere you need a yes/no answer instead
    // of an HTTP response. They read the user from `c.get('user')` and return
    // `false` when unauthenticated (never throw for that case).

    /**
     * Synchronous boolean permission check. Returns `false` when there is no
     * user or the user lacks the permission.
     *
     * Throws if the configured `hasPermission` callback returns a Promise —
     * sync render cannot await it. Use {@link AuthorizerKit.canAsync} (from
     * `init()`) for DB-backed checks.
     *
     * @example
     * ```ts
     * render() {
     *   return html`${guard.can(this.c, 'posts.create')
     *     ? html`<button @click=${this.createPost}>New Post</button>`
     *     : ''}`;
     * }
     * ```
     */
    can: (c: Context, permission: string, resource?: unknown) => boolean;
    /**
     * Synchronous boolean role check (any of). Returns `false` when there is
     * no user or the user holds none of the roles. Throws if `hasRole` is async.
     */
    hasRole: (c: Context, ...roles: string[]) => boolean;
    /**
     * Async permission check. Use from `init()` and store the result in
     * `@State` so it syncs to the client and survives re-renders.
     *
     * @example
     * ```ts
     * @State() canDelete = false;
     * async init() { this.canDelete = await guard.canAsync(this.c, 'posts.delete'); }
     * ```
     */
    canAsync: (c: Context, permission: string, resource?: unknown) => Promise<boolean>;
    /** Async role check (any of). */
    hasRoleAsync: (c: Context, ...roles: string[]) => Promise<boolean>;
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

    // --- Boolean helpers (see interface docstrings above) ---

    const ensureSync = (
        result: boolean | Promise<boolean>,
        helper: string,
    ): boolean => {
        if (
            result &&
            typeof (result as Promise<boolean> | unknown) === 'object' &&
            typeof (result as Promise<boolean>).then === 'function'
        ) {
            throw new Error(
                `createAuthorizer: guard.${helper}() received a Promise from its callback. ` +
                    `Sync render cannot await it — either make the callback synchronous, or use ` +
                    `guard.${helper}Async() from init() and store the result in @State.`,
            );
        }
        return result as boolean;
    };

    const can = (c: Context, permission: string, resource?: unknown): boolean => {
        const user = c.get('user') as User | undefined;
        if (!user || !options.hasPermission) return false;
        return ensureSync(options.hasPermission(user, permission, resource, c), 'can');
    };

    const hasRole = (c: Context, ...roles: string[]): boolean => {
        const user = c.get('user') as User | undefined;
        if (!user || !options.hasRole || roles.length === 0) return false;
        for (const role of roles) {
            if (ensureSync(options.hasRole(user, role, c), 'hasRole')) return true;
        }
        return false;
    };

    const canAsync = async (
        c: Context,
        permission: string,
        resource?: unknown,
    ): Promise<boolean> => {
        const user = c.get('user') as User | undefined;
        if (!user || !options.hasPermission) return false;
        return options.hasPermission(user, permission, resource, c);
    };

    const hasRoleAsync = async (c: Context, ...roles: string[]): Promise<boolean> => {
        const user = c.get('user') as User | undefined;
        if (!user || !options.hasRole || roles.length === 0) return false;
        for (const role of roles) {
            if (await options.hasRole(user, role, c)) return true;
        }
        return false;
    };

    return {
        requireUser,
        requireRole,
        requireAllRoles,
        requirePermission,
        requireAllPermissions,
        can,
        hasRole,
        canAsync,
        hasRoleAsync,
    };
}
