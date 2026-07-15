---
title: "Session & Flash"
description: "Carry data across requests: short-lived flash values (one redirect) and persistent DB-backed sessions."
---

# Session & Flash

Cossack gives you two mechanisms for carrying data across requests. They solve different problems and live in different packages:

| | **Flash** | **Session** |
|---|---|---|
| **Lifespan** | One redirect, then consumed (read-once). | Persistent across many requests, until expiry or destroy. |
| **Storage** | Signed cookie (`cossack_flash`). | Database (`sessions` table). |
| **Package** | `@cossackframework/core` — **always on**. | `@cossackframework/database` — **opt-in** (`cossack add database`). |
| **Setup** | None. Registered automatically by the router. | Register the session middleware + run the `sessions` migration. |
| **Capacity** | ~4KB (cookie limit). For messages + small form input. | Unlimited (DB row). Shopping carts, multi-step wizards, any large payload. |
| **Secret?** | Needs `APP_SECRET` (HMAC-signed cookie). | No signing — session IDs are 256-bit random. |

**Rule of thumb:** if it should disappear after one page load (a success banner, validation errors, old form input), use **flash**. If it should survive browsing around (a cart, a "recently viewed" list, an anonymous user's state), use a **session**.

> **Auth sessions are separate.** The `@cossackframework/auth` package provides its own cookie-session kit (`createAuth`, `createSession`, `validateSessionId`) for authenticated users. See [Authentication](/docs/authentication.md). The database session below can **bridge** to it — an authenticated request reuses the auth session ID instead of issuing an anonymous one.

---

## Flash

Flash data carries values across exactly one redirect (POST → GET), then is consumed — the classic Laravel `back()->with('success', 'Saved!')` pattern. Use it for success messages, validation errors, or repopulating form fields after a failed submission.

```typescript
import { flash, flashed, old } from '@cossackframework/core';

@Page({ transport: 'http' })
export default class FormPage extends Cossack {
  async post() {
    const { data, valid } = await this.c.getFormData<MyForm>({ rules });
    // getFormData() auto-flashes the submitted input (for old()) and the
    // errors (when invalid) — no manual flashInput()/flash('errors') needed.
    if (!valid) {
      return this.back();             // redirect back to Referer
    }

    flash('success', 'Saved!');        // one-shot success message
    return this.c.redirect('/form');
  }

  async init() {
    // Read flashed data on the GET that follows the redirect.
    this.success = flashed<string>('success');
    this.name = old<string>('name') ?? '';
  }
}
```

### API

All helpers are imported from `@cossackframework/core`. **Writers** go in `post()` (before the redirect); **readers** go in `init()` / `render()` (on the GET that follows).

| Function | Direction | Signature | Description |
|---|---|---|---|
| `flash(key, value)` | write | `(key: string, value: unknown) => void` | Stash a value for the *next* request. |
| `flash(values)` | write | `(values: Record<string, unknown>) => void` | Stash several values at once. |
| `flashed<T>(key)` | read | `(key: string) => T \| undefined` | Read a value flashed by the *previous* request. |
| `flashedAll()` | read | `() => Record<string, unknown>` | Read all flashed values (excludes the old-input namespace). |
| `hasFlashed(key)` | read | `(key: string) => boolean` | Whether a flash key is present. |
| `flashInput(data)` | write | `(data: Record<string, unknown>) => void` | Stash submitted form input for repopulation. Namespaced — won't collide with message-style flash keys. |
| `old<T>(key)` | read | `(key: string) => T \| undefined` | Read a stashed input field for repopulating the form. Supports dot-paths (`old('address.city')`). |

> **Common mistake:** `flash()` and `flashInput()` are **write-only**. To *read*, use `flashed(key)` and `old(key)` respectively. Calling `flash('success')` with one argument writes `undefined` — it does not read.

### Auto-flash in `getFormData()`

When you pass `rules` to `getFormData()`, the submitted input and any validation errors are **auto-flashed** to the next request. This is the common form flow, so it's on by default — no manual `flashInput()` / `flash('errors', ...)` required. Control it with the `flash` option:

| `flash` value        | Flashed input (`old`) | Flashed errors           |
|----------------------|------------------------|---------------------------|
| omitted / `true`     | ✅                     | ✅ (only when non-empty)  |
| `false`              | ❌                     | ❌                         |
| `{ input: false }`   | ❌                     | ✅                         |
| `{ errors: false }`  | ✅                     | ❌                         |

Errors are only flashed when there actually are any — a valid form never flashes an empty `errors` object, so truthy checks like `${this.errors ? ...}` won't render an error banner on success. Flashing is a no-op when no flash store is wired (e.g. on the client).

```typescript
const { data, valid } = await this.c.getFormData<MyForm>({
    rules: storeRules<MyForm>({ /* ... */ }),
    flash: false,           // opt out — flash manually with the helpers above
});
```

See [Forms](/docs/forms.md) for the full POST → redirect → GET example.

### How it works

Flash data is carried in a **signed cookie** (`cossack_flash`) that survives the redirect. The framework's flash middleware (registered automatically in `router.ts`) reads + consumes it on the next request (read-once semantics) and seeds a per-request store so `flashed()` / `old()` work context-free, like `__()` for i18n. Writes are signed and set on the response after the handler returns.

**Signing secret required.** Because flash messages render into HTML, the cookie is HMAC-signed to prevent tampering. Set `APP_SECRET` (min 16 chars) in your wrangler env — the middleware also falls back to `COSSACK_SECRET`, then `SECRET`:

```jsonc
// wrangler.jsonc
{
  "vars": { "APP_SECRET": "your-long-random-secret-here" }
}
```

Apps that never use `flash()` need no secret — the middleware throws only when flash is actually exercised.

### Limitations

- **~4KB cookie limit.** Fine for messages + small form input. For larger payloads, use a database-backed `session()` instead.
- **Read-once.** Flash is consumed on the first GET that reads it. Refreshing the page clears it.
- **Traditional `method="post"` flows only.** The CRPC `/crpc` path returns JSON (no redirect), so flash isn't applicable there — and `@Server` reactive forms already show success inline via `@State`.

---

## Session

A database-backed, key/value session that persists across many requests — shopping carts, multi-step wizards, anonymous user state. Lives in the `@cossackframework/database` package and is added with `cossack add database`.

```typescript
import { session } from '@cossackframework/database';

async get() {
    // Read a value (typed via the generic).
    const cart = await session().get<Cart>('cart');
    return this.render({ cart });
}

async post() {
    // Set a value (merges into the bag; refreshes expiry).
    await session().set('cart', { items: ['sku-1', 'sku-2'] });
    return this.back();
}
```

The `session()` helper is context-free — it reads the active request's session from AsyncLocalStorage, the same pattern as `db()`. Throws a clear `[Cossack]` error if called outside a request scope (i.e. the session middleware isn't registered).

### Setup

Sessions require the database package and a `sessions` table. Both are scaffolded by the CLI:

```bash
cossack add database
```

This installs `@cossackframework/database`, generates the `sessions` migration (`0002_create_sessions.ts`), and registers the `dbMiddleware`. You then register the session middleware explicitly:

```typescript
// src/middlewares/session.ts
import { createSessionMiddleware } from '@cossackframework/database';
export const sessionMiddleware = createSessionMiddleware();

// src/config/middlewares.ts
import { sessionMiddleware } from '../middlewares/session';
export const middlewares = [sessionMiddleware];
```

Run the migration to create the table:

```bash
cossack migrate
```

### `session()` API

`session()` returns a handle bound to the active request's session. All methods are async (they hit the database) except `id()`:

| Method | Signature | Description |
|---|---|---|
| `id()` | `() => string` | The active session ID for this request. |
| `get<T>(key)` | `(key: string) => Promise<T \| undefined>` | Read a single key from the session data bag. |
| `getAll()` | `() => Promise<Record<string, unknown>>` | Read the entire data bag. |
| `set(key, value)` | `(key: string, value: unknown) => Promise<void>` | Set a single key (merges into the bag; **refreshes expiry** — sliding expiration). |
| `unset(key)` | `(key: string) => Promise<void>` | Remove a single key. |
| `destroy()` | `() => Promise<void>` | Delete the session row entirely (e.g. on logout). |

```typescript
const sid = session().id();                          // 'vxZ8...Q==' (opaque)
await session().set('theme', 'dark');                // merge one key
const theme = await session().get<string>('theme');  // 'dark'
const all = await session().getAll();                // { theme: 'dark', cart: {...} }
await session().unset('theme');
await session().destroy();                           // wipe the session
```

### How it works

Sessions are DB-backed (the `sessions` table) and addressed by an opaque, 256-bit-random ID carried in a cookie. Because the ID is unguessable, **no signing is required** — unlike flash, there is no `APP_SECRET` dependency.

The middleware resolves the session ID in this order:

1. **Auth cookie** (if an `authCookieReader` is configured) — reuse the authenticated user's existing session ID.
2. **Anonymous cookie** (`cossack_sid` by default).
3. If neither is present, **create** a fresh anonymous session and set its cookie on the response.

The session is scoped into AsyncLocalStorage for the duration of the request, so `session()` works from any handler without an explicit context argument.

### `createSessionMiddleware(options?)`

| Option | Default | Description |
|---|---|---|
| `cookieName` | `'cossack_sid'` | Anonymous-session cookie name. |
| `ttl` | `2592000000` (30 days) | Session TTL in milliseconds. |
| `authCookieReader` | `undefined` | Optional: read the session ID from auth's cookie instead of the anonymous one. Return the auth session ID when the user is logged in; return `undefined` to fall back to the anonymous cookie. This is the "ID bridge" that lets an authenticated session reuse its existing ID. |
| `httpOnly` | `true` | Whether the anonymous cookie is `httpOnly`. (Auth-managed cookies set their own attributes.) |

**Bridging to auth:** if you also have `@cossackframework/auth` installed, pass an `authCookieReader` so logged-in users keep a single session ID rather than a separate anonymous one. The reader is any function that returns the auth session ID from the request — typically the same cookie read your auth provider's `extractSessionId` uses, so extract it into a shared helper:

```typescript
// src/auth.ts — define the reader once and reuse it in createAuth + the middleware.
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';

export function readSessionId(c: Context): string | undefined {
    return getCookie(c, 'session_token');
}

export const auth = createAuth<User>({
    extractSessionId: readSessionId,
    /* validateSessionId, resolveUserById, createSession … */
});
```

```typescript
// src/middlewares/session.ts
import { createSessionMiddleware } from '@cossackframework/database';
import { readSessionId } from '../auth';

export const sessionMiddleware = createSessionMiddleware({
    authCookieReader: readSessionId,   // logged-in users reuse their auth session ID
});
```

(If you don't have auth, omit `authCookieReader` — an anonymous `cossack_sid` cookie is used instead.)

### Expiry & cleanup

Each `set()` refreshes the session's expiry (**sliding expiration**) — an active session never expires. Expired rows remain in the table until purged. Purge them with `SessionStore.purgeExpired()` (e.g. from a Cron trigger):

```typescript
import { SessionStore } from '@cossackframework/database';

const store = new SessionStore();
const deleted = await store.purgeExpired();   // returns the number of rows removed
```

The `sessions` table schema:

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | 256-bit random base64url ID (~43 chars). |
| `user_id` | text | Nullable — set on login via `SessionStore.bindUser()`. |
| `data` | text | JSON bag of the session's key/value pairs. |
| `expires_at` | text | Sliding expiration timestamp. |
