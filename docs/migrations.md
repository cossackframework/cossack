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
