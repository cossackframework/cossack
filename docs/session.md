---
title: 'Sessions'
description: 'ORM-independent anonymous and authenticated request sessions.'
---

# Sessions

Framework owns the session API and depends on no database library:

```ts
import {
  createSessionMiddleware,
  session,
  type SessionStore,
} from '@cossackframework/framework/session';
```

`SessionStore` is structural, so an application can use any backend. The
generated ORM recipe composes the supplied database store:

```ts
import { createDatabaseSessionStore } from '@cossackframework/database/cossack';
import { createSessionMiddleware } from '@cossackframework/framework/session';

export const sessionMiddleware = createSessionMiddleware({
  store: createDatabaseSessionStore(),
});
```

Register middleware in this order:

```ts
const middlewares = [
  ormRequestMiddleware,
  sessionMiddleware,
  auth.middleware,
  authGuard,
];
```

## Session bags

`session()` is context-free and resolves through the current Framework request
context:

```ts
const cart = await session().get<Cart>('cart');
await session().set('cart', nextCart);
await session().unset('checkoutStep');
const values = await session().getAll();
```

The middleware creates an anonymous session when no live session ID is available.
It replaces unknown and expired cookie IDs with a new server-generated ID.
The cookie is HTTP-only, secure on HTTPS requests, and same-site lax.
Writes extend the stored expiry. They cannot recreate missing or expired rows.

## Authentication bridge

The middleware can read the authentication cookie so both systems share one
physical `sessions` row. `bindUser(userId)` upgrades an anonymous session
with a new session ID, while preserving its key/value bag. The old row is deleted
and the response sets the replacement cookie:

```ts
await session().bindUser(user.id);
```

For an auth-managed ID from `authCookieReader`, rotate the ID and update the auth
cookie through your auth provider. `bindUser()` rejects this case because the
generic middleware does not own that cookie. The reader must return a validated
authentication session ID.

Destroy an anonymous row and expire its cookie with:

```ts
await session().destroy();
```

The database store preserves the shared physical row representation:
`id`, `user_id`, `data`, `meta`, tracking fields, `created_at`, and
`expires_at`.

## Custom stores

Implement the structural `SessionStore` contract:

```ts
interface SessionStore {
  create(ttlMs?: number): Promise<string>;
  has(id: string): Promise<boolean>; // true only for an existing, unexpired row
  load(id: string): Promise<Record<string, unknown>>;
  get<T = unknown>(id: string, key: string): Promise<T | undefined>;
  getAll(id: string): Promise<Record<string, unknown>>;
  set(id: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  unset(id: string, key: string): Promise<void>;
  destroy(id: string): Promise<void>;
  bindUser(id: string, userId: string): Promise<void>;
  purgeExpired(): Promise<number>;
}
```

Framework does not import the ORM. The ORM integration lazily resolves the
active request scope, while explicitly supplied ORM instances are also
supported for jobs and tests.

Custom stores must add `has()` and reject writes that recreate expired or deleted
rows. After `destroy()`, the handle rejects further access in the same request.
