---
title: 'Queries'
description: 'Query your database with Kysely — the db() helper, getDb(c), the typed query builder, joins, inserts, and per-request scoping via AsyncLocalStorage.'
---

# Queries

Cossack's database layer is built on [Kysely](https://kysely.dev), a type-safe SQL query builder. This page covers how to reach the client and how to build queries. Once you have a client, the full [Kysely API](https://kysely.dev/docs/) is available.

## Three ways to reach the client

The database middleware (see [Database](/docs/database.md)) exposes the same Kysely instance in three equivalent ways. Use whichever fits your code:

### 1. The global `db()` helper

The simplest. Works anywhere inside a request handler — no need to thread the context:

```ts
import { db } from '@cossackframework/database';

@Server()
async getUsers() {
  return await db().selectFrom('users').selectAll().execute();
}
```

`db()` reads the per-request client from an `AsyncLocalStorage` scope that the middleware sets up. It throws if called outside a request (e.g. in a standalone script) — see [Outside a request](#outside-a-request) below.

### 2. `getDb(c)` in a route handler

For functional [API routes](/docs/api-routes.md), read the client off the Hono context:

```ts
import { getDb } from '@cossackframework/database';
import type { Context } from 'hono';

export default async (c: Context) => {
  const users = await getDb(c).selectFrom('users').selectAll().execute();
  return c.json(users);
};
```

### 3. `this.c.get('db')` in a component

The client is also set on the Hono context as `db`:

```ts
@Server()
async getUsers() {
  return await this.c.get('db').selectFrom('users').selectAll().execute();
}
```

## Selecting

```ts
// all columns
const users = await db().selectFrom('users').selectAll().execute();

// specific columns — the result type only includes the selected columns
const emails = await db()
  .selectFrom('users')
  .select(['id', 'email'])
  .execute();

// where, orderBy, limit, offset
const recent = await db()
  .selectFrom('users')
  .where('created_at', '>', oneWeekAgo)
  .orderBy('created_at', 'desc')
  .limit(10)
  .execute();

// executeTakeFirst / executeTakeFirstOrThrow for a single row
const user = await db()
  .selectFrom('users')
  .where('id', '=', id)
  .selectAll()
  .executeTakeFirst();
```

### Joins

```ts
const rows = await db()
  .selectFrom('users as u')
  .innerJoin('sessions as s', 's.user_id', 'u.id')
  .select(['u.id', 'u.email', 's.id as session_id'])
  .where('s.expires_at', '>', new Date().toISOString())
  .execute();
```

## Inserting

```ts
const result = await db()
  .insertInto('users')
  .values({
    id: crypto.randomUUID(),
    email: 'alice@cossack.dev',
    name: 'Alice',
    passwordHash: hash,
    createdAt: new Date().toISOString(),
  })
  .executeTakeFirst();

console.log(result.numInsertedOrUpdatedRows); // bigint
```

`INSERT ... RETURNING` is supported (SQLite supports it):

```ts
const inserted = await db()
  .insertInto('users')
  .values({ ... })
  .returning(['id', 'email'])
  .executeTakeFirstOrThrow();
```

## Updating & deleting

```ts
await db().updateTable('users').set({ name: 'Alicia' }).where('id', '=', id).execute();
await db().deleteFrom('sessions').where('expires_at', '<', now).execute();
```

## Raw SQL

For things the builder can't express, use the `sql` template tag:

```ts
import { sql } from '@cossackframework/database';

const rows = await sql<{ id: string; total: number }>`
  SELECT user_id, COUNT(*) as total
  FROM sessions
  GROUP BY user_id
  HAVING COUNT(*) > ${min}
`.execute(db());
```

## Typing

The query builder is typed against the `Database` interface, which you augment from your model files:

```ts
// src/models/User.ts
import type { Generated } from '@cossackframework/database';

export interface UserRow {
  id: Generated<string>;
  email: string;
  name: string;
}

declare module '@cossackframework/database' {
  interface Database {
    users: UserRow;
  }
}
```

After that, every table and column is checked at compile time:

```ts
db().selectFrom('users').select(['email']);      // ✓
db().selectFrom('users').select(['emial']);      // ✗ TypeError: unknown column
db().selectFrom('usres');                         // ✗ TypeError: unknown table
```

`Generated<T>` marks columns the database populates (auto-incrementing ids, defaults) — they're optional when inserting but present when selecting. See the Kysely docs for `GeneratedAlways`, `Insertable`, and `Selectable` helpers.

## Transactions

How atomicity works depends on your dialect:

### Turso / libSQL — interactive transactions

Use Kysely's `db.transaction().execute(...)`:

```ts
await db().transaction().execute(async (trx) => {
  const user = await trx.insertInto('users').values({ ... })
    .returning('id').executeTakeFirstOrThrow();
  await trx.insertInto('sessions').values({ userId: user.id, ... }).execute();
});
```

Interactive transactions over HTTP have higher latency than single statements, so use them only when you need atomicity.

### D1 — no interactive transactions

D1 does **not** support `BEGIN`/`COMMIT` through its binding, so Kysely's `db.transaction()` does not work on D1. For atomic multi-statement writes, use the raw D1 binding's `.batch()` with prepared statements:

```ts
// Reach the raw binding off the env (not through Kysely).
await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, email),
  c.env.DB.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').bind(sid, id),
]);
```

D1 executes the batch as a single implicit transaction. For single-statement writes through Kysely, just call `insertInto`/`updateTable`/`deleteFrom` directly — no transaction needed.

## Per-request scoping

On Cloudflare Workers, a single isolate serves many concurrent requests. To prevent database races, the middleware wraps each request in an `AsyncLocalStorage` scope:

1. `createDbMiddleware` runs before your handlers and builds (or reuses) the Kysely client.
2. It sets `c.set('db', client)` and runs `next()` inside `runWithDb(client, ...)`.
3. Any `db()` call inside the request (or its async descendants) resolves to that client.

This is the same pattern the framework uses for [Localization](/docs/localization.md). It means you never have to pass the client through function arguments.

### Outside a request

`db()` throws if there's no client in scope — for example, in a standalone script or a background task. In those contexts, build the client explicitly:

```ts
import { createDatabase, runWithDb } from '@cossackframework/database';

const client = createDatabase({ dialect: 'd1', binding: someD1Instance });

// either call the client directly...
await client.selectFrom('users').selectAll().execute();

// ...or wrap a block so db() works inside it
await runWithDb(client, async () => {
  const users = await db().selectFrom('users').selectAll().execute();
});
```

The migration and seeder runners do this for you — see [Migrations](/docs/migrations.md) and [Seeders](/docs/seeders.md).

## Connection lifecycle

- **D1 / Turso (HTTP)**: stateless. The client is cheap; there's no pool to drain. The middleware creates or reuses it per request and does nothing on cleanup.
- **Node with Postgres/MySQL** (future): the middleware will check out a pooled connection and release it in a `finally` block to avoid leaks.

You don't need to call `client.destroy()` in application code — that's the CLI runner's job.

## API reference

| Export | Description |
|---|---|
| `db()` | Returns the per-request client. Throws outside a request scope. |
| `getDb(c)` | Reads the client from a Hono context (`c.get('db')`). Throws if the middleware isn't registered. |
| `createDbMiddleware({ client })` | Hono middleware. `client` is a `DbClient` or a factory `(c) => DbClient \| Promise<DbClient>`. |
| `runWithDb(client, fn)` | Runs `fn` inside a database scope so `db()` resolves to `client`. |
| `createDatabase(config)` | Builds a typed Kysely client. |
| Kysely re-exports | `Kysely`, `Generated`, `GeneratedAlways`, `sql`, `Insertable`, `Selectable`, `ExpressionBuilder`, ... |
