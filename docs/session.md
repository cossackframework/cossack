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
const values = await session().all();
```

An anonymous session is created lazily when a value is first written. Its
cookie is HTTP-only, secure in production, same-site lax, and uses sliding
expiry.

## Authentication bridge

The middleware can read the authentication cookie so both systems share one
physical `sessions` row. `bindUser(userId)` upgrades an anonymous session
without losing its key/value bag:

```ts
await session().bindUser(user.id);
```

Destroy the row and expire the cookie with:

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
  load(id: string): Promise<SessionHandle | undefined>;
  destroy(id: string): Promise<void>;
  bindUser(id: string, userId: string): Promise<void>;
  purgeExpired(now?: Date): Promise<number>;
}
```

Framework does not import the ORM. The ORM integration lazily resolves the
active request scope, while explicitly supplied ORM instances are also
supported for jobs and tests.
