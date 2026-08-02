---
title: Migrations
description: Generate, review, apply, revert, baseline, and inspect deterministic database migrations.
---

# Migrations

Migrations are explicit, versioned changes to a database schema. Cossack ORM
never synchronizes models to the database during application startup.

The normal workflow is:

1. Change decorated models.
2. Generate a migration from the schema diff.
3. Review its SQL and write the inverse migration.
4. Apply it in development and CI.
5. Commit the model and migration together.

## Configuration

Register migrations in `orm.config.ts`:

```ts
import { defineConfig } from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";
import { entities } from "./src/models/index.js";
import { migrations } from "./migrations/index.js";

export default defineConfig({
  adapter: () => nodeSQLite({ filename: "app.db" }),
  entities,
  migrations,
});
```

Keep their configured names stable and unique:

```ts
import createUsers from "./0001_create_users.js";
import createPosts from "./0002_create_posts.js";

export const migrations = [
  createUsers,
  createPosts,
] as const;
```

## Generate a migration

```sh
cossack-orm migration generate add_user_profiles
```

Choose another output path when needed:

```sh
cossack-orm migration generate add_user_profiles \
  --output ./src/database/migrations/0003_add_user_profiles.ts
```

Generation compares `orm.introspect()` with decorated model metadata. The
output is deterministic TypeScript containing reviewable SQL statements.
Generated `down()` methods intentionally require review and implementation
before a migration can be safely reverted.

A migration has this contract:

```ts
import {
  sql,
  type Migration,
} from "@cossackframework/database";

export default {
  name: "0003_add_user_profiles",

  up({ schema }) {
    schema.raw(sql.unsafe(
      "ALTER TABLE users ADD COLUMN biography text",
    ));
  },

  down({ schema }) {
    schema.dropColumn("users", "biography");
  },
} satisfies Migration;
```

`sql.unsafe()` is appropriate here only because the statement is trusted,
static, and reviewed. Use schema operations where they express the change
portably.

## Apply and revert

```sh
cossack-orm migration up
cossack-orm migration down
cossack-orm migration status
cossack-orm migration check
```

- `up` applies pending migrations in deterministic name order.
- `down` reverts the most recently applied migration by default.
- `status` reports pending, applied, or checksum-changed migrations.
- `check` fails unless all configured migrations are applied and unchanged.

Applied migrations are recorded in `_cossack_migrations` with their name,
SHA-256 checksum, batch, and application timestamp. Editing an applied migration
causes checksum validation to fail; create a new migration instead.

## Destructive changes

Dropping tables or columns and potentially narrowing column changes fail
generation/checking by default:

```sh
cossack-orm migration generate remove_legacy_data \
  --allow-destructive
```

Use this flag only after reviewing the generated operation and planning data
retention, backfills, and deployment ordering.

Renames are never guessed. Record their source explicitly:

```ts
@Entity({
  tableName: "accounts",
  renamedFrom: "users",
})
class Account extends BaseEntity {
  @Column({
    name: "display_name",
    renamedFrom: "name",
  })
  declare displayName: string;
}
```

## Schema commands

```sh
cossack-orm schema diff
cossack-orm schema check
cossack-orm schema pull
```

- `schema diff` describes physical/model differences.
- `schema check` fails when drift exists.
- `schema pull` generates decorated models with explicit physical names and
  logical types.

Destructive differences also require `--allow-destructive` for `schema diff`
and `schema check`.

By default, pulled models are written to `src/entities.generated.ts`. Existing
files are not overwritten unless `--force` is supplied:

```sh
cossack-orm schema pull \
  --output ./src/models/generated.ts \
  --force
```

Unknown physical database types are retained with a `custom:<type>` logical
type rather than discarded.

## Baseline an existing database

Baseline lets an existing deployment adopt migration bookkeeping without
replaying its historical schema creation:

```sh
cossack-orm migration baseline
```

The CLI first verifies that the live database matches current model metadata.
Only then does it record the schema hash. Resolve drift before baselining.

## Programmatic runner

Framework CLIs can delegate to `MigrationRunner`:

```ts
import { MigrationRunner } from "@cossackframework/database";

const runner = new MigrationRunner(orm, migrations);

const applied = await orm.run(() => runner.up());
const status = await orm.run(() => runner.status());
```

Transactional adapters apply a migration and its bookkeeping together. D1 uses
an atomic prepared batch for schema statements plus bookkeeping.

See [Seeders](./seeders.md) for application data that may be safely rerun.
