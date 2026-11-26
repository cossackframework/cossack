---
title: "Studio"
description: "A local, browser-based database inspector for Cossack applications."
---

# Studio

`@cossackframework/studio` is a database inspector that runs on your machine. It reads the
project's `orm.config.ts` through the application's installed ORM, so it sees the same
database and models as the application. It runs on Node.js only.

```sh
cossack add studio   # also adds the database feature
pnpm install
pnpm studio
```

## Starting Studio

```sh
cossack studio
cossack studio --no-open --port 4983
cossack studio --driver postgres
cossack studio --remote --database DB --env production
```

Studio listens on a loopback address only. The printed URL holds a one-time token: the first
visit swaps it for an HttpOnly, `SameSite=Strict` cookie, and the token stops working. To open
Studio in another browser, restart it for a new URL.

Before it imports `orm.config.ts`, Studio loads the project's `.env` and `.dev.vars`; variables
already set in the shell win. `DB_CONNECTION` or `COSSACK_STUDIO_DRIVER` picks the driver when
several SQLite-family adapters could match. Credentials never reach the browser.

`--remote` opens the remote D1 database through the project's signed-in Wrangler. Changes there
reach deployed data at once.

## What it does

- Reads the schema of Cloudflare D1, SQLite, Turso, PostgreSQL and MySQL, and merges it with
  `orm.schema()`: logical types beside physical ones, relations and their source, and drift
  between models and tables. Migration bookkeeping tables are hidden.
- Browses rows with exact counts and pagination (100 rows by default), with inline and
  JSON-aware editing by key. A relation column opens the related rows (up to 50) below the row.
- Runs one SQL statement at a time, with highlighting and table and column completion. The
  console shows up to 1,000 rows and adds `LIMIT 1001` to queries that have no limit.
- Applies batch updates and deletes in one transaction on SQLite, Turso, PostgreSQL and MySQL.
  D1 has no interactive transactions, so a batch there can stop part way, and the error says
  how many rows changed.

The schema is cached. Studio reads it again after statements that can change it, and the Browse
tab's refresh button reads it again for changes made elsewhere.

## Programmatic use

```ts
import { inspectStudioProject, runStudio } from '@cossackframework/studio';

const facts = await inspectStudioProject({ projectRoot: process.cwd(), environment: 'staging', target: 'local' });
await runStudio({ projectRoot: process.cwd(), port: 4983, open: true });
```

`inspectStudioProject` returns read-only facts about the database: driver capabilities, the
physical and model schema, relations, and applied or pending migrations. It never creates
tables or applies migrations.

See also [Database](/docs/database.md) and [`cossack schema`](/docs/cossack-cli.md#cossack-schema-pulldiffcheck).
