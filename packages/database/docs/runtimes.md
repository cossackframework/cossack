---
title: Runtimes
description: Configure runtime adapters, custom drivers, and multiple database connections across Node.js, Bun, and Workers.
---

# Runtimes

Runtime adapters live in isolated entry points so a neutral import does not
eagerly include Node built-ins, native SQLite packages, or unused drivers.

| Runtime entry | Adapters |
| --- | --- |
| `@cossackframework/database/node` | Node SQLite, better-sqlite3, PostgreSQL, MySQL, Turso, automatic `SQL` client |
| `@cossackframework/database/bun` | Native Bun SQL for SQLite, PostgreSQL, MySQL |
| `@cossackframework/database/cloudflare` | D1 and Hyperdrive PostgreSQL/MySQL |
| `@cossackframework/database/cloudflare-turso` | Remote Turso for Workers |
| `@cossackframework/database/adapter` | Public contracts for custom adapters |

## Node.js

Node 22's built-in SQLite:

```ts
import { createORM } from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";

const orm = createORM({
  adapter: await nodeSQLite({
    filename: "app.db",
    foreignKeys: true,
  }),
  entities,
});
```

The default filename is `:memory:` and foreign keys are enabled by default.

Use better-sqlite3 when an application already depends on it:

```sh
pnpm add better-sqlite3
```

```ts
import { betterSQLite } from "@cossackframework/database/node";

const adapter = await betterSQLite({ filename: "app.db" });
```

PostgreSQL:

```sh
pnpm add pg
```

```ts
import { postgres } from "@cossackframework/database/node";

const adapter = await postgres(process.env.DATABASE_URL!);
```

MySQL:

```sh
pnpm add mysql2
```

```ts
import { mysql } from "@cossackframework/database/node";

const adapter = await mysql({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  connectionLimit: 10,
});
```

Turso (choose the client matching the connection):

```sh
pnpm add @tursodatabase/database   # embedded SQLite / Desktop
pnpm add @tursodatabase/serverless # remote Turso
```

```ts
import { turso } from "@cossackframework/database/node";

const embedded = await turso({ path: "./app.turso" });

const adapter = await turso({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
```

Workers that use remote Turso must import `turso` from
`@cossackframework/database/cloudflare-turso`. Keeping that optional provider in
its own entry lets a D1-only Worker bundle without the Turso client installed.

Node adapters install `AsyncLocalStorage` request scopes automatically.

## Bun

Bun uses the native `Bun.SQL` client:

```ts
import { createORM } from "@cossackframework/database";
import { bun } from "@cossackframework/database/bun";

const orm = createORM({
  adapter: bun({
    url: "sqlite://app.db",
    dialect: "sqlite",
  }),
  entities,
});
```

The adapter accepts SQLite, PostgreSQL, and MySQL. Pass `dialect` explicitly
when the URL is unconventional:

```ts
const adapter = bun({
  url: process.env.DATABASE_URL,
  dialect: "postgres",
});
```

An existing compatible Bun SQL client can be injected through `client`.
Transaction and connection-reservation capabilities follow the methods exposed
by that client.

## Cloudflare D1

Create the adapter from a D1 binding:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createORM } from "@cossackframework/database";
import { d1 } from "@cossackframework/database/cloudflare";
import { createAsyncLocalScope } from "@cossackframework/database/adapter";

interface Env {
  DB: D1Database;
}

export async function createRequestORM(env: Env) {
  const adapter = await d1(env.DB);
  return createORM({
    adapter: { ...adapter, scope: createAsyncLocalScope(new AsyncLocalStorage()) },
    entities,
  });
}
```

D1 compiles SQLite SQL and uses prepared bindings. It supports prepared batches
but not interactive transactions, savepoints, connection reservation, or query
cancellation. Unsupported operations throw `UnsupportedCapabilityError`. The ORM
does not emulate them unsafely.

Migration schema operations and migration bookkeeping are submitted in one D1
batch. General callback-based transactions remain unsupported.

The application factory adds async-local request scoping through `node:async_hooks`.
Generated Cloudflare applications include this scope. Enable
the Workers compatibility support required by the deployment's compatibility
date, such as
[`nodejs_als`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/).

`ormMiddleware()` owns databases created by its request factory. Component RPC
streams retain these databases until completion, failure, or cancellation. The
framework captures the SQL scope when it creates the response, so Active Record
and global `sql` calls can run between yielded values. Ordinary responses close
their owned ORM when middleware finishes. Caller-owned ORM instances remain
the caller's responsibility.

### D1 tooling

Keep tooling separate from the request adapter. Generated D1 applications use:

```ts
import type { ORMToolingContext } from "@cossackframework/database";
import { createD1ToolingAdapter } from "@cossackframework/database/tooling";

export function createToolingAdapter(context: ORMToolingContext) {
  return createD1ToolingAdapter(context, { binding: "DB" });
}
```

The helper resolves Wrangler from the application and uses its configuration
parser. Local tooling disables remote bindings and shares the application's
`.wrangler/state/v3` storage used by Wrangler and the Cloudflare Vite plugin.
Remote tooling forces the selected D1 binding to use the remote resource,
requires a real `database_id`, and closes the proxy when the ORM closes. The
helper does not provision a remote database. JSON results include the selected
account ID, environment, binding and D1 identity when Wrangler provides them.
They never include credential values.

Named environments use their own binding declarations. Missing environments
fail instead of falling back to production. CLI and Studio share this binding
discovery through `readD1ToolingBindings()`. These exports are Node tooling.
Worker request code continues to import `d1()` from the Cloudflare entry.

### Other Cloudflare tooling

Turso and Hyperdrive tooling read secrets and bindings through
`createCloudflareToolingPlatform()`. It starts Wrangler's platform proxy with
the same target, environment and local state rules as the D1 helper:

```ts
import type { ORMToolingContext } from "@cossackframework/database";
import { createCloudflareToolingPlatform } from "@cossackframework/database/tooling";

const platform = await createCloudflareToolingPlatform<{ TURSO_DATABASE_URL?: string }>(context);
// Read platform.env, then call platform.dispose() when the adapter closes.
```

Tooling does not run the Worker entry. Because of this, both helpers remove
Durable Objects and Workflows that the Worker defines itself (bindings without
`script_name`) before they start the proxy. Wrangler would otherwise warn about
each one. The helpers write the changed configuration to a temporary file next
to the original, so relative paths and `.dev.vars` still work. They delete the
file when the proxy starts.

## Cloudflare Hyperdrive

PostgreSQL through Hyperdrive:

```sh
pnpm add pg
```

```ts
import {
  hyperdrivePostgres,
} from "@cossackframework/database/cloudflare";

const adapter = await hyperdrivePostgres(env.HYPERDRIVE);
```

MySQL through Hyperdrive:

```sh
pnpm add mysql2
```

```ts
import {
  hyperdriveMySQL,
} from "@cossackframework/database/cloudflare";

const adapter = await hyperdriveMySQL(env.HYPERDRIVE);
```

Hyperdrive owns the global connection pool. The adapters create request-local
clients and release them deterministically. Enable `nodejs_compat` for the
official `pg` and `mysql2` drivers. See Cloudflare's
[Hyperdrive driver guidance](https://developers.cloudflare.com/hyperdrive/).

## Custom Runtime

Cossack ORM does not require runtime support to live in this package. A custom
runtime can construct an `Adapter` from a third-party `Driver` and, where
available, an async-local `ScopeStorage`:

```ts
import type {
  Adapter,
  Driver,
  ScopeStorage,
} from "@cossackframework/database/adapter";

export function customRuntime(
  driver: Driver,
  scope?: ScopeStorage<unknown>,
): Adapter {
  return {
    driver,
    ...(scope ? { scope } : {}),
  };
}
```

The driver owns connection lifecycle, pooling, execution, transactions,
reservation, cancellation, result normalization, and introspection. Its
capability flags must describe what it actually implements. See
[Custom adapters](./advanced.md#custom-adapters) for a complete driver outline.

### Multiple connections

Like the multiple-data-source pattern used by other ORMs, create one independent
ORM instance per database connection:

```ts
import { createORM } from "@cossackframework/database";
import {
  nodeSQLite,
  postgres,
} from "@cossackframework/database/node";
import { Post, User } from "./models/primary.js";
import { AuditEvent } from "./models/analytics.js";

export const databases = {
  primary: createORM({
    adapter: await nodeSQLite({ filename: "app.db" }),
    entities: [User, Post],
  }),

  analytics: createORM({
    adapter: await postgres(process.env.ANALYTICS_DATABASE_URL!),
    entities: [AuditEvent],
  }),
} as const;
```

Each instance owns its adapter, model metadata, entity snapshots, transaction
scope, and shutdown lifecycle. It can use a different dialect and a different
entity list.

When a function touches one connection, Active Record syntax remains available
inside that connection's scope:

```ts
const users = await databases.primary.run(() =>
  User.find({ order: { name: "asc" } })
);

const events = await databases.analytics.run(() =>
  AuditEvent.find({ take: 100 })
);
```

When one function touches multiple connections, prefer explicit model managers:

```ts
const primaryUsers = databases.primary.model(User);
const analyticsEvents = databases.analytics.model(AuditEvent);

const [users, events] = await Promise.all([
  primaryUsers.find({ order: { name: "asc" } }),
  analyticsEvents.find({ take: 100 }),
]);
```

This avoids asking a static model method to infer which ORM handles the
query. It also supports registering the same entity class with two connections:

```ts
const liveUsers = databases.primary.model(User);
const archivedUsers = archiveORM.model(User);

const [live, archived] = await Promise.all([
  liveUsers.find(),
  archivedUsers.find(),
]);
```

Do not nest Active Record scopes from different ORM instances. Both scopes
are then active in the same asynchronous chain. A static call such as
`User.find()` becomes ambiguous. Use `orm.model(Entity)`, `orm.sql`, and explicit ORM
methods for cross-connection work.

### Concurrent scopes

Independent scopes can run concurrently when each adapter supplies isolated
async-local storage:

```ts
await Promise.all([
  databases.primary.run(() => User.count()),
  databases.analytics.run(() => AuditEvent.count()),
]);
```

Built-in Node, Bun, D1, and Hyperdrive adapters provide runtime-appropriate
scope storage. A custom runtime must supply `ScopeStorage` before using static
Active Record concurrently. Explicit `orm.model(Entity)` access does not depend
on global scope lookup.

### Transactions across connections

A transaction belongs to exactly one ORM:

```ts
await databases.primary.transaction(async () => {
  await databases.primary.model(User).update(
    { id: userId },
    { active: false },
  );
});
```

Starting separate transactions on `primary` and `analytics` does not create a
distributed transaction. A failure cannot atomically roll back work already
committed to another database. Use an outbox, saga, or another application-level
coordination strategy for cross-database consistency.

Relations also stay within one ORM instance. For cross-database data, query each
connection explicitly and combine the results in application code.

### Migrations and shutdown

Give each database its own configuration file so schema commands cannot target the wrong
connection:

```text
orm.primary.config.ts
orm.analytics.config.ts
```

```sh
cossack-orm migration up --config orm.primary.config.ts
cossack-orm migration up --config orm.analytics.config.ts
```

Close every long-lived connection during graceful shutdown:

```ts
await Promise.all(
  Object.values(databases).map((orm) => orm.close()),
);
```

See the runnable
[multiple-connections SQLite example](../examples/multiple-connections/README.md)
for separate models, migrations, CLI configs, transactions, and
application-side result joining.

## Closing adapters

Long-lived applications usually create one ORM for a process or runtime
container. Close it during graceful shutdown:

```ts
await orm.close();
```

Request-local adapters can make `close()` a no-op. Calling it remains safe
and idempotent.

## Capabilities

Inspect capabilities instead of branching only on a dialect name:

```ts
if (orm.driver.capabilities.returning) {
  // Use a mutation returning clause.
}

if (orm.driver.capabilities.transactions) {
  // Interactive transaction support is available.
}
```

Capabilities include transactions, savepoints, returning clauses, batches,
connection reservation, cancellation, parameter limits, and batch limits.

## Provider capabilities

`orm.inspectCapabilities()` returns frozen driver declarations, including provider,
dialect, transaction modes, schema operations, generated values, returning support,
connection reservation, cancellation, and parameter/batch limits. These facts do
not establish remote connectivity or a server version. Custom drivers must declare
accurate limits and implement the advertised methods.

| Operation | SQLite / embedded Turso | PostgreSQL | MySQL | D1 |
| --- | --- | --- | --- | --- |
| Interactive transactions | Yes | Yes | Yes | No |
| Nested savepoints | Yes | Yes | Yes | No |
| Transactional DDL rollback | Yes | Yes | No | No |
| Generated increment key | Integer primary key | Identity column | AUTO_INCREMENT | Integer primary key |
| Explicit generated identity | No | Yes | No | No |
| Direct column type alteration | No | Yes | Yes | No |

UUID generation happens in the client. PostgreSQL and MySQL column alterations
support type changes only. Changes to defaults or constraints need explicit SQL.
SQLite type changes need a table-rebuild migration. Schema queues compile every
operation before execution, so unsupported later operations cannot publish earlier
DDL. MySQL DDL can implicitly commit and must not be described as rollback-safe.

D1 supports its driver's atomic batch facility, not interactive callbacks or
nested transactions. Remote Turso and injected drivers use their own declared
capabilities. Unsupported interactive/nested operations reject before entering the
callback. Queries over the declared parameter limit reject before driver execution.
Unsupported generated identity and native array metadata reject during ORM setup.
