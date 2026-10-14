---
title: 'ORM migrations'
description: 'Deterministic migrations, schema drift checks, and baselines.'
---

# ORM migrations

Migrations implement the ORM `Migration` contract and are registered
deterministically in `src/migrations/index.ts`.

```ts
import type { Migration } from '@cossackframework/database';

export default {
  name: '0008_create_posts',
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE posts (
        id VARCHAR(191) PRIMARY KEY,
        title TEXT NOT NULL
      )
    `));
  },
  down({ schema }) {
    schema.dropTable('posts');
  },
} satisfies Migration;
```

`orm.config.ts` imports the migration barrel:

```ts
export default defineConfig({
  adapter: createToolingAdapter,
  entities: models,
  migrations,
  seeds,
});
```

## Commands

```sh
cossack migration generate add_posts
cossack migration up
cossack migration down
cossack migration status
cossack migration rehash 0010_create_addresses 0011_create_outreach_records
cossack migration check
cossack migration baseline
cossack schema pull
cossack schema diff
cossack schema check
```

Applied migrations use `_cossack_migrations` with deterministic checksums.
Changed applied files fail checks. Schema commands compare physical
introspection with the logical schema emitted by decorators.

There are no postinstall, dev-start, or request-start migration hooks.

## Accepting an intentional migration edit

A checksum records the migration definition that you applied. The default commands
reject changes to applied definitions. Add a new migration for normal schema changes.

If you intentionally reset or rebuild affected objects, review the current definitions
and the database before accepting them. Preview the named checksum updates first:

```sh
pnpm exec cossack migration status
pnpm exec cossack migration rehash 0010_create_addresses 0011_create_outreach_records --dry-run --json
pnpm exec cossack migration rehash 0010_create_addresses 0011_create_outreach_records
```

`rehash` updates only the stored checksums for the named applied migrations.
It preserves their batch numbers, application dates, and all other history rows.
It does not run `up` or `down`, change the schema, or establish that the schema matches the edited definitions.
Future rollbacks use the edited `down` definition. Review that definition before accepting the edit.

The command requires at least one name. It rejects unknown names, pending migrations,
and duplicate names before writing any checksum. Other changed migrations continue
to block normal migration commands. Adapters with transactions use one transaction.
Adapters with native batches use one batch, within the provider limit.

`migration status` prints stored and current checksums for changed entries.
JSON status results already include the current `checksum` and the stored `applied.checksum`.
The runner also exposes `rehash(names, { dryRun: true })` for previews and
`rehash(names)` to accept the selected definitions.

### What the checksum covers

Generated migrations declare `operations` (SQL statements). Their checksum
hashes those operations, so it is the same in every build. This is the stable
form. Prefer it for every migration that must keep its checksum.

A hand-written migration that has only `up()` and `down()` callbacks has no
operations to hash. Its checksum hashes the source text of the two functions,
as JavaScript sees it at run time. Before hashing, the runner removes comments,
collapses whitespace, treats `;` as whitespace, removes trailing commas, and
rewrites single-quoted strings with double quotes. Thus a formatter, `tsx`, or a
bundler that only reformats the code does not change the checksum. A build
that rewrites the code itself (for example, it renames variables, minifies, or
transpiles `async` functions to an older target) still changes it. If CI uses
such a build, move the migration to `operations`.

Checksums that earlier releases stored for callback migrations (from the raw
source text) are still accepted for unchanged migrations.

## Environments and plans

```sh
pnpm exec cossack migration plan --env staging --target remote --json
pnpm exec cossack migration up --env staging --target remote --dry-run --json
pnpm exec cossack migration up --env staging --target remote
```

Targets default to local. Generated D1 tooling selects the requested
environment with the project's Wrangler and shares local state with Wrangler
development. Remote D1 commands require a provisioned database ID.

Plans report SQL, destructive operations, parameter counts, and completeness.
They do not create migration history or apply queued SQL. A callback that needs
live database queries produces an incomplete plan. `--direction down` previews
the most recent reversal. Seed dry runs list selected callbacks without running
them and do not claim to predict their SQL.

JSON commands emit versioned results with target context and diagnostics.
Migration status and checks read existing history without creating it.

## Migrating an older application

Back up the database, convert row interfaces and queries to decorated models,
run `cossack schema check`, resolve drift, then run
`cossack migration baseline`. Existing legacy bookkeeping tables are left
untouched.

D1 migrations use native batches for grouped statements. D1 batches are
transactional and roll back on failure. Interactive `BEGIN`/`COMMIT` is not
emulated.
