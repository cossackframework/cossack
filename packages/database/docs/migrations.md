---
title: Migrations
description: Generate, review, apply, revert, baseline, and inspect deterministic database migrations.
---

# Migrations

Migrations are explicit, versioned changes to a database schema. Cossack ORM
never synchronizes models to the database during application startup.

The normal workflow is:

1. Change decorated models.
2. Generate a migration from the committed model snapshot diff.
3. Review its generated forward and inverse SQL.
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
  migrationDirectory: "./migrations",
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

Existing projects first record their current decorated models once:

```sh
cossack-orm migration snapshot
```

This writes `.cossack-schema.json` inside `migrationDirectory`. Commit the
snapshot with the migrations. It is model metadata, not a database dump.

```sh
cossack-orm migration generate add_user_profiles
```

Choose another output path when needed:

```sh
cossack-orm migration generate add_user_profiles \
  --output ./src/database/migrations/0003_add_user_profiles.ts
```

Generation compares the committed model snapshot with current decorated model
metadata. It does not introspect the database. Adding or removing a `@Column()`,
entity, rename marker, or index produces deterministic TypeScript containing
reviewable `operations.up` and inverse `operations.down` SQL. The snapshot advances only after the
migration file is written successfully. When the output is directly inside
`migrationDirectory` and its `index.ts` exports the standard `migrations` array,
the generator registers the new migration automatically; otherwise it prints a
registration reminder.

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

## Squash migration history

Create one baseline migration directly from the current models:

```sh
cossack-orm migration squash 0001_schema
```

After reviewing it, prune the replaced migration source files and rewrite the
migration barrel:

```sh
cossack-orm migration squash 0001_schema --prune
```

The squashed migration records the migration names it replaces. On a fresh
database its full schema is applied. On an existing database where every
replaced migration is already applied, `migration up` consolidates only the
bookkeeping and does not replay schema creation. A partially applied replacement
set is rejected. Squashed baselines are intentionally not reversible.

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

## Targets and plans

Select the environment and database target explicitly:

```sh
pnpm exec cossack migration plan --env staging --target remote --json
pnpm exec cossack migration up --env staging --target remote --dry-run --json
pnpm exec cossack migration up --env staging --target remote
```

`--local` and `--remote` are aliases for `--target`. The default is local.
The selected environment also accepts `CLOUDFLARE_ENV`. Adapter factories
receive an `ORMToolingContext` with the project root, config path, environment,
target, and `readOnly` flag. A remote command requires a factory so the adapter
can honor that selection. See [D1 tooling](./runtimes.md#d1-tooling) for generated
Cloudflare projects.

`plan` reads migration history without creating its table and never executes
migration callbacks. Generated migrations declare authoritative `operations` for
`up` and `down`. Those same operations drive execution; callbacks cannot override
them. Each entry includes its direction, checksum, mode, ordered SQL, affected
objects, parameter counts, risk, target connection identity, atomicity and
provider limitations. Parameter values are omitted. Raw SQL object discovery and
risk classification are conservative; `affectedObjectsComplete: false` makes
that limit explicit. Review the SQL itself.
Use `--direction down` to preview the most recent reversal. A squash that
replaces fully applied migrations reports `mode: "consolidate"` without
replaying application SQL.

For a remote smoke test, first point a named Wrangler environment such as
`staging` at a dedicated disposable D1 database. Review its resolved target and
plan, then apply only the reviewed migration set:

```sh
pnpm exec cossack migration plan --env staging --target remote --json
pnpm exec cossack migration up --env staging --target remote --dry-run --json
pnpm exec cossack migration up --env staging --target remote
pnpm exec cossack migration check --env staging --target remote --json
```

This is an opt-in procedure and has not been run against a live account by the
release verification. Never point it at production for a smoke test. Remote
commands require `--target remote` (or `--remote`); an environment name alone
always uses local state.

Legacy callbacks remain executable through explicit `up()` and `down()`, but
planning reports them as incomplete without invoking them. This is an intentional
0.9 change: a disconnected ORM cannot stop a callback from writing files, calling
external services, or using another captured connection. Configuration module
loading is still trusted application code; this boundary does not sandbox imports.

For application-controlled review and apply in one process:

```ts
const runner = new MigrationRunner(orm, migrations);
const plan = await runner.plan();
// Review plan, including incomplete entries and provider limitations.
await runner.applyPlan(plan);
```

`applyPlan()` accepts only the exact plan returned by that live runner. It rejects
incomplete plans and rechecks all migration definitions, checksums, history and
target identity before writing. Its private SQL/parameter snapshot prevents later
application mutations from changing the approved batch. JSON reports are inspection
artifacts; they cannot be imported as executable approvals. Separate CLI invocations
must replan on their selected target. Concurrent external writers still need a
provider-specific deployment lock; history rechecks are not a distributed lock.

Bookkeeping SQL is reported separately, including squash consolidation deletes
and the replacement history insert. Missing declarative `down` operations mean a
reversal is unknown and cannot be applied from a plan. MySQL DDL can commit
implicitly; a transaction is not a guarantee of schema rollback. Providers with
neither transactions nor an atomic batch report possible partial application.

`--dry-run` also previews snapshot, generate, squash, and schema pull file
changes without writing them. `status` and `check` read history without
initializing bookkeeping. JSON commands emit one `schemaVersion: 1` envelope
with `ok`, target context, resolved adapter identity when available, results,
and diagnostics. Invalid flags, conflicting targets, and extra arguments fail
before opening the adapter.

JSON commands execute configuration and adapters in a child process. Console
messages, direct stdout/stderr writes, and inherited subprocess output are
suppressed; the structured result returns over IPC. This keeps Wrangler
connection logs out of JSON and prevents configuration code from changing the
calling process's environment. It is output isolation, not a sandbox for
application code. Unexpected child termination produces
`COSSACK_ORM_PROCESS_FAILED`; text mode retains raw diagnostics.

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

Unlike model-first migration generation, schema commands inspect the live
database. Destructive differences also require `--allow-destructive` for
`schema diff` and `schema check`.

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
