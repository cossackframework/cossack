# Cossack Framework Auth Package

Authentication, authorization, and OAuth utilities for the Cossack Framework.
Built on [Hono](https://hono.dev) and web-standard APIs (native `fetch`, Web
Crypto), so it runs identically on Cloudflare Workers and Node.js.

## Installation

Refer to our [Installation Guide](https://cossack.dev/docs/installation) for
detailed instructions on how to set up the Cossack Framework and its packages.

## What's included

- **Session authentication** — `createAuth()` middleware that populates
  `c.get('user')`, plus a `createLoginHandler()` factory for credentials-based
  login.
- **OAuth 2.0** — `createOAuth()` with first-party providers for **GitHub,
  Google, GitLab, Facebook, and Microsoft**, plus a `defineOAuthProvider()`
  helper for any custom provider. Implements the full Authorization Code flow
  with PKCE (S256) and signed-cookie CSRF state by default.
- **Authorization** — `createAuthorizer()` returns role/permission middleware
  factories (`requireUser`, `requireRole`, `requirePermission`, plus AND/OR
  variants) driven by your own callbacks.

The package is intentionally unopinionated: it never assumes an ORM, a session
store, or a user shape. You supply the user type as a generic and a handful of
callbacks; the package handles the protocol plumbing.

---

## Session authentication

```bash
pnpm add @cossackframework/auth
```

```ts
// src/auth.ts
import { createAuth } from '@cossackframework/auth';
import { getCookie, setCookie } from 'hono/cookie';
import { db } from './db';
import type { User } from './types';

export const auth = createAuth<User>({
    extractSessionId: (c) => getCookie(c, 'session_token'),
    validateSessionId: async (token) => {
        const session = await db.sessions.findUnique({ where: { token } });
        if (!session || session.expiresAt < new Date()) return null;
        return session.userId;
    },
    resolveUserById: async (id) => (await db.users.findUnique({ where: { id } })) ?? null,

    // Optional: configure createSession once and reuse it everywhere
    // (login handler, OAuth callbacks, etc.).
    createSession: async (user) => {
        const token = crypto.randomUUID();
        await db.sessions.create({ data: { token, userId: user.id, expiresAt: tomorrow() } });
        const headers = new Headers();
        setCookie(headers, 'session_token', token, { httpOnly: true, sameSite: 'Lax', path: '/' });
        return { headers };
    },
});

export const { middleware, createLoginHandler, createSession } = auth;
```

Wire it into your app:

```ts
// src/index.ts
import { createApp } from '@cossackframework/framework';
import { middleware as authMiddleware, createLoginHandler } from './auth';

const app = createApp({ authMiddleware });
export default app;
```

See [`docs/authentication.md`](../docs/authentication.md) for the full
credentials/cookie example.

---

## OAuth (Login with GitHub, Google, ...)

The OAuth layer implements the standard **Authorization Code flow with PKCE
(S256)**. CSRF protection is built-in: a signed HttpOnly cookie carries the
random `state` nonce and PKCE `code_verifier` across the round-trip.

### 1. Register an OAuth app with your provider

Get `clientId` and `clientSecret` from the provider's developer console and set
the **authorized redirect URL** to e.g. `https://yourapp.example/auth/github/callback`.

### 2. Configure `createOAuth()`

```ts
// src/auth.ts (continue from above)
import { createOAuth } from '@cossackframework/auth';

export const oauth = createOAuth({
    secret: env.OAUTH_STATE_SECRET, // at least 16 chars; use a 32+ byte random value
    providers: {
        github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
            redirectUrl: '/auth/github/callback',
        },
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUrl: '/auth/google/callback',
            // Google-specific options (OIDC):
            provider: { hostedDomain: 'acme.com', offlineAccess: true },
        },
        gitlab: {
            clientId: env.GITLAB_CLIENT_ID,
            clientSecret: env.GITLAB_CLIENT_SECRET,
            redirectUrl: '/auth/gitlab/callback',
            provider: { baseUrl: 'https://gitlab.example.com' }, // self-hosted
        },
        microsoft: {
            clientId: env.MS_CLIENT_ID,
            clientSecret: env.MS_CLIENT_SECRET,
            redirectUrl: '/auth/microsoft/callback',
            provider: { tenant: 'consumers' }, // or 'common' (default), 'organizations', a GUID
        },
    },
});
```

### 3. Mount the redirect + callback routes

```ts
// src/index.ts
import { oauth, auth } from './auth';

// Step 1: send the user to the provider
app.get('/auth/github/redirect', oauth.redirect('github'));

// Step 2: handle the callback
app.get('/auth/github/callback', oauth.callback('github', {
    async onUser(oauthUser, tokens, c) {
        // Map the OAuth user to your local app user. Recommended: an
        // `oauth_accounts(provider, provider_user_id, user_id)` link table so
        // one user can connect multiple providers.
        const user = await users.upsertByOauthId('github', oauthUser.id, {
            name: oauthUser.name ?? oauthUser.nickname,
            email: oauthUser.email,
            avatar: oauthUser.avatar,
            githubToken: tokens.accessToken,
            githubRefreshToken: tokens.refreshToken,
        });

        // Reuse the session creator from createAuth (if you configured one):
        const { headers } = (await auth.createSession!(user, c))!;
        return c.redirect('/dashboard', { headers });
    },
    onError: async (err, c) => {
        console.error('OAuth failed:', err);
        return c.redirect('/login?error=oauth_failed');
    },
}));
```

The returned [`OAuthUser`](./src/oauth/types.ts) is normalized from the
provider's payload:

```ts
interface OAuthUser {
    id: string;            // stable, provider-scoped
    nickname?: string;     // e.g. GitHub login
    name?: string;
    email?: string | null; // null if hidden (GitHub) and unresolvable
    avatar?: string;
    raw: Record<string, unknown>; // full provider payload
}
```

### Provider quirks handled

| Provider | Quirk handled |
| --- | --- |
| **GitHub** | Falls back to `/user/emails` when the user's primary email is private. |
| **Google** | OIDC `id_token` claims preferred; `hostedDomain` (`hd`) and `offlineAccess` (`access_type=offline`) options. |
| **GitLab** | Configurable `baseUrl` for self-hosted instances; same email fallback as GitHub. |
| **Facebook** | Sends explicit `fields=id,name,email,picture` on the user-info call. |
| **Microsoft** | Configurable `tenant` (`common`/`organizations`/`consumers`/GUID); OIDC `id_token` claims. |

### Custom providers

```ts
import { createOAuth, defineOAuthProvider } from '@cossackframework/auth';

const discord = defineOAuthProvider({
    id: 'discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
    normalizeUser: (raw) => ({
        id: String(raw.id),
        nickname: raw.username as string,
        email: raw.email as string | null,
        avatar: raw.avatar
            ? `https://cdn.discordapp.com/avatars/${raw.id}/${raw.avatar}.png`
            : undefined,
        raw,
    }),
});

export const oauth = createOAuth({
    secret: env.OAUTH_STATE_SECRET,
    providers: { discord: { clientId: '...', clientSecret: '...', redirectUrl: '/auth/discord/callback' } },
    customProviders: { discord },
});
```

### Security defaults

- **PKCE (S256)** is on by default for every provider (RFC 9700 recommendation).
- **State** is a 128-bit random nonce, stored in an HttpOnly `SameSite=Lax`
  cookie signed with HMAC-SHA256, compared in **constant time**, and
  **single-use** (deleted on callback read).
- The `redirect_uri` sent on the authorize request is reused unchanged on the
  token-exchange request (exact string match).

### Stateless mode

For cookie-less API clients, pass `stateless: true` to `createOAuth()`. In
this mode **PKCE is disabled too** (the verifier cannot be recovered without a
cookie store), and **you become responsible for CSRF protection** of the
callback (e.g. by passing `state` through a signed query param you verify
yourself). Use only when cookies aren't an option — the default stateful mode
is strictly more secure.

See [`docs/oauth.md`](../docs/oauth.md) for the complete guide.

---

## Authorization (roles & permissions)

`createAuthorizer()` returns middleware factories that read `c.get('user')`
(populated by `createAuth().middleware`) and consult your callbacks. The
framework has no knowledge of how roles/permissions are stored on the user
object — you answer yes/no, the package handles the HTTP response.

```ts
// src/auth.ts (continue)
import { createAuthorizer } from '@cossackframework/auth';

export const guard = createAuthorizer<User>({
    hasRole: (user, role) => user.roles.includes(role),
    hasPermission: (user, permission) => user.permissions.includes(permission),
    onUnauthorized: (c, reason) =>
        c.redirect(reason === 'unauthenticated' ? '/login' : '/403'),
});
```

Use the guards in `@Page` middleware:

```ts
import { Page, Cossack } from '@cossackframework/core';
import { guard } from '../auth';

@Page({ middlewares: [guard.requireUser] })
export class Dashboard extends Cossack {}

@Page({ middlewares: [guard.requireRole('admin')] })
export class Admin extends Cossack {}

@Page({ middlewares: [guard.requirePermission('posts.create')] })
export class NewPost extends Cossack {}
```

Available factories:

| Factory | Semantics |
| --- | --- |
| `requireUser` | Any authenticated user. |
| `requireRole(...roles)` | User holds ANY of the roles (OR). |
| `requireAllRoles(...roles)` | User holds EVERY role (AND). |
| `requirePermission(perm, resource?)` | User holds the permission, optionally against a domain object. |
| `requireAllPermissions(...perms)` | User holds EVERY permission (AND). |

For **conditional UI** (show/hide elements inside `render()`), use the boolean
helpers on the same kit: `guard.can(c, permission)`, `guard.hasRole(c, role)`,
plus their `Async` variants for DB-backed checks. See
[`docs/authorization.md`](../docs/authorization.md#conditional-ui-in-render)
for the inline-sync and `init()`/`@State` patterns.

Default failure responses are `401 JSON` (unauthenticated) and `403 JSON`
(forbidden); override both via `onUnauthorized`.

Works identically for session login and OAuth login — both populate
`c.get('user')`.

See [`docs/authorization.md`](../docs/authorization.md) for more.

---

## Running the tests

```sh
cd packages/auth && pnpm vitest --run
```

## License

MIT
