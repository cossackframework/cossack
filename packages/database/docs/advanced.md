---
title: Advanced Usage
description: Work with scopes, transactions, reserved connections, logging, metadata, errors, naming strategies, and custom adapters.
---

# Advanced Usage

## Request and async scopes

Static Active Record methods and the global `sql` tag resolve the current ORM
through async-local scope:

```ts
await orm.run(async () => {
  const user = await User.findOne({
    where: { id: 1 },
  });

  await sql`SELECT ${1}`;
});
```

Put one scope around the outer unit of work. Nested calls reuse the current
scope, so helper functions do not need to receive or reopen it.

The Cossack/Hono integration installs the scope as middleware:

```ts
import { ormMiddleware } from "@cossackframework/database/cossack";

app.use("*", ormMiddleware(orm));
```

Concurrent request scopes remain isolated when the runtime adapter supplies
async-local storage.

## Transactions and savepoints

```ts
await orm.transaction(async () => {
  const account = await Account.findOne({
    where: { id: accountId },
  });

  if (!account) throw new Error("Account not found");

  account.balance -= amount;
  await account.save();

  await LedgerEntry.create({
    accountId,
    amount: -amount,
  }).save();
});
```

`orm.transaction()` creates a scope automatically when called outside
`orm.run()`. Active Record calls and the global SQL tag inside the callback use
the transaction driver.

Nested transactions use savepoints:

```ts
await orm.transaction(async () => {
  await User.create({ email: "ada@example.com" }).save();

  await orm.transaction(async () => {
    await AuditEvent.create({ action: "user.created" }).save();
  });
});
```

If an adapter does not support savepoints, nested transactions throw
`UnsupportedCapabilityError`. D1 also rejects top-level interactive
transactions.

## Reserved connections

Reserve a connection when several non-transactional statements must use the same
session:

```ts
await orm.reserve(async () => {
  await orm.sql`SELECT set_config('application_name', ${"worker"}, false)`;
  const result = await orm.sql`SELECT current_setting('application_name')`;
});
```

Reservation support is capability-dependent. Always let the callback finish so
the adapter can release the client deterministically.

## Query logging

Pass a logger object:

```ts
const orm = createORM({
  adapter,
  entities,
  logger: {
    query(event) {
      console.log({
        sql: event.sql,
        parameters: event.parameters,
        durationMs: event.durationMs,
        dialect: event.dialect,
        operation: event.operation,
        error: event.error,
      });
    },
  },
});
```

Instrumentation includes compiled SQL, redacted parameter descriptions,
duration, dialect, operation, and an optional error. Parameter values are not
placed directly in logger events.

## Custom naming strategies

```ts
import {
  defaultNamingStrategy,
  type NamingStrategy,
} from "@cossackframework/database";

const namingStrategy: NamingStrategy = {
  ...defaultNamingStrategy,
  tableName(entityName) {
    return `app_${defaultNamingStrategy.tableName(entityName)}`;
  },
};

const orm = createORM({
  adapter,
  entities,
  namingStrategy,
});
```

A strategy controls table names, column names, relation join columns, and join
table names. Explicit decorator names always take precedence.

## Schema metadata and introspection

`orm.schema()` returns the finalized logical model graph:

```ts
const modelSchema = orm.schema();
```

`orm.introspect()` returns the adapter's view of the physical database:

```ts
const databaseSchema = await orm.introspect();
```

Both use the versioned, serializable `OrmSchema` contract:

```ts
import type {
  ColumnSchema,
  EntitySchema,
  OrmSchema,
  RelationSchema,
} from "@cossackframework/database";
```

Tooling can compare them:

```ts
import {
  describeOperation,
  diffSchemas,
} from "@cossackframework/database";

const diff = diffSchemas(
  await orm.introspect(),
  orm.schema(),
);

for (const operation of diff.operations) {
  console.log(describeOperation(operation));
}
```

Pass `{ allowDestructive: true }` only after the caller has made a deliberate
safety decision.

## Error handling

Normalized error classes include:

- `ConfigurationError`
- `MetadataError`
- `ScopeError`
- `QueryError`
- `UnsupportedCapabilityError`
- `DestructiveSchemaChangeError`
- `MigrationError`
- `SeederError`

```ts
import {
  QueryError,
  UnsupportedCapabilityError,
} from "@cossackframework/database";

try {
  await orm.transaction(work);
} catch (error) {
  if (error instanceof UnsupportedCapabilityError) {
    console.error(error.capability, error.dialect);
  } else if (error instanceof QueryError) {
    console.error(error.sql, error.cause);
  }
}
```

Capability errors are intentional: the ORM does not silently emulate
transactions, savepoints, returning clauses, reservation, or cancellation.

## Custom adapters

Third-party integrations import public contracts from the adapter entry point:

```ts
import type {
  Adapter,
  Driver,
  DriverCapabilities,
  QueryResult,
} from "@cossackframework/database/adapter";

const capabilities = {
  transactions: false,
  savepoints: false,
  returning: true,
  batch: false,
  reserveConnection: false,
  cancellation: false,
  parameterLimit: 999,
  batchLimit: 100,
} satisfies DriverCapabilities;

const driver: Driver = {
  dialect: "sqlite",
  capabilities,

  async execute(query, operation = "raw"): Promise<QueryResult> {
    // Bind query.parameters; never concatenate them into query.text.
    return {
      rows: [],
      meta: {
        durationMs: 0,
        dialect: "sqlite",
        operation,
        rowsAffected: 0,
      },
    };
  },

  async close() {},
};

const adapter: Adapter = { driver };
```

Drivers own execution, pooling, transactions, reservation, cancellation, result
normalization, and physical introspection. Dialects own quoting, placeholders,
DDL rendering, type mapping, and SQL capabilities.

Supply a `ScopeStorage` implementation when the runtime supports concurrent
requests and static Active Record methods.

## Cossack stores

The Cossack entry point also provides:

```ts
import {
  createDatabaseCacheStore,
  createDatabaseSessionStore,
  ormMiddleware,
} from "@cossackframework/database/cossack";
```

These helpers execute through the ORM driver contract and share the same
request/transaction scope. Their backing tables must be created by application
migrations.
