---
title: 'Database'
description: 'Type-safe database support for Cossack — a Kysely-based query builder with first-class Cloudflare D1 and Turso dialects, migrations, and seeders.'
---

# Database

Cossack ships an optional database layer built on [Kysely](https://kysely.dev) — a type-safe SQL query builder that runs on Cloudflare Workers, Node.js, and the browser. It ships with first-class dialects for **Cloudflare D1** and **Turso** (libSQL), plus migrations and seeders driven by the `cossack` CLI.

- **Re-exports Kysely** — no need to install it separately. `import { Kysely, Generated, sql } from '@cossackframework/database'`.
- **Custom dialects** for D1 and Turso, written against Kysely 0.29's `Dialect` interface (the community `kysely-d1`/`kysely-libsql` packages are stale).
- **Per-request client** via Hono middleware **and** a global `db()` helper (AsyncLocalStorage) — same pattern as `__()`.
- **Migrations & seeders** under `src/migrations/` and `src/seeders/`, run with `cossack migration` / `cossack seeder`.

> Database support is **optional**. Apps that don't need a database pay nothing for it — the framework never imports the database package.

## In this section

- [Queries](/docs/queries.md) — `db()`, `getDb(c)`, the Kysely builder, typing, and request scoping.
- [Migrations](/docs/migrations.md) — file format, `cossack migration up|down|status`.
- [Seeders](/docs/seeders.md) — file format, `cossack seeder run`.

## Quick start

Add database support to your project:

```sh
npx cossack add database
```

This prompts for a **dialect** (default: D1) and scaffolds everything you need:

```
src/
├── models/User.ts                 # default User model + schema augmentations
├── migrations/                    # 5 starter migrations
│   ├── 0001_create_users.ts
│   ├── 0002_create_sessions.ts
│   ├── 0003_create_roles.ts
│   ├── 0004_create_permissions.ts
│   └── 0005_create_oauth_accounts.ts
├── seeders/database.seeder.ts     # example seeder
└── db/config.ts                   # client factory for requests + the CLI
```

It also:

- Adds `@cossackframework/database` to `package.json`.
- (D1) injects a `[[d1_databases]]` binding block into `wrangler.jsonc`.
- Registers `dbMiddleware` in `src/bootstrap/middlewares.ts` (the global request middleware registry).

Then install deps and apply the migrations:

```sh
pnpm install
cossack migration up
```

## Connecting

A Kysely client is created with `createDatabase()`, which selects the dialect:

```ts
import { createDatabase } from '@cossackframework/database';

// Cloudflare D1 — pass the binding
const db = createDatabase({ dialect: 'd1', binding: env.DB });

// Turso / libSQL — pass a client from @tursodatabase/serverless/compat
// (recommended, fetch-based) or @libsql/client/web
import { createClient } from '@tursodatabase/serverless/compat';

const db = createDatabase({
  dialect: 'libsql',
  client: createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }),
});
```

For the escape hatch — a pre-built client of any libSQL-compatible shape — use the `libsql` dialect and pass the client directly.

### The generated `src/db/config.ts`

`cossack add database` generates a config module that exports two functions:

- `createClient(env)` — builds the per-request client (used by the middleware).
- `getCliClient()` — builds a client for the CLI (migrations/seeders), which runs outside a Worker.

For **D1**, `getCliClient()` opens the same SQLite file dialect locally with `better-sqlite3` (install once: `pnpm add -D better-sqlite3`). For **Turso**, it reuses the HTTP client with `TURSO_URL` / `TURSO_TOKEN` from your environment. The same migration files run unchanged against the production database.

## Wiring the middleware

`cossack add database` registers the database middleware in **`src/bootstrap/middlewares.ts`** — the project's global request middleware registry (Laravel-style "kernel" list). `createApp()` auto-loads this file and runs each middleware on every request. You never edit `src/index.ts`:

```ts
// src/bootstrap/middlewares.ts (maintained by the CLI; edit freely)
import type { MiddlewareHandler } from 'hono';
import { dbMiddleware } from '../middlewares/db';

const middlewares: MiddlewareHandler[] = [
  dbMiddleware,
];

export default middlewares;
```

The middleware itself is defined in `src/middlewares/db.ts`:

```ts
// src/middlewares/db.ts
import { createDbMiddleware } from '@cossackframework/database';
import { createClient } from '../db/config';

export const dbMiddleware = createDbMiddleware({
  client: (c) => createClient(c.env),
});
```

> **Why a registry?** It decouples *defining* a middleware (in `src/middlewares/`) from *registering* it (one line in `src/bootstrap/middlewares.ts`). Adding/removing a feature is a clean one-line edit instead of surgery on your `createApp()` call. See [Middlewares](/docs/middlewares.md).

For **stateless HTTP clients** (Turso), you can pass a single shared instance instead of a factory in `src/middlewares/db.ts`:

```ts
export const dbMiddleware = createDbMiddleware({ client: sharedTursoClient });
```

## Querying

Once the middleware is registered, three equivalent ways to reach the client:

```ts
import { db, getDb } from '@cossackframework/database';

// 1. global helper (AsyncLocalStorage — no need to thread the context)
const users = await db().selectFrom('users').selectAll().execute();

// 2. from a route handler
export default async (c) => {
  const users = await getDb(c).selectFrom('users').selectAll().execute();
  return c.json(users);
};

// 3. from a Cossack component method
@Server()
async getUsers() {
  return await this.c.get('db').selectFrom('users').selectAll().execute();
}
```

See [Queries](/docs/queries.md) for the full builder API and request-scoping details.

## Typing your schema

The `Database` interface (table name → row type) is empty by default and augmented from your model files so the query builder is fully typed:

```ts
// src/models/User.ts
import type { Generated } from '@cossackframework/database';

export interface UserRow {
  id: Generated<string>;
  email: string;
  name: string;
  passwordHash: string;
}

declare module '@cossackframework/database' {
  interface Database {
    users: UserRow;
  }
}
```

Now `db().selectFrom('users')` knows every column, and `insertInto('users').values(...)` checks the row shape at compile time.

### The auth `User`

The `User` type used by `this.user` / `c.get('user')` is also augmentable. The default model exposes a **safe subset** (no `passwordHash`) to the request context:

```ts
// src/models/User.ts (continued)
declare module '@cossackframework/core' {
  interface User {
    id: string;
    email: string;
    name: string;
  }
}
```

See [Backend Context](/docs/context.md) for more on `this.user`.

## Dialects

| Dialect | Config | Where it runs | Driver |
|---|---|---|---|
| **D1** | `{ dialect: 'd1', binding: env.DB }` | Cloudflare Workers | The D1 binding (no extra dep) |
| **Turso / libSQL** | `{ dialect: 'libsql', client }` | Workers + Node | `@tursodatabase/serverless/compat` (recommended) or `@libsql/client/web` |

Postgres and MySQL adapters are planned for a later release.

### Transactions

- **Turso / libSQL** supports interactive transactions via Kysely's `db().transaction().execute(trx => ...)`.
- **D1** does **not** support `BEGIN`/`COMMIT` through its binding. For atomic multi-statement writes, use the raw D1 binding's `.batch([...])` with prepared statements; for single-statement writes, just call the Kysely builder directly.

See [Queries → Transactions](/docs/queries.md#transactions) for code. The migrator is unaffected (the SQLite adapter reports `supportsTransactionalDdl: false`, so each migration runs without a transaction wrapper).

## CLI reference

| Command | Description |
|---|---|
| `cossack add database` | Add database support (prompts dialect; scaffolds models, migrations, seeders, config; wires the entry). |
| `cossack generate model <Name>` | Scaffold a typed model under `src/models/`. |
| `cossack generate migration <name>` | Scaffold a timestamped migration under `src/migrations/`. |
| `cossack generate seeder <name>` | Scaffold a seeder under `src/seeders/`. |
| `cossack migration up` | Apply all pending migrations. |
| `cossack migration down` | Revert the most recent migration. |
| `cossack migration status` | List migrations and their state. |
| `cossack seeder run [--only <name>]` | Run all (or one) seeders. |

## API reference

| Export | Description |
|---|---|
| `createDatabase(config)` | Create a typed Kysely client (`D1Config` or `LibsqlConfig`). |
| `createDbMiddleware({ client })` | Hono middleware that exposes the client on the request and scopes `db()`. |
| `db()` | Global helper returning the per-request client (throws if called outside a request scope). |
| `getDb(c)` | Read the client off a Hono context (`c.get('db')`). |
| `runWithDb(client, fn)` | Run `fn` inside a database scope (used by the middleware; also for scripts/tests). |
| `D1Dialect`, `LibsqlDialect` | The custom dialect classes (advanced — for custom Kysely instances). |
| `runMigrations`, `getMigrationStatus`, `resetMigrations` | Migrator primitives (see [Migrations](/docs/migrations.md)). |
| `runSeeders` | Seeder primitive (see [Seeders](/docs/seeders.md)). |

Kysely's own exports (`Kysely`, `Generated`, `GeneratedAlways`, `sql`, `Insertable`, `Selectable`, `Migrator`, `FileMigrationProvider`, etc.) are all re-exported — you never need to install `kysely` separately.
