# `@cossackframework/database`

An ESM-only, serverless-first Active Record ORM for Cossack. It provides decorated
models, safe SQL, a fluent query builder, explicit request scopes, schema metadata,
introspection, and deterministic migrations without a repository layer or a
runtime schema-sync mode.

## Install

```sh
pnpm add @cossackframework/database reflect-metadata
```

Install only the optional driver used by the application (`pg`, `mysql2`,
`@libsql/client`, or `better-sqlite3`). Node 22's built-in `node:sqlite`, Bun SQL,
and Cloudflare D1 need no third-party database driver.

Use TypeScript legacy decorators:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false
  }
}
```

## Documentation

- [Introduction](./docs/introduction.md)
- [Installation](./docs/installation.md)
- [Models](./docs/models.md)
- [Queries](./docs/queries.md)
- [Relationships](./docs/relationships.md)
- [Raw queries](./docs/raw-queries.md)
- [Runtimes](./docs/runtimes.md)
- [Migrations](./docs/migrations.md)
- [Seeders](./docs/seeders.md)
- [Advanced usage](./docs/advanced.md)
- [Comparison](./docs/comparison.md)

## Models and request scope

```ts
import "reflect-metadata";
import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  createORM,
} from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";

@Entity()
export class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column()
  declare email: string;

  @Column({ type: "json" })
  declare preferences: Record<string, unknown>;

  @CreateDateColumn()
  declare createdAt: Date;
}

const orm = createORM({
  adapter: await nodeSQLite({ filename: "app.db" }),
  entities: [User],
});

await orm.run(async () => {
  const user = User.create({
    email: "ada@example.com",
    preferences: { theme: "dark" },
  });
  await user.save();

  const active = await User.query("user")
    .where((where) => where.like("email", "%@example.com"))
    .orderBy("createdAt", "desc")
    .limit(20)
    .getMany();
});
```

Static Active Record methods and the global `sql` tag deliberately throw outside
`orm.run()`. Put one scope around each request, queue job, scheduled task, or CLI
operation. Runtime adapters provide async-local isolation; a nested transaction
rebinds the scope to its transaction client and uses savepoints when supported.

## Safe SQL

```ts
import { sql } from "@cossackframework/database";

await orm.run(async () => {
  const email = "'; DROP TABLE users; --";
  const result = await sql`
    SELECT ${sql.id("id")}, ${sql.id("email")}
    FROM ${sql.id("users")}
    WHERE ${sql.id("email")} = ${email}
  `;
});
```

Values always become parameters. `sql.id()` is the identifier escape hatch,
`sql.fragment` composes queries, `sql.join()` builds lists, and `sql.values()`
builds object/bulk insert tuples. `sql.unsafe()` is the only API that injects
literal SQL.

`new SQL({ adapter })` creates a standalone Bun-compatible tagged client. In Node,
`new SQL("postgres://…")`, `new SQL("mysql://…")`, `new SQL("libsql://…")`, and
SQLite paths select an adapter lazily. Workers intentionally require a binding or
explicit adapter rather than environment URL guessing.

## Relations

Relations load only when requested:

```ts
const users = await User.find({
  where: { enabled: true },
  relations: ["roles"],
});
```

The loader batches keys and chunks them at the adapter's parameter limit. Owning
relations expose both logical metadata and physical join columns. Many-to-many
associations require `@JoinTable()` on one side. Cascades are opt-in with
`{ cascade: ["insert", "update"] }`; delete cascades remain database behavior and
are never replayed across an in-memory object graph.

## Runtime adapters

| Runtime entry | Adapters |
| --- | --- |
| `@cossackframework/database/node` | `nodeSQLite`, `betterSQLite`, `postgres`, `mysql`, `libsql` |
| `@cossackframework/database/bun` | `bun` over the documented Bun SQL core API |
| `@cossackframework/database/cloudflare` | `d1`, `hyperdrivePostgres`, `hyperdriveMySQL` |
| `@cossackframework/database/deno` | `deno` with an injected remote or SQLite driver |
| `@cossackframework/database/adapter` | public dialect, driver, result, scope, and capability contracts |
| `@cossackframework/database/cossack` | middleware plus database cache/session stores |

D1 uses prepared statements and `batch()`. It supports atomic migration batches,
but rejects interactive transactions, savepoints, and connection reservation with
`UnsupportedCapabilityError`. Enable Workers' narrow `nodejs_als` compatibility
flag for request scope isolation.

Hyperdrive creates and closes a request-local `pg`/`mysql2` client while
Hyperdrive owns the global pool. Workers need `nodejs_compat`; `mysql2` uses
`disableEval: true`. See Cloudflare's current
[D1 binding API](https://developers.cloudflare.com/d1/worker-api/),
[Hyperdrive guide](https://developers.cloudflare.com/hyperdrive/get-started/),
and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

## Schema and migrations

`orm.config.ts` is the single configuration used by the CLI and Studio:

```ts
import { defineConfig } from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";
import { entities } from "./src/entities/index.js";
import { migrations } from "./migrations/index.js";
import { seeders as seeds } from "./seeders/index.js";

export default defineConfig({
  entities,
  migrations,
  seeds,
  adapter: () => nodeSQLite({ filename: "app.db" }),
});
```

```sh
cossack-orm migration generate add_users
cossack-orm migration up
cossack-orm migration down
cossack-orm migration status
cossack-orm migration check
cossack-orm migration baseline
cossack-orm schema pull
cossack-orm schema diff
cossack-orm schema check
cossack-orm seed list
cossack-orm seed run
cossack-orm seed run --only users,posts
```

Generated migrations are reviewable TypeScript and are never run during
application startup. Dropped tables/columns and narrowing changes require
`--allow-destructive`. Rename detection is never heuristic: set `renamedFrom` on
the entity or column. `_cossack_migrations` stores the migration name, SHA-256
checksum, batch, and application timestamp.

`orm.schema()` returns versioned, serializable `OrmSchema` metadata. Studio can
merge it with `orm.introspect()` to display logical types and virtual relations
even where SQLite's physical affinity is less specific.

## Seeders

Declare named seeders and keep their execution order in one exported array:

```ts
import {
  SeederRunner,
  defineSeeder,
} from "@cossackframework/database";

export const usersSeeder = defineSeeder({
  name: "users",
  transaction: "auto",
  async run({ orm, sql, signal }) {
    // Active Record calls are already in ORM scope.
  },
});

export const seeders = [usersSeeder] as const;

const results = await new SeederRunner(orm, seeders).run({
  only: ["users"],
});
```

Seeders run sequentially in configuration order and stop at the first failure.
`"auto"` uses one transaction per seeder where supported, `"required"` fails
before writing when interactive transactions are unavailable, and `"none"`
executes without a runner-managed transaction. On D1, `"auto"` runs without an
interactive transaction; use a database-specific batch inside a `"none"` seeder
when the work must be atomic.

`SeederRunner` owns scope, selection, transaction policy, cancellation, and
failure attribution. Framework CLIs should load `orm.config.ts` and delegate to
this runner instead of implementing their own seed loop. Environment and
production-confirmation policies belong in the framework CLI. Seed data remains
application-owned and should be idempotent through stable keys, existence checks,
or upserts; seeders are not recorded as migrations.

## Deliberate v1 boundaries

There is no Data Mapper/repository API, legacy query-builder compatibility layer, automatic
schema mutation at startup, NoSQL/GraphQL integration, or ORM query-result cache.
Database-specific operations remain available through safe SQL fragments and
custom third-party adapters.

## Complete SQLite example

[`examples/sqlite-starter`](./examples/sqlite-starter/README.md) contains
related `User` and `Post` models, a versioned migration, an idempotent seeder,
and executable create/migrate/seed/query scripts:

```sh
pnpm example:sqlite
pnpm exec tsx ./examples/sqlite-starter/query.ts
```

[`examples/multiple-connections`](./examples/multiple-connections/README.md)
demonstrates two independent SQLite connections with separate models,
migrations, transactions, CLI configs, and concurrent explicit-manager queries:

```sh
pnpm example:multiple-connections
```
