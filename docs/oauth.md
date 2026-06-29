---
title: "OAuth"
description: "Add OAuth 2.0 login (GitHub, Google, GitLab, Facebook, Microsoft, or custom) to your Cossack application."
---

# OAuth (Login with GitHub, Google, ...)

The `@cossackframework/auth` package ships a full **OAuth 2.0 Authorization
Code flow with PKCE (S256)** implementation. It works on both Cloudflare
Workers and Node.js because it only uses web-standard APIs (`fetch`, Web
Crypto, `crypto.randomUUID`).

First-party providers: **GitHub, Google, GitLab, Facebook, Microsoft**. Custom
providers are supported via [`defineOAuthProvider`](#custom-providers).

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

- **PKCE S256** is on for every provider (RFC 9700 recommendation, even for
  confidential clients). A fresh `code_verifier` is generated per redirect.
- **CSRF `state`**: 128-bit random nonce, stored in an HttpOnly
  `SameSite=Lax` cookie signed with HMAC-SHA256, compared in **constant time**,
  and **single-use** (deleted on callback read).
- **Exact `redirect_uri` match**: the same value is sent on the authorize and
  token-exchange requests.

## 1. Register an OAuth app with your provider

Create credentials in the provider's developer console and configure the
authorized callback URL (e.g. `https://yourapp.example/auth/github/callback`).

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

## 3. Mount the routes

```ts
// src/index.ts
import { Hono } from 'hono';
import { createApp } from '@cossackframework/framework';
import { oauth, auth } from './auth';

const app = createApp({ authMiddleware: auth.middleware });

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
        console.error('GitHub OAuth failed:', err);
        return c.redirect('/login?error=oauth_failed');
    },
}));

export default app;
```

## The `onUser` callback

This is where you decide what to do with the authenticated OAuth user. The
package itself never touches your database. A robust pattern:

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
    } else if (oauthUser.email) {
        // 2b. No link yet, but the provider gave us a verified email →
        //     optionally link to an existing user with that email.
        //     ⚠️ Only auto-link if the email is verified (provider-dependent);
        //     otherwise create a new account or prompt for confirmation.
        const existing = await db.users.findUnique({ where: { email: oauthUser.email } });
        if (existing) userId = existing.id;
        else userId = (await db.users.create({ data: { email: oauthUser.email, ... } })).id;
    } else {
        // 2c. No link, no usable email → create a new user.
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
    email?: string | null; // null when hidden (GitHub) and unresolvable
    avatar?: string;
    raw: Record<string, unknown>; // full provider payload
}
```

## Provider-specific options

Attach a `provider` object to the per-provider config:

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
        email: raw.email as string | null,
        avatar: raw.avatar
            ? `https://cdn.discordapp.com/avatars/${raw.id}/${raw.avatar}.png`
            : undefined,
        raw,
    }),
});

export const oauth = createOAuth({
    secret: env.OAUTH_STATE_SECRET,
    providers: {
        discord: { clientId: '...', clientSecret: '...', redirectUrl: '/auth/discord/callback' },
    },
    customProviders: { discord },
});
```

Custom provider ids must not shadow a first-party id (`github`, `google`,
`gitlab`, `facebook`, `microsoft`).

## Overriding cookie defaults

```ts
createOAuth({
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
will **not** set or verify a state cookie, and **PKCE is disabled** as well
(since the `code_verifier` cannot be recovered without a cookie store).

**You are then responsible for CSRF protection** of the callback — for example,
by including a signed `state` value in the authorize URL that you verify
yourself on callback. Without PKCE you also lose the defense against
authorization-code injection, so stateless mode is riskier than the default and
should only be used when you cannot use cookies.

```ts
createOAuth({ secret: env.OAUTH_STATE_SECRET, stateless: true, providers: { /* ... */ } });
```

## Testing

The flow layer is unit-tested with mocked `fetch` (`vi.stubGlobal('fetch', ...)`).
The full redirect→callback round-trip (state cookie, PKCE, token exchange,
userinfo, `onUser`) is covered in `packages/auth/tests/handler.test.ts`.

For end-to-end testing against a real provider, set the credentials via env
and gate the test behind `process.env.E2E_OAUTH === '1'` so it's opt-in.
