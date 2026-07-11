# Database (`db()`)

Cossack ships a database layer built on [Kysely](https://kysely.dev) — a type-safe SQL query builder that runs on Cloudflare Workers, Node.js, and the browser. It has first-class dialects for **Cloudflare D1** and **Turso** (libSQL), plus migrations and seeders. The package **re-exports Kysely**, so you don't install it separately.

> **Before you reach for a raw SQL client, an ORM, or `fetch('/api/...')`** — Cossack has a built-in `db()` helper. Use it inside `@Server()` methods.

## The two helpers

| Helper | Import | When to use |
|---|---|---|
| `db()` | `@cossackframework/database` | Inside a `@Server()` method or any code running within the request scope. Uses AsyncLocalStorage — no context argument needed. |
| `getDb(c)` | `@cossackframework/database` | When you have the Hono `Context` in hand (e.g. in middleware). Reads `c.get('db')`. |

Both return the same per-request Kysely client (`DbClient`). Prefer `db()` inside components — it's shorter and the request scope is already set up by the framework middleware.

There is **no** `this.db` property on components. Import `db()` and call it.

## Querying

`db()` returns a Kysely client, so you use the full Kysely query builder:

```typescript
import { db } from '@cossackframework/database';
import { Cossack, Page, Server, State } from '@cossackframework/core';

@Page({ transport: 'http' })
export class UsersPage extends Cossack {
    @State() users: { id: number; name: string }[] = [];

    @Server()
    async init() {
        this.users = await db()
            .selectFrom('users')
            .select(['id', 'name'])
            .orderBy('name', 'asc')
            .execute();
    }

    @Server()
    async createUser(name: string) {
        await db()
            .insertInto('users')
            .values({ name })
            .executeTakeFirstOrThrow();
    }
}
```

Because Kysely is re-exported, types like `Generated`, `Selectable`, `sql`, etc. all come from the same package:

```typescript
import { Generated, sql, type Selectable } from '@cossackframework/database';
```

## The constraint: only inside a request scope

`db()` resolves the client from AsyncLocalStorage. It **must** be called within a request handler — i.e. inside a `@Server()` method, a server middleware, or a `runWithDb(...)` block. Calling it outside a request throws:

```
[Cossack] No database client in scope. `db()` must be called within a request handler …
```

This is why database calls belong in `@Server()` methods, never in `@Client()` / `@Shared()` / `render()`. (Those run on the client, where there is no database.)

## Setup

Database support is **included by default** in new Cossack apps. To add it to an existing project:

```sh
npx cossack add database
```

This prompts for a dialect (D1 or Turso), scaffolds `src/db/config.ts`, the `dbMiddleware`, starter migrations, a `User` model, and the cache-table migration. For the full guide — dialects, connecting, transactions, migrations, seeders, and schema typing — see:

- `docs/database.md` — overview, connecting, transactions, CLI reference
- `docs/queries.md` — `db()` / `getDb()`, the Kysely builder, typing, request scoping
- `docs/migrations.md` — file format, `cossack migration up|down|status`
- `docs/seeders.md` — file format, `cossack seeder run`

## Dialects

| Dialect | Binding / client | Notes |
|---|---|---|
| `d1` | Cloudflare D1 binding (`env.DB`) | Custom dialect on Kysely 0.29. Transactions not supported (D1 limitation) — use `.batch()`. |
| `libsql` | Turso / libSQL client | From `@tursodatabase/serverless/compat` (recommended) or `@libsql/client/web`. Transactions supported. |

Connecting is done in `src/db/config.ts` via `createDatabase({ dialect, binding })` or `createDatabase({ dialect: 'libsql', client })`. See `docs/database.md` for details.
