---
title: Multiple SQLite Connections
description: Run two independent SQLite databases with explicit model managers, migrations, and application-side joins.
---

# Multiple SQLite connections

This example uses two independent ORM instances:

| Connection | File | Model |
| --- | --- | --- |
| `db1` | `.data/db1.sqlite` | `User` |
| `db2` | `.data/db2.sqlite` | `AuditEvent` |

Each connection owns its adapter, entity list, migrations, transaction scope,
and migration bookkeeping table.

## Run

From the repository root:

```sh
pnpm example:multiple-connections
```

The workflow:

1. Opens or creates both SQLite files.
2. Applies each database's migrations concurrently.
3. Seeds each database in its own transaction.
4. Queries both through explicit model managers.
5. Combines users and audit events in application code.
6. Closes both ORM instances.

The seed writes use stable unique keys and upserts, so the command is
idempotent.

To start with empty database files:

```sh
pnpm example:multiple-connections:reset
```

Reset is recoverable. Existing files are moved to timestamped `.backup` files
under `.data/`.

## Why explicit model managers?

Code touching more than one connection should make the destination visible:

```ts
const users = await databases.db1.model(User).find();
const events = await databases.db2.model(AuditEvent).find();
```

Avoid nesting `db1.run()` and `db2.run()` around static Active Record calls.
Both scopes would be active in one asynchronous chain, so a static model could
not safely infer the intended connection.

Relations do not cross ORM instances. This example stores `userEmail` in db2
and joins the two result sets in application code.

Transactions are also connection-local. Committing a db1 transaction and a db2
transaction does not create a distributed transaction.

## Separate CLI configurations

Each database has its own config:

```sh
pnpm exec tsx ./src/cli.ts migration status \
  --config ./examples/multiple-connections/orm.db1.config.ts

pnpm exec tsx ./src/cli.ts migration status \
  --config ./examples/multiple-connections/orm.db2.config.ts
```

Apply them independently:

```sh
pnpm exec tsx ./src/cli.ts migration up \
  --config ./examples/multiple-connections/orm.db1.config.ts

pnpm exec tsx ./src/cli.ts migration up \
  --config ./examples/multiple-connections/orm.db2.config.ts
```
