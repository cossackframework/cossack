# Cossack Framework Auth Package

This package provides authentication, authorization, and OAuth tools for
Cossack. It uses [Hono](https://hono.dev) and web APIs such as `fetch` and Web
Crypto. It runs on Cloudflare Workers and Node.js.

## Installation

See the [Installation Guide](https://cossack.dev/docs/installation) to set up
Cossack and its packages.

## What is included

- Session authentication: `createAuth()` middleware that populates
 `c.get('user')`, plus a `createLoginHandler()` factory for JSON credentials-based
 login. It rejects cross-site requests (403), non-JSON content types (415) and
 malformed bodies (400).
- OAuth 2.0: `createOAuth()` with first-party providers for GitHub,
 Google, GitLab, Facebook, and Microsoft, plus a `defineOAuthProvider()`
 helper for any custom provider. It implements the full Authorization Code flow
 with PKCE (S256), signed-cookie CSRF state, and required atomic state storage
 for cookie flows.
- Authorization: `createAuthorizer()` returns role/permission middleware
 factories (`requireUser`, `requireRole`, `requirePermission`, plus AND/OR
 variants) driven by your own callbacks.

The package is unopinionated. It never assumes an ORM, a session
store, or a user shape. You supply the user type as a generic and a handful of
callbacks. The package handles the protocol plumbing.

---

## Session authentication

Run `pnpm exec cossack add auth` in a Cossack application. The recipe creates
`src/auth.ts`, user/session models, login and registration pages, password reset
and session middleware. Register generated middleware through
`src/bootstrap/middlewares.ts`.

The generated auth module composes these public APIs:

- `createPasswordHasher`, `hashPassword` and `verifyPassword` encode the work
  factor and reject malformed hashes before derivation.
- `createCredentialVerifier` uses typed account lookup, safe user mapping and
  optional atomic password-hash upgrades.
- `createSessionManager` owns tokens, absolute expiry, rotation, revocation and
  matching cookie headers through an application-owned `AuthSessionStore`.
- `createAuth` populates `c.get('user')` and exposes `createLoginHandler` and an
  optional `createSession` for credentials, OAuth and server methods.

Apply returned session headers to the response after storage succeeds. The
application owns persistence and atomic conditional writes. Default session
cookies are Secure, HttpOnly and SameSite=Lax. Validation does not refresh
expiry. Password-reset tokens remain a separate purpose.

Read [credential and session primitives](../../docs/auth-primitives.md) for
configuration, typed composition and the password-format migration. See
[authentication](../../docs/authentication.md) for middleware and page wiring.
The packaged `credential-and-session-primitives` agent guide includes an
executable example from the installed package.

---

## OAuth (Login with GitHub, Google,...)

The OAuth layer implements the standard Authorization Code flow with PKCE
(S256). CSRF protection is built in. A signed HttpOnly cookie carries the
random `state` nonce and the PKCE `code_verifier` across the round-trip.

### 1. Register an OAuth app with your provider

Get `clientId` and `clientSecret` from the developer console of the provider.
Set the authorized redirect URL to an address such as
`https://yourapp.example/auth/github/callback`.

### 2. Configure `createOAuth()`

Cookie flows require application-owned `OAuthStateStore` callbacks. The generated
auth module exports `oauthStateStore`, which inserts anonymous state-purpose rows
and consumes them through one conditional SQL delete. Handwritten applications
must provide the same atomic create/consume contract. See
[atomic state storage](../../docs/oauth.md#atomic-state-storage).

```ts
// src/auth.ts (continue from above)
import { createOAuth } from '@cossackframework/auth';

export const oauth = createOAuth({
    stateStore: oauthStateStore, // application-owned atomic create/consume callbacks
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
        console.error('OAuth failed:', err.toJSON());
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
    email?: string | null; // only a provider-verified address, else null/absent
    emailVerified?: boolean; // true only when the provider asserted ownership
    avatar?: string;
    raw: Record<string, unknown>; // full provider payload
}
```

### Provider quirks handled

| Provider | Quirk handled |
| --- | --- |
| GitHub | Confirms the email against `/user/emails`; returns only a verified address (profile email or verified primary). |
| Google | OIDC `id_token` claims preferred. Options: `hostedDomain` (sent as `hd` and enforced on callback: the `hd` claim must match and `email_verified` must be `true`) and `offlineAccess` (`access_type=offline`). |
| GitLab | Configurable `baseUrl` for self-hosted instances. Returns only confirmed addresses (primary of a confirmed account, else a confirmed `/user/emails` entry). |
| Facebook | Sends explicit `fields=id,name,email,picture` on the user-info call. |
| Microsoft | Configurable `tenant` (`common`/`organizations`/`consumers`/GUID). OIDC `id_token` claims. `email` is the `email` claim only (never `preferred_username`); `emailVerified` requires `xms_edov`. |

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
    stateStore: oauthStateStore, // application-owned atomic create/consume callbacks
    secret: env.OAUTH_STATE_SECRET,
    providers: { discord: { clientId: '...', clientSecret: '...', redirectUrl: '/auth/discord/callback' } },
    customProviders: { discord },
});
```

### Security defaults

- PKCE (S256) is on by default for every provider (RFC 9700 recommendation).
- State is a 128-bit random nonce, stored in an HttpOnly `SameSite=Lax`
 cookie signed with HMAC-SHA256, compared without an early mismatch exit, and
 deleted on callback read. The required server store atomically consumes
 provider-bound state before token exchange. Cookie and storage expiry are checked.
- The `redirect_uri` sent on the authorize request is reused unchanged on the
 token-exchange request (exact string match).

### Stateless mode

For cookie-less API clients, pass `stateless: true` to `createOAuth()`. In
this mode, PKCE is also disabled. The verifier cannot be recovered without a
cookie store. You become responsible for CSRF protection of the callback. For
example, pass `state` through a signed query parameter and make sure that the
value is valid. Use this mode only when cookies are not an option. The default
stateful mode is more secure.

OAuth failures expose an `OAuthError` with a fixed `code`, `stage`, `status`
and safe message. Provider failures can include a numeric `providerStatus`.
The error omits provider response bodies, authorization codes, credentials
and raw exception causes. Use `err.toJSON()` in `onError` for structured logs.
Callback handlers clear the browser state cookie on rejection. Cookie deletion
does not provide atomic replay prevention across concurrent requests.

See [`docs/oauth.md`](../../docs/oauth.md) for the complete guide.

---

## Authorization (roles & permissions)

`createAuthorizer()` returns middleware factories that read `c.get('user')`
(populated by `createAuth().middleware`) and consult your callbacks. The
framework does not know how the application stores roles and permissions on
the user object. Your callbacks answer yes or no. The package handles the HTTP
response.

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

For conditional UI (show or hide elements inside `render()`), use the boolean
helpers on the same kit: `guard.can(c, permission)`, `guard.hasRole(c, role)`,
plus their `Async` variants for database-backed lookups. See
[`docs/authorization.md`](../../docs/authorization.md#conditional-ui-in-render)
for the inline-sync and `init()`/`@State` patterns.

Default failure responses are `401 JSON` (unauthenticated) and `403 JSON`
(forbidden). Override both via `onUnauthorized`.

Session login and OAuth login work in the same way. Both populate
`c.get('user')`.

See [`docs/authorization.md`](../../docs/authorization.md) for more.

---

## Running the tests

```sh
cd packages/auth && pnpm vitest --run
```

## License

MIT
