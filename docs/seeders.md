---
title: 'Seeders'
description: 'Populate your database with seed data — generate seeder files and run cossack seeder run, including the --only filter and ordering.'
---

# Seeders

Seeders populate your database with initial or development data — an admin user, reference rows, demo content. Each seeder is a TypeScript file under `src/seeders/` whose default export has a `run(db)` method. The CLI runs them in order against your database client.

## File format

A seeder default-exports an object with an async `run` method that receives the Kysely client:

```ts
// src/seeders/database.seeder.ts
import type { DbClient } from '@cossackframework/database';

export default {
  async run(db: DbClient) {
    await db.insertInto('users').values({
      id: crypto.randomUUID(),
      email: 'admin@cossack.dev',
      name: 'Admin',
      passwordHash: '$2a$10$...', // hash a real password in production
      createdAt: new Date().toISOString(),
    }).execute();
  },
};
```

You can also default-export a `Seeder` class instance or any object with a `run` method — the runner accepts `module.default ?? module`, so a named `run` export works too.

## Generating a seeder

```sh
npx cossack generate seeder users
# creates: src/seeders/users.ts
```

The generated stub:

```ts
import type { DbClient } from '@cossackframework/database';

export default {
  async run(db: DbClient) {
    // TODO: seed your database — e.g.
    // await db.insertInto('users').values({ email: 'demo@cossack.dev' }).execute();
  },
};
```

## Running seeders

```sh
cossack seeder run                # run all seeders in src/seeders/
cossack seeder run --only users   # run only seeders whose filename contains "users"
```

The runner:

1. Loads `src/db/config.ts` → `getCliClient()` to build the client (same as [migrations](/docs/migrations.md)).
2. Imports every `.ts`/`.js` file in `src/seeders/` (skipping `.d.ts`), sorted alphabetically by filename.
3. Calls each file's `run(db)` in order.
4. Destroys the client when done.

Prefix filenames with a number if order matters: `0001_roles.seeder.ts`, `0002_users.seeder.ts`, ...

### Output

```
Ran 3 seeder(s):
  0001_roles.seeder.ts
  0002_users.seeder.ts
  database.seeder.ts
```

Or, when there are none:

```
No seeders found in src/seeders/.
```

## Idempotency

Seeders are **not** idempotent by default — running `seeder run` twice inserts rows twice. Make your seeders safe to re-run when that matters:

```ts
export default {
  async run(db: DbClient) {
    // Only insert if the row doesn't exist yet.
    const existing = await db
      .selectFrom('users')
      .where('email', '=', 'admin@cossack.dev')
      .selectAll()
      .executeTakeFirst();
    if (!existing) {
      await db.insertInto('users').values({ ... }).execute();
    }
  },
};
```

Or use `INSERT ... ON CONFLICT DO NOTHING` via Kysely's `onConflict`:

```ts
await db
  .insertInto('users')
  .values({ id, email, name, passwordHash, createdAt })
  .onConflict((b) => b.column('email').doNothing())
  .execute();
```

## Environment

Seeders typically run against your **development** database (the same client `getCliClient()` returns for migrations — see [Database](/docs/database.md)). For Turso this is your dev database via `TURSO_URL`/`TURSO_TOKEN`; for D1 this is a local SQLite file (or a remote D1 if you point the config at one).

> Never seed a production database by accident. Seeders run whatever `getCliClient()` returns — double-check your env vars before `cossack seeder run` in a production shell.

## API reference

The library primitive (used by the CLI runner; also available for programmatic use):

| Export | Description |
|---|---|
| `runSeeders({ client, folder?, only? })` | Import and run each seeder in `folder` (default `<cwd>/src/seeders`). Returns the list of filenames run. |
| `Seeder` | The interface: `{ run(db: DbClient): Promise<void> }`. |
| `defaultSeedersFolder()` | Resolves to `<cwd>/src/seeders`. |

Like the migration primitives, `runSeeders` does **not** destroy the client — the caller owns its lifecycle.

## CLI reference

| Command | Description |
|---|---|
| `cossack generate seeder <name>` | Scaffold `src/seeders/<name>.ts`. |
| `cossack seeder run [--only <name>]` | Run all (or matching) seeders. |

`seeder` also has the alias `seed`.
