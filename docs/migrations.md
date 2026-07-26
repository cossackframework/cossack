---
title: 'Migrations'
description: 'Manage your database schema with Kysely migrations — generate files, run cossack migration up/down/status, and the local-vs-remote workflow for D1 and Turso.'
---

# Migrations

Schema changes are managed with [Kysely's `Migrator`](https://kysely.dev/docs/migrations), driven by the `cossack` CLI. Migrations are plain TypeScript files under `src/migrations/`, executed in alphabetical order and tracked in a bookkeeping table.

## File format

A migration exports async `up` (required) and `down` (optional) functions that receive a Kysely instance:

```ts
// src/migrations/0001_create_users.ts
import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('email', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').ifExists().execute();
}
```

You can use any Kysely schema-builder method — `createTable`, `addColumn`, `alterTable`, `createIndex`, etc. `Kysely<any>` is used because a migration runs against any schema (the migrator owns its own connection).

## Generating a migration

```sh
npx cossack generate migration create_posts
# creates: src/migrations/2026_06_30_143012_create_posts.ts
```

The filename is `<timestamp>_<snake_case_name>.ts`. The timestamp (UTC, `YYYY_MM_DD_HHMMSS`) keeps files sorted chronologically. The generated stub:

```ts
import type { Kysely } from '@cossackframework/database';

export async function up(db: Kysely<any>): Promise<void> {
  // TODO: forward migration — e.g. db.schema.createTable(...).execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // TODO: reverse the migration above.
}
```

## Running migrations

```sh
cossack migration up         # apply all pending migrations
cossack migration down       # revert the most recent migration
cossack migration status     # list migrations and their state
```

Output of `migration status`:

```
  ✓ 0001_create_users  —  ran 2026-06-30T14:30:12.000Z
  · 0002_create_posts  —  pending
```

### How the runner finds your client

The CLI loads `src/db/cli.ts` and calls its `getCliClient()` export to build the
Kysely client, then runs the migrator against it. Runtime request handling uses
the separate `src/db/config.ts` module, so Node-only CLI dependencies never
enter the application bundle. See [Database](/docs/database.md) for the D1 and
Turso variants.

The runner discovers migration files in `src/migrations/` (sorted alphabetically) via Kysely's `FileMigrationProvider`.

### The migration table

Kysely records applied migrations in a `kysely_migration` table (plus a `kysely_migration_lock` table for safety). Don't rename this table after your first migration — Kysely would see an empty history and try to re-run everything. You usually never need to touch it.

## Local development

The migrator runs under `tsx` (the CLI respawns itself with the loader, same as `cossack ssg`), so your `.ts` migration files are loaded directly.

### D1

D1 normally exists inside a Worker. For local migration development, the
generated `getCliClient()` asks Wrangler for a proxy to the configured local D1
binding:

```ts
// src/db/cli.ts (D1, generated)
export async function getCliClient() {
  const { getPlatformProxy } = await import('wrangler');
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    remoteBindings: false,
  });
  const client = createDatabase({ dialect: 'd1', binding: platform.env.DB });
  const destroyClient = client.destroy.bind(client);
  client.destroy = async () => {
    try {
      await destroyClient();
    } finally {
      await platform.dispose();
    }
  };
  return client;
}
```

Wrangler's default persistence directory is shared with the Cloudflare Vite
plugin, so `cossack migration up` and `pnpm dev` use the same local database.
The generated `pnpm dev` script applies pending migrations automatically before
starting Vite.

To apply migrations to the **production** D1 database, wire `getCliClient()` to a remote D1 client (or run the migrations inside a deploy step / Worker route).

### Turso

For Turso, `getCliClient()` simply reads `TURSO_URL` and `TURSO_TOKEN` and connects over HTTP — local and remote are the same path, just different env vars:

```ts
// src/db/cli.ts (Turso, generated)
export async function getCliClient() {
  return createClient();
}
```

Put your credentials in `.dev.vars` (for `wrangler`) or your shell, then run `cossack migration up`.

## Transactions

Each migration is **not** wrapped in a transaction — the SQLite adapter reports `supportsTransactionalDdl: false`, which matches D1's lack of interactive transactions. If a migration fails partway, earlier statements in that file have already been applied. Keep migrations small and focused, and always provide a `down` so you can revert.

For multi-statement schema changes that must be atomic, split them into separate migration files (each applied independently) rather than relying on a transaction inside one file.

## Default migrations

New Cossack projects ship six starter migrations (also scaffolded by `cossack add database` for existing projects):

| File | Tables |
|---|---|
| `0001_create_users.ts` | `users` |
| `0002_create_sessions.ts` | `sessions` |
| `0003_create_roles.ts` | `roles` |
| `0004_create_permissions.ts` | `permissions`, `role_permissions` (join) |
| `0005_create_oauth_accounts.ts` | `oauth_accounts` |
| `0006_create_cache_table.ts` | `cache_items` (for the database cache driver) |

These are the foundation for [Authentication](/docs/authentication.md), [Authorization](/docs/authorization.md), [Social Login](/docs/oauth.md), and database-backed caching. Edit them freely to match your schema before you run `migration up` for the first time.

## API reference

The library primitives (used by the CLI runner; also available for programmatic use):

| Export | Description |
|---|---|
| `runMigrations(direction, { client, folder?, migrationTableName? })` | Apply (`'up'`/`'latest'`) or revert one (`'down'`). |
| `resetMigrations({ client, ... })` | Revert all migrations. |
| `getMigrationStatus({ client, ... })` | Return `{ name, executedAt? }[]`. |
| `formatMigrationResult(result)` | Human-readable summary string. |
| `defaultMigrationsFolder()` | Resolves to `<cwd>/src/migrations`. |

The primitives do **not** destroy the client — the caller owns its lifecycle (the CLI runner destroys it in a `finally`).

## CLI reference

| Command | Description |
|---|---|
| `cossack generate migration <name>` | Scaffold `src/migrations/<timestamp>_<name>.ts`. |
| `cossack migration up` | Apply all pending migrations (`migrateToLatest`). |
| `cossack migration down` | Revert the most recent migration (`migrateDown`). |
| `cossack migration status` | List migrations and whether each has run. |

`migration` also has the alias `migrate`.
