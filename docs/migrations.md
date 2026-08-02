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

## Migrating an older application

Back up the database, convert row interfaces and queries to decorated models,
run `cossack schema check`, resolve drift, then run
`cossack migration baseline`. Existing legacy bookkeeping tables are left
untouched.

D1 migrations use native batches for grouped statements. D1 batches are
transactional and roll back on failure; interactive `BEGIN`/`COMMIT` is not
emulated.
