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
generated ORM recipe exports middleware composed with the supplied database store.

This framework session bag is opt-in. Generated authentication already uses
the auth library's persistent cookie and does not register an extra anonymous
session middleware. Import the exported `sessionMiddleware` from
`src/middlewares/orm.ts` and register it when the application needs `session()`.
Limit its registration to routes that need visitor state: it creates a row and
issues a cookie for a new visitor, so it makes that response unsuitable for SSG.

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

Call `bindUser()` or `destroy()` before returning a streamed response. Both
need to change the response cookie. After response middleware finishes, they
reject with `COSSACK_RESPONSE_HEADERS_COMMITTED` before changing the stored row.
A lazy generator's body runs after this point, including code before its first
yield. Session bag `set()` and `unset()` remain storage operations on the live
row and do not issue a replacement cookie. See [RPC timing](./rpc.md).

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

## Flash and old input

Flash is separate from the persistent session bag. It uses a signed, readable
cookie and requires `APP_SECRET`. Import the helpers from core:

```ts
import { flash, flashInput, flashed, old } from '@cossackframework/core';

flashInput(data, { fields: ['name', 'address.city', 'tags'] });
flash('success', 'Saved.');
return this.c.redirect('/form');
```

On the following page request, read `old('name')`, `old('address.city')` and
`flashed('success')`. The middleware expires the cookie. A saved cookie can
still be replayed while the middleware accepts it; browser consumption is not
durable one-use storage. Valid incoming flash survives background RPC/upload/
realtime requests. Failed outgoing RPC writes preserve unrelated incoming flash.

`getFormData()` flashes nonempty validation errors by default, with no old input.
Use `flash: { input: ['name', 'address.city'] }` to retain only those public
fields. `flash: true` has the same errors-only default, and `flash: false`
disables both categories. The selection does not change server-side parsed data.

Select nested leaves individually. Whole objects, files, Date values, object
arrays and accessors are omitted. Scalar arrays are copied. Numeric paths such
as `contacts.0.label` retain selected array fields; unselected positions become
null during JSON serialization. Later source mutations do not change the copy.
Prototype paths and inherited properties are excluded.

Credential names are excluded even if selected. Case folding and punctuation
removal precede matching: names containing `password`, `passwd`, `passphrase`,
`secret`, `token`, `credential`, `authorization`, `cookie`, `apikey`, `privatekey`,
`sessionid` or `csrf` are excluded, as are `pin`, `otp`, `cvv` and `cvc`.
Custom secret names cannot be classified automatically. Keep them outside the
public field list, and keep the list in server-authored code. Do not copy secret
values into flash messages or validation messages. Use ordinary parsed data;
reflective reads of JavaScript proxies can invoke their traps.
Generic `flash()` rejects the reserved `__input` namespace; use `flashInput()`
for old input so the selection policy applies.

Prepare flash before returning a lazy generator. After response headers are
committed, flash writes reject with `COSSACK_RESPONSE_HEADERS_COMMITTED`.
See the [form recipe](./forms.md#server-side-validation) and installed
`safe-old-input` guide returned by `cossack docs --package @cossackframework/core --json`.

Custom stores must add `has()` and reject writes that recreate expired or deleted
rows. After `destroy()`, the handle rejects further access in the same request.
