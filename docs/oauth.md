---
title: "OAuth"
description: "Add OAuth 2.0 login (GitHub, Google, GitLab, Facebook, Microsoft, or custom) to your Cossack application."
---

# OAuth (Login with GitHub, Google,...)

The `@cossackframework/auth` package implements the OAuth 2.0 Authorization
Code flow with PKCE (S256). It works on both Cloudflare
Workers and Node.js because it only uses web-standard APIs (`fetch`, Web
Crypto, `crypto.randomUUID`).

First-party providers: GitHub, Google, GitLab, Facebook, and Microsoft. Custom
providers use [`defineOAuthProvider`](#custom-providers).

## How the flow works

```
Browser                   Cossack app              OAuth provider
  │                            │                          │
  │ 1. GET /auth/github/redirect                            │
  │ ─────────────────────────►│                           │
  │                            │ set state+PKCE cookie     │
  │ 302 → authorize URL        │                           │
  │ ◄─────────────────────────┤                           │
  │                            │                           │
  │ 2. user consents           │                           │
  │ ──────────────────────────────────────────────────────►│
  │                            │                           │
  │ 3. 302 → /auth/github/callback?code=…&state=…          │
  │ ◄──────────────────────────────────────────────────────┤
  │                            │                           │
  │ 4. GET /auth/github/callback                           │
  │ ─────────────────────────►│                           │
  │                            │ verify state (cookie)     │
  │                            │ exchange code + verifier ─►│  (server-to-server, POST)
  │                            │ ◄─────────────────────────┤  access_token (+id_token)
  │                            │ GET userinfo w/ bearer ───►│
  │                            │ ◄─────────────────────────┤  user profile
  │                            │ call onUser(oauthUser)    │
  │                            │ → create local user+session│
  │ 302 → /dashboard           │                           │
  │ ◄─────────────────────────┤                           │
```

## Security defaults

- PKCE S256 is on for every provider. RFC 9700 recommends it even for
 confidential clients. A fresh `code_verifier` is generated per redirect.
- CSRF `state`: a 128-bit random nonce, stored in an HttpOnly
 `SameSite=Lax` cookie signed with HMAC-SHA256, compared without an early mismatch exit,
 and deleted on callback read. The required server state store atomically consumes
 the provider-bound state before token exchange. Both the cookie and store enforce expiry.
- Exact `redirect_uri` match: the same value is sent on the authorize and
 token-exchange requests.

## Atomic state storage

Cookie-based `createOAuth` requires an `OAuthStateStore`. The generated
`src/auth.ts` exports `oauthStateStore`. `cossack add auth --oauth github`
composes it automatically. Handwritten applications supply these callbacks:

| Callback | Contract |
| --- | --- |
| `create(record, context)` | Insert a new provider-scoped record without overwriting a collision. |
| `consume(key, provider, now, context)` | Atomically remove the matching unexpired record. Return boolean `true` for one winner only. |

`OAuthStateRecord` has a SHA-256 `key`, `provider`, `createdAt` and `expiresAt`.
Times are Unix milliseconds. The key hashes the library purpose, provider ID and
random state. Rows contain no authorization code, PKCE verifier or credential.
The signed cookie still binds the nonce and verifier to the browser.

The generated store writes anonymous `sessions` rows with
`meta: { type: 'oauth_state', provider }`. One conditional SQL `DELETE` checks the
key, provider, purpose, anonymous owner and current expiry. A read followed by
delete is insufficient. OAuth state cannot authenticate as a session or act as
a password-reset token. Remove abandoned expired rows through application cleanup.

Consumption happens after signed-cookie and state validation, before token
exchange. Concurrent callbacks have one winner. Failed exchange, profile or
account mapping does not restore the state. Start a new flow to retry. Cookie
cleanup alone cannot provide this property. Stateless mode uses a signed,
expiring `state` instead, and leaves replay protection to the application.

This store supplies the one-time state boundary described in
[OAuth Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7.1).
Storage atomicity remains the application's responsibility. The native local
tests verify the generated SQLite/D1 composition. They do not prove a live
provider registration or deployed database configuration.

## 1. Register an OAuth app with your provider

Create credentials in the provider's developer console and configure the
authorized callback URL (for example `https://yourapp.example/auth/github/callback`).

| Provider | Console |
| --- | --- |
| GitHub | https://github.com/settings/developers |
| Google | https://console.cloud.google.com/apis/credentials |
| GitLab | https://gitlab.com/-/user_settings/applications (or your instance) |
| Facebook | https://developers.facebook.com/apps |
| Microsoft | https://entra.microsoft.com → App registrations |

Store the credentials as environment variables (Cloudflare: `wrangler secret put`,
or `vars` in `wrangler.jsonc`).

## 2. Configure `createOAuth()`

```ts
// src/auth.ts
import { createOAuth } from '@cossackframework/auth';

export const oauth = createOAuth({
    stateStore: oauthStateStore, // application-owned atomic create/consume callbacks
    secret: env.OAUTH_STATE_SECRET, // ⚠️ at least 16 chars; use a 32-byte random value
    providers: {
        github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
            redirectUrl: '/auth/github/callback',
        },
    },
});
```

The `secret` signs the state cookie. Generate one with, for example,
`openssl rand -base64 32`. Keep it out of version control.
`oauthStateStore` is the application's implementation described above. In the
generated auth module it is declared before constructing the OAuth kit.

## 3. Mount the routes

Register `auth.middleware` in `src/bootstrap/middlewares.ts` (the registry
`createApp()` auto-loads), then mount the OAuth routes in `src/index.ts`:

```ts
// src/bootstrap/middlewares.ts
import type { MiddlewareHandler } from 'hono';
import { auth } from '../auth';
const middlewares: MiddlewareHandler[] = [auth.middleware];
export default middlewares;
```

```ts
// src/index.ts
import { createApp } from '@cossackframework/framework';
import { oauth, auth } from './auth';

const app = createApp({ AppComponent: App, htmlTemplate: template });

app.get('/auth/github/redirect', oauth.redirect('github'));
app.get('/auth/github/callback', oauth.callback('github', {
    async onUser(oauthUser, tokens, c) {
        const user = await users.upsertByOauthId('github', oauthUser.id, {
            name: oauthUser.name ?? oauthUser.nickname,
            email: oauthUser.email ?? undefined,
            avatarUrl: oauthUser.avatar,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        });

        const { headers } = (await auth.createSession!(user, c))!;
        return c.redirect('/dashboard', { headers });
    },
    onError: async (err, c) => {
        console.error('GitHub OAuth failed:', err.toJSON());
        return c.redirect('/login?error=oauth_failed');
    },
}));

export default app;
```

## Failure diagnostics

`OAuthError` has a stable `code`, `stage`, HTTP `status` and optional numeric
`providerStatus`. Messages are fixed library text. Raw provider bodies, exceptions,
authorization codes, tokens and credentials are not retained. `onError` receives
this immutable error. Log `error.toJSON()` instead of the callback URL or context.

| Failure | Stage | Status |
| --- | --- | --- |
| Missing configuration or invalid state secret | `configuration` | 500 |
| Redirect preparation | `redirect` | 500 |
| State record insertion | `state-create` | 500 |
| Atomic state consumption | `state-consume` | 500 |
| Missing callback parameters | `callback` | 400 |
| Denied consent | `callback` | 403 |
| Provider authorization rejection | `callback` | 502 |
| Missing, expired, invalid, mismatched or consumed state | `state` | 400 |
| Token exchange | `token-exchange` | 502 |
| Profile fetch or normalization | `user-info` | 502 |
| Application `onUser`, account lookup or session creation | `account-mapping` | 500 |
| Application `onError` | `error-handler` | 500 |

Configuration errors throw when constructing a kit or route. Redirect failures
use the default diagnostic response. Callback errors call `onError`. Returning
no response keeps the default response. A throwing handler gets its own diagnostic.
Configured cookie-based callbacks clear their state cookie on success and failure,
including denied consent and missing parameters. The separate required state store
provides atomic server consumption. An error cannot undo application effects already
performed by `onUser`.

## The `onUser` callback

This is where you decide what to do with the authenticated OAuth user. The
package itself never touches your database. A pattern:

```ts
async onUser(oauthUser, tokens, c) {
    // 1. Look up an existing link by (provider, provider_user_id).
    let link = await db.oauthAccounts.findUnique({
        where: { provider_providerUserId: { provider: 'github', providerUserId: oauthUser.id } },
    });

    let userId: string;
    if (link) {
        // 2a. Existing link → reuse the linked user.
        userId = link.userId;
    } else if (oauthUser.email && oauthUser.emailVerified) {
        // Only provider-verified emails reach this branch. A matching email
        // still does not prove ownership of the existing local account.
        const existing = await db.users.findUnique({ where: { email: oauthUser.email } });
        if (existing) throw new Error('Sign in before linking this provider.');
        userId = (await db.users.create({ data: { email: oauthUser.email, ... } })).id;
    } else {
        // 2c. No link, no verified email → create a new user without one.
        userId = (await db.users.create({ data: { /* ... */ } })).id;
    }

    // 3. Persist the link + tokens so future logins and API calls work.
    await db.oauthAccounts.upsert({
        where: { provider_providerUserId: { provider: 'github', providerUserId: oauthUser.id } },
        create: {
            provider: 'github',
            providerUserId: oauthUser.id,
            userId,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
        },
        update: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
    });

    const user = await db.users.findUnique({ where: { id: userId } });
    return c.redirect('/dashboard', { headers: (await auth.createSession!(user!, c)).headers });
}
```

### Recommended `oauth_accounts` schema

```
oauth_accounts
  provider          TEXT       -- 'github', 'google', ...
  provider_user_id  TEXT       -- OAuthUser.id
  user_id           TEXT       -- FK -> users.id
  access_token      TEXT
  refresh_token     TEXT
  expires_at        TIMESTAMP
  PRIMARY KEY (provider, provider_user_id)
```

This lets one user connect multiple providers to the same account.

## The `OAuthUser` shape

```ts
interface OAuthUser {
    id: string;            // stable, provider-scoped
    nickname?: string;     // GitHub login, GitLab username, ...
    name?: string;
    email?: string | null; // only a provider-verified address; see below
    emailVerified?: boolean; // true only when the provider asserted ownership
    avatar?: string;
    raw: Record<string, unknown>; // full provider payload
}
```

`email` is set only when the provider marks the address verified. Otherwise
it is `null` or absent. Unverified addresses are dropped because a user can add
somebody else's address to their provider account without confirming it.

| Provider | `email` source | `emailVerified` |
| --- | --- | --- |
| GitHub | Profile email if `/user/emails` lists it as verified, else the verified primary. Needs the `user:email` scope (default); without it `email` is `null`. | `true` when `email` is set |
| GitLab | Primary email of a confirmed account (`confirmed_at`), else the first confirmed `/user/emails` entry. | `true` when `email` is set |
| Google | `email` claim only when `email_verified` is `true`. | `true` when `email` is set |
| Microsoft | `email` claim only. `preferred_username` (a UPN) and Graph `mail` are never used. Microsoft does not verify this claim. | `true` only when the optional `xms_edov` claim is `true` |
| Facebook | Graph `email` field. | not set |

Require `emailVerified === true` before matching or creating local accounts by
email. Custom providers should set `emailVerified` the same way.

## Provider-specific options

Attach a `provider` object to the per-provider configuration:

```ts
providers: {
    google: {
        clientId: '...', clientSecret: '...', redirectUrl: '/auth/google/callback',
        provider: {
            hostedDomain: 'acme.com',  // restrict to a Google Workspace domain
            offlineAccess: true,       // request a refresh_token
        },
    },
    gitlab: {
        clientId: '...', clientSecret: '...', redirectUrl: '/auth/gitlab/callback',
        provider: { baseUrl: 'https://gitlab.example.com' }, // self-hosted instance
    },
    microsoft: {
        clientId: '...', clientSecret: '...', redirectUrl: '/auth/microsoft/callback',
        provider: { tenant: 'consumers' }, // or 'common' (default), 'organizations', a tenant GUID
    },
}
```

Google's `hostedDomain` is enforced on the callback, not only hinted. The
`hd` authorize parameter only preselects accounts in Google's picker, and a user
can remove it. The callback therefore requires the provider-issued `hd` claim to
equal `hostedDomain` and `email_verified` to be `true`. Other accounts, including
personal Gmail accounts, fail with `COSSACK_OAUTH_USER_INFO_FAILED` (`user-info`,
502) before `onUser` runs.

## Custom providers

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
        // Discord reports whether the address is verified. Only a verified
        // email may be used to identify or create an account.
        email: raw.verified === true ? (raw.email as string | null) : null,
        emailVerified: raw.verified === true && typeof raw.email === 'string',
        avatar: raw.avatar
            ? `https://cdn.discordapp.com/avatars/${raw.id}/${raw.avatar}.png`
            : undefined,
        raw,
    }),
});

export const oauth = createOAuth({
    stateStore: oauthStateStore, // application-owned atomic create/consume callbacks
    secret: env.OAUTH_STATE_SECRET,
    providers: {
        discord: { clientId: '...', clientSecret: '...', redirectUrl: '/auth/discord/callback' },
    },
    customProviders: { discord },
});
```

Custom provider ids must not shadow a first-party id (`github`, `google`,
`gitlab`, `facebook`, `microsoft`).

Set `emailVerified: true` only when the provider confirms the address. The
generated `handleOAuthUser` ignores any email without it and stores a
placeholder address for the new account instead.

## Overriding cookie defaults

Names and paths are checked before state storage. `__Host-` and `__Secure-`
names require explicit `secure: true`. `__Host-` also requires `path: '/'`.
Clearing preserves these flags, including for raw or immutable custom Responses.

```ts
createOAuth({
    stateStore: oauthStateStore, // application-owned atomic create/consume callbacks
    secret: env.OAUTH_STATE_SECRET,
    cookie: {
        name: 'my_oauth_state',  // default: 'cossack_oauth_state'
        maxAge: 300,             // seconds; default 600 (10 minutes)
        secure: true,            // auto-set when request is HTTPS
        sameSite: 'strict',      // default 'lax'
    },
    providers: { /* ... */ },
});
```

## Stateless mode (advanced)

For cookie-less API clients, pass `stateless: true`. In this mode the package
does not set a state cookie and does not use a state store. PKCE is disabled,
because the `code_verifier` cannot be recovered without a cookie.

The `secret` is still required, as in cookie mode. On redirect, the package
generates `state` as a signed token: a random nonce, the provider ID and an
absolute expiry, signed with HMAC-SHA256 under `secret`. The expiry is
`cookie.maxAge` seconds (default 600). On callback, the package checks the
signature (without an early mismatch exit), the provider and the expiry before
token exchange. A forged, tampered, expired or other-provider `state` fails with
`COSSACK_OAUTH_STATE_INVALID` (400). The provider is not contacted.

This is weaker than cookie mode:

- The state is not bound to the browser that started the flow. Anyone holding a
  fresh state value can use it until it expires.
- The state is not single-use. Replay protection inside the expiry window
  depends on the provider's one-time authorization codes.
- Without PKCE there is no defense against authorization-code injection.

Use stateless mode only when you cannot use cookies. Keep `cookie.maxAge`
short. Custom `state` values from the application are rejected.

```ts
createOAuth({ secret: env.OAUTH_STATE_SECRET, stateless: true, providers: { /* ... */ } });
```

## Testing

The flow layer is unit-tested with mocked `fetch` (`vi.stubGlobal('fetch', ...)`).
The full redirect→callback round-trip (state cookie, PKCE, token exchange,
userinfo, `onUser`) is covered in `packages/auth/tests/handler.test.ts`.
Replay, storage failure and custom-response cookie checks are in
`packages/auth/tests/oauth-replay.test.ts`. Generated Node SQLite and Cloudflare
D1 tests run a loopback provider that accepts repeated codes, then verify that
the application's state store admits one exchange and one account/session only.

For end-to-end testing against a real provider, set the credentials via env
and gate the test behind `process.env.E2E_OAUTH === '1'` so it is opt-in.

The generated auth recipe links identities by provider and provider user ID.
It does not link an existing account by email alone. Add an authenticated account
linking flow if users need multiple login providers for the same account.

Deleting an OAuth state cookie ends the normal browser round-trip. It does not
provide the server-side replay boundary. The required `OAuthStateStore` supplies
atomic consumption before exchange. Authorization codes also remain subject to
the provider's one-time exchange rules.
