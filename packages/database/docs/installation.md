---
title: Installation
description: Install Cossack ORM, configure TypeScript decorators, and create an ORM instance.
---

# Installation

## Requirements

Cossack ORM is ESM-only and targets:

- Node.js 22 or newer
- A current stable Bun release
- A current stable Deno release
- Modern Cloudflare Workers compatibility dates
- TypeScript with decorator metadata enabled

Install the ORM and decorator metadata support:

```sh
pnpm add @cossackframework/database reflect-metadata
```

Equivalent npm, Yarn, and Bun commands work as well.

```sh
npm install @cossackframework/database reflect-metadata
yarn add @cossackframework/database reflect-metadata
bun add @cossackframework/database reflect-metadata
```

Import `reflect-metadata` once before decorated models are evaluated:

```ts
import "reflect-metadata";
```

## TypeScript configuration

Cossack applications use legacy TypeScript decorators. Add these options to
`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false
  }
}
```

Because the package is ESM-only, set `"type": "module"` in `package.json` and
use `.js` extensions in relative TypeScript imports when using `NodeNext`.

## Choose a runtime adapter

The root package does not eagerly bundle database drivers. Import the adapter
for the runtime where the application executes:

| Runtime | Import | Available adapters |
| --- | --- | --- |
| Node.js | `@cossackframework/database/node` | `nodeSQLite`, `betterSQLite`, `postgres`, `mysql`, `libsql` |
| Bun | `@cossackframework/database/bun` | `bun` for SQLite, PostgreSQL, or MySQL |
| Cloudflare Workers | `@cossackframework/database/cloudflare` | `d1`, `hyperdrivePostgres`, `hyperdriveMySQL` |
| Deno | `@cossackframework/database/deno` | `deno` with an injected driver |

Some Node and Workers adapters require an optional peer driver:

```sh
# Install only what the application uses.
pnpm add pg
pnpm add mysql2
pnpm add @libsql/client
pnpm add better-sqlite3
```

Node 22's built-in SQLite adapter, Cloudflare D1, and Bun's native SQL client do
not require one of these packages.

## Create an ORM

```ts
import { createORM } from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";
import { entities } from "./models/index.js";

export const orm = createORM({
  adapter: await nodeSQLite({ filename: "app.db" }),
  entities,
});
```

Every relation target must appear in `entities`. Metadata is finalized when the
ORM is created, so duplicate names, missing primary keys, unresolved relations,
and ambiguous column types fail during startup rather than during the first
query.

## Create `orm.config.ts`

The CLI and Studio use one configuration file:

```ts
import { defineConfig } from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";
import { entities } from "./src/models/index.js";
import { migrations } from "./migrations/index.js";
import { seeders } from "./seeders/index.js";

export default defineConfig({
  entities,
  migrations,
  seeds: seeders,
  adapter: () => nodeSQLite({ filename: "app.db" }),
});
```

An adapter factory is recommended in configuration files. It delays opening the
database until a command needs it.

## Verify the setup

```sh
cossack-orm schema check
cossack-orm migration status
cossack-orm seed list
```

Pass a non-default config location with `--config`:

```sh
cossack-orm schema check --config ./config/orm.config.ts
```

Next, define application data in [Models](./models.md) and choose the correct
adapter details in [Runtimes](./runtimes.md).
