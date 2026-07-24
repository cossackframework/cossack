# @cossackframework/database

Database support for the [Cossack Framework](https://github.com/cossackframework/cossack) — a type-safe query builder built on [Kysely](https://kysely.dev), with first-class dialects for **Cloudflare D1** and **Turso** (libSQL), plus migrations and seeders.

- Re-exports Kysely — no need to install it separately (`import { Kysely, Generated, sql } from '@cossackframework/database'`).
- Custom D1 and libSQL/Turso dialects written against Kysely 0.29 (the community `kysely-d1` / `kysely-libsql` packages are stale).
- Per-request client via Hono middleware **and** a global `db()` helper (AsyncLocalStorage).
- Kysely migrator + seeder runners, driven by the `cossack` CLI.

> Database support is included by the Database, Auth, and Full Stack recipes.
> Those recipes ship migrations, wire `dbMiddleware`, and register the database
> cache driver. The framework itself stays decoupled (no hard dependency).

## Install

Select the Database or Full Stack preset with `cossack create`, or add database
support to an existing project:

```bash
npx cossack add database
```

This scaffolds `src/models/`, `src/migrations/`, `src/seeders/`, and `src/db/config.ts`, adds the dependency to `package.json`, and (for D1) injects a `[[d1_databases]]` binding into `wrangler.jsonc`.

## Connecting

A Kysely client is created with `createDatabase()`, which selects the dialect. Pick one (the `cossack add database` command generates the right one for your chosen dialect):

**Cloudflare D1** — pass the binding:

```ts
import { createDatabase } from '@cossackframework/database'

export function createClient(env: { DB: D1Database }) {
  return createDatabase({ dialect: 'd1', binding: env.DB })
}
```

**Turso / libSQL** — pass a client built from `@tursodatabase/serverless/compat` (recommended, fetch-based) or `@libsql/client/web`. Works on Workers + Node:

```ts
import { createDatabase } from '@cossackframework/database'
import { createClient as createLibsqlClient } from '@tursodatabase/serverless/compat'

export function createClient(env: { TURSO_URL: string; TURSO_TOKEN?: string }) {
  return createDatabase({
    dialect: 'libsql',
    client: createLibsqlClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN }),
  })
}
```

The generated `src/db/config.ts` also exports a `getCliClient()` for the migration/seeder CLI commands (see [Migrations](../../docs/migrations.md)).

### Wiring the middleware

`cossack add database` registers the middleware in `src/bootstrap/middlewares.ts` — the project's global request middleware registry, which `createApp()` auto-loads. No `src/index.ts` edits:

```ts
// src/bootstrap/middlewares.ts
import type { MiddlewareHandler } from 'hono'
import { dbMiddleware } from '../middlewares/db'

const middlewares: MiddlewareHandler[] = [
  dbMiddleware,
]
export default middlewares
```

The middleware is defined in `src/middlewares/db.ts`:

```ts
// src/middlewares/db.ts
import { createDbMiddleware } from '@cossackframework/database'
import { createClient } from '../db/config'

export const dbMiddleware = createDbMiddleware({
  client: (c) => createClient(c.env),
})
```

This exposes the client on the request (`c.get('db')` / `getDb(c)`) and wraps the request in a scope so the global `db()` helper resolves to it.

## Querying

From a component method:

```ts
import { db } from '@cossackframework/database'

@Server()
async getUsers() {
  return await db().selectFrom('users').selectAll().execute()
}
```

From an API route:

```ts
import { getDb } from '@cossackframework/database'

export default async (c: Context) => {
  const users = await getDb(c).selectFrom('users').selectAll().execute()
  return c.json(users)
}
```

## Typing your schema

The `Database` interface (table → row) and the `User` (auth) interface are both empty by default and augmented from `src/models/`:

```ts
// src/models/User.ts
import type { Generated } from '@cossackframework/database'

export interface UserRow {
  id: Generated<string>
  email: string
  name: string
  passwordHash: string
}

declare module '@cossackframework/database' {
  interface Database { users: UserRow }
}

// Safe subset exposed as this.user / c.get('user') (no passwordHash)
declare module '@cossackframework/core' {
  interface User { id: string; email: string; name: string }
}
```

## Migrations & seeders (CLI)

```bash
cossack generate migration create_users
cossack migration up        # apply pending
cossack migration down      # revert the latest
cossack migration status

cossack generate seeder users
cossack seeder run
```

## Transactions

- **Turso / libSQL** supports interactive transactions via Kysely's `db().transaction().execute(async (trx) => { ... })`.
- **D1** does **not** support `BEGIN`/`COMMIT` through its binding. For atomic multi-statement writes, use the raw D1 binding's `.batch([...])` with prepared statements (e.g. `c.env.DB.batch([...])`) — Kysely has no `.batch()`; for single-statement writes, just call the Kysely builder directly.

The migrator is unaffected — the SQLite adapter reports `supportsTransactionalDdl: false`, so each migration runs without a transaction wrapper.

## Dialects

| Dialect | Config | Where it runs | Driver |
|---|---|---|---|
| **D1** | `{ dialect: 'd1', binding: env.DB }` | Cloudflare Workers | The D1 binding (no extra dep) |
| **Turso / libSQL** | `{ dialect: 'libsql', client }` | Workers + Node | `@tursodatabase/serverless/compat` (recommended) or `@libsql/client/web` |

Postgres and MySQL adapters are planned for a later release.

## No build step

This package is **published and consumed as TypeScript source** — there is no `build` script and no `dist/` directory, just like `@cossackframework/auth`. The `package.json` entry points straight at `src/index.ts`:

```json
{
  "main": "src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "import": "./src/index.ts" } },
  "files": ["src"]
}
```

Consumers compile it at their own build/run time:

- **User apps** — the framework's Vite build bundles it into the Worker (SSR) bundle; it never reaches the client bundle (server-only).
- **The `cossack` CLI** — the `migration` / `seeder` commands run under `tsx`, which loads the `.ts` source directly.

This keeps the source debuggable, avoids a stale `dist/` to rebuild before every change, and means the publish workflow needs no build step — it runs `pnpm publish --filter @cossackframework/database` straight from `src/`.

To work on this package locally: edit files under `src/`, then run `pnpm vitest --run` from the package directory (or `pnpm tsc --noEmit` to typecheck). The [root tsconfig](../tsconfig.json) maps `@cossackframework/database` to `./packages/database/src` so workspace consumers resolve your edits immediately.

## License

MIT
