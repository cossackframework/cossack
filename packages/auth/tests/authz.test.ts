import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuthorizer, type AuthorizerOptions } from '../src/authz';

interface User {
    id: string;
    roles: string[];
    permissions: string[];
}

const baseOpts: AuthorizerOptions<User> = {
    hasRole: (u, role) => u.roles.includes(role),
    hasPermission: (u, perm) => u.permissions.includes(perm),
};

function buildApp(
    user: User | undefined,
    kit: ReturnType<typeof createAuthorizer<User>>,
    middleware: import('hono').MiddlewareHandler,
) {
    const app = new Hono<{ Variables: { user?: User } }>();
    app.use('*', async (c, next) => {
        if (user) c.set('user', user);
        await next();
    });
    app.use('/protected', middleware);
    app.get('/protected', (c) => c.json({ ok: true, userId: user?.id ?? null }));
    return app;
}

async function run(middleware: import('hono').MiddlewareHandler, user: User | undefined) {
    const app = buildApp(user, createAuthorizer<User>(baseOpts), middleware);
    return app.request('/protected');
}

describe('createAuthorizer — requireUser', () => {
    it('allows authenticated requests', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(guard.requireUser, { id: 'u1', roles: [], permissions: [] });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { userId: string }).userId).toBe('u1');
    });

    it('denies unauthenticated requests with 401 by default', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(guard.requireUser, undefined);
        expect(res.status).toBe(401);
        expect(((await res.json()) as { error: string }).error).toMatch(/Authentication required/);
    });

    it('uses onUnauthorized override', async () => {
        const guard = createAuthorizer<User>({
            ...baseOpts,
            onUnauthorized: (c, reason) =>
                c.redirect(reason === 'unauthenticated' ? '/login' : '/403'),
        });
        const res = await run(guard.requireUser, undefined);
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/login');
    });
});

describe('createAuthorizer — requireRole (OR semantics)', () => {
    it('allows when user has any of the required roles', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requireRole('admin', 'editor'),
            { id: 'u', roles: ['editor'], permissions: [] },
        );
        expect(res.status).toBe(200);
    });

    it('denies with 403 when user lacks all roles', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requireRole('admin'),
            { id: 'u', roles: ['viewer'], permissions: [] },
        );
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toMatch(/Forbidden/);
    });

    it('denies with 401 when unauthenticated', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(guard.requireRole('admin'), undefined);
        expect(res.status).toBe(401);
    });

    it('allows everything when no roles required', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(guard.requireRole(), { id: 'u', roles: [], permissions: [] });
        expect(res.status).toBe(200);
    });
});

describe('createAuthorizer — requireAllRoles (AND semantics)', () => {
    it('allows when user has every required role', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requireAllRoles('admin', 'billing'),
            { id: 'u', roles: ['admin', 'billing', 'other'], permissions: [] },
        );
        expect(res.status).toBe(200);
    });

    it('denies with 403 when any role is missing', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requireAllRoles('admin', 'billing'),
            { id: 'u', roles: ['admin'], permissions: [] },
        );
        expect(res.status).toBe(403);
    });
});

describe('createAuthorizer — requirePermission', () => {
    it('allows when the user has the permission', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requirePermission('posts.create'),
            { id: 'u', roles: [], permissions: ['posts.create'] },
        );
        expect(res.status).toBe(200);
    });

    it('denies with 403 when the permission is missing', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requirePermission('posts.delete'),
            { id: 'u', roles: [], permissions: ['posts.create'] },
        );
        expect(res.status).toBe(403);
    });

    it('forwards the resource argument to hasPermission', async () => {
        const calls: Array<{ user: User; permission: string; resource: unknown }> = [];
        const hasPermission: AuthorizerOptions<User>['hasPermission'] = async (
            user,
            permission,
            resource,
        ) => {
            calls.push({ user, permission, resource });
            return true;
        };
        const guard = createAuthorizer<User>({ ...baseOpts, hasPermission });
        const resource = { ownerId: 'u' };
        await run(guard.requirePermission('posts.edit', resource), {
            id: 'u',
            roles: [],
            permissions: [],
        });
        expect(calls).toHaveLength(1);
        expect(calls[0].permission).toBe('posts.edit');
        expect(calls[0].resource).toBe(resource);
    });
});

describe('createAuthorizer — requireAllPermissions', () => {
    it('allows when user has every permission', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requireAllPermissions('posts.create', 'posts.publish'),
            { id: 'u', roles: [], permissions: ['posts.create', 'posts.publish'] },
        );
        expect(res.status).toBe(200);
    });

    it('denies with 403 when any permission is missing', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const res = await run(
            guard.requireAllPermissions('posts.create', 'posts.publish'),
            { id: 'u', roles: [], permissions: ['posts.create'] },
        );
        expect(res.status).toBe(403);
    });
});

describe('createAuthorizer — async checks', () => {
    it('awaits async hasRole callbacks', async () => {
        const guard = createAuthorizer<User>({
            hasRole: async (u, role) => {
                await new Promise((r) => setTimeout(r, 1));
                return u.roles.includes(role);
            },
        });
        const res = await run(
            guard.requireRole('admin'),
            { id: 'u', roles: ['admin'], permissions: [] },
        );
        expect(res.status).toBe(200);
    });
});

describe('createAuthorizer — missing callbacks', () => {
    it('requireRole denies (403) when hasRole is not provided', async () => {
        const guard = createAuthorizer<User>({});
        const res = await run(
            guard.requireRole('admin'),
            { id: 'u', roles: [], permissions: [] },
        );
        expect(res.status).toBe(403);
    });

    it('requirePermission denies (403) when hasPermission is not provided', async () => {
        const guard = createAuthorizer<User>({});
        const res = await run(
            guard.requirePermission('x'),
            { id: 'u', roles: [], permissions: [] },
        );
        expect(res.status).toBe(403);
    });
});

describe('createAuthorizer — boolean helpers (can / hasRole)', () => {
    async function ctxWith(user: User | undefined): Promise<import('hono').Context> {
        const app = new Hono<{ Variables: { user?: User } }>();
        let captured: import('hono').Context | undefined;
        app.get('/x', (c) => {
            if (user) c.set('user', user);
            captured = c;
            return c.body(null);
        });
        await app.request('/x');
        return captured!;
    }

    it('can() returns true when the user has the permission', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const c = await ctxWith({ id: 'u', roles: [], permissions: ['posts.create'] });
        expect(guard.can(c, 'posts.create')).toBe(true);
    });

    it('can() returns false when the user lacks the permission', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const c = await ctxWith({ id: 'u', roles: [], permissions: ['posts.read'] });
        expect(guard.can(c, 'posts.create')).toBe(false);
    });

    it('can() returns false when there is no user', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const c = await ctxWith(undefined);
        expect(guard.can(c, 'posts.create')).toBe(false);
    });

    it('can() returns false when hasPermission is not configured', async () => {
        const guard = createAuthorizer<User>({});
        const c = await ctxWith({ id: 'u', roles: [], permissions: [] });
        expect(guard.can(c, 'posts.create')).toBe(false);
    });

    it('can() forwards the resource argument', async () => {
        const seen: unknown[] = [];
        const guard = createAuthorizer<User>({
            hasPermission: (user, perm, resource) => {
                seen.push({ user, perm, resource });
                return true;
            },
        });
        const c = await ctxWith({ id: 'u', roles: [], permissions: [] });
        const resource = { id: 'p1' };
        guard.can(c, 'posts.edit', resource);
        expect(seen[0]).toEqual({ user: { id: 'u', roles: [], permissions: [] }, perm: 'posts.edit', resource });
    });

    it('can() throws when the callback returns a Promise', async () => {
        const guard = createAuthorizer<User>({
            hasPermission: async () => true,
        });
        const c = await ctxWith({ id: 'u', roles: [], permissions: [] });
        expect(() => guard.can(c, 'x')).toThrow(/received a Promise/);
    });

    it('hasRole() returns true when the user holds any of the roles (OR)', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const c = await ctxWith({ id: 'u', roles: ['editor'], permissions: [] });
        expect(guard.hasRole(c, 'admin', 'editor')).toBe(true);
        expect(guard.hasRole(c, 'admin')).toBe(false);
    });

    it('hasRole() returns false when there is no user', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const c = await ctxWith(undefined);
        expect(guard.hasRole(c, 'admin')).toBe(false);
    });
});

describe('createAuthorizer — async helpers (canAsync / hasRoleAsync)', () => {
    async function ctxWith(user: User | undefined): Promise<import('hono').Context> {
        const app = new Hono<{ Variables: { user?: User } }>();
        let captured: import('hono').Context | undefined;
        app.get('/x', (c) => {
            if (user) c.set('user', user);
            captured = c;
            return c.body(null);
        });
        await app.request('/x');
        return captured!;
    }

    it('canAsync() awaits a DB-backed callback', async () => {
        const guard = createAuthorizer<User>({
            hasPermission: async (user, perm) => {
                await new Promise((r) => setTimeout(r, 1));
                return user.id === 'u' && perm === 'posts.delete';
            },
        });
        const c = await ctxWith({ id: 'u', roles: [], permissions: [] });
        expect(await guard.canAsync(c, 'posts.delete')).toBe(true);
        expect(await guard.canAsync(c, 'posts.create')).toBe(false);
    });

    it('canAsync() returns false when there is no user', async () => {
        const guard = createAuthorizer<User>(baseOpts);
        const c = await ctxWith(undefined);
        expect(await guard.canAsync(c, 'posts.create')).toBe(false);
    });

    it('hasRoleAsync() awaits and returns true on any role match', async () => {
        const guard = createAuthorizer<User>({
            hasRole: async (u, role) => {
                await new Promise((r) => setTimeout(r, 1));
                return u.roles.includes(role);
            },
        });
        const c = await ctxWith({ id: 'u', roles: ['admin'], permissions: [] });
        expect(await guard.hasRoleAsync(c, 'admin', 'editor')).toBe(true);
        expect(await guard.hasRoleAsync(c, 'editor')).toBe(false);
    });
});
