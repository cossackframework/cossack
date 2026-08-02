---
title: Seeders
description: Define and run ordered, idempotent seed data with scope and transaction policies.
---

# Seeders

Seeders create or update application data after migrations have established the
schema. Cossack ORM provides a reusable `SeederRunner`; `tsx` or another runtime
loader only executes the TypeScript entry point.

## Define a named seeder

```ts
import { defineSeeder } from "@cossackframework/database";
import { User } from "../src/models/User.js";

export const usersSeeder = defineSeeder({
  name: "users",
  transaction: "auto",

  async run() {
    const email = "admin@example.com";
    const existing = await User.findOne({
      where: { email },
    });

    if (!existing) {
      await User.create({
        email,
        name: "Administrator",
      }).save();
    }
  },
});
```

`SeederRunner` establishes ORM scope, so static Active Record calls work inside
`run()` without another `orm.run()` wrapper.

The context also exposes bound ORM and SQL access:

```ts
export const settingsSeeder = defineSeeder({
  name: "settings",

  async run({ orm, sql, signal }) {
    // SQLite/PostgreSQL upsert syntax; use the model API for portable upserts.
    await sql`
      INSERT INTO ${sql.id("settings")}
        (${sql.id("key")}, ${sql.id("value")})
      VALUES (${"theme"}, ${"system"})
      ON CONFLICT (${sql.id("key")})
      DO UPDATE SET ${sql.id("value")} = ${"system"}
    `;
  },
});
```

## Export one ordered list

```ts
// seeders/index.ts
import { rolesSeeder } from "./roles.seeder.js";
import { usersSeeder } from "./users.seeder.js";
import { postsSeeder } from "./posts.seeder.js";

// Configuration order is execution order.
export const seeders = [
  rolesSeeder,
  usersSeeder,
  postsSeeder,
] as const;
```

Seeder names must be non-empty and unique. Execution is sequential and stops at
the first failure, preserving declared dependencies.

Register the same list in `orm.config.ts`:

```ts
export default defineConfig({
  adapter: createAdapter,
  entities,
  migrations,
  seeds: seeders,
});
```

## Run seeders

```sh
cossack-orm seed list
cossack-orm seed run
cossack-orm seed run --only users,posts
```

`--only` selects names but preserves configuration order. Unknown names fail
with a list of available seeders.

Programmatic execution uses the same runner:

```ts
import { SeederRunner } from "@cossackframework/database";

const runner = new SeederRunner(orm, seeders);

try {
  const results = await runner.run({
    only: ["users", "posts"],
  });

  for (const result of results) {
    console.log(
      result.name,
      result.durationMs,
      result.usedTransaction,
    );
  }
} finally {
  await orm.close();
}
```

Use an `AbortSignal` for cooperative cancellation:

```ts
const controller = new AbortController();

await runner.run({
  signal: controller.signal,
});
```

The signal is exposed to the seeder context. A seeder should pass it to any
lower-level operation that supports cancellation.

## Transaction policies

Each seeder declares one of three policies:

| Policy | Behavior |
| --- | --- |
| `"auto"` | Use one transaction when supported; otherwise run without one |
| `"required"` | Fail before executing when interactive transactions are unavailable |
| `"none"` | Never create a runner-managed transaction |

`"auto"` is the default.

```ts
export const billingSeeder = defineSeeder({
  name: "billing",
  transaction: "required",
  async run() {
    // All writes must commit or roll back together.
  },
});
```

D1 does not support callback-based interactive transactions. An `"auto"` seeder
runs without one, while `"required"` fails with a `SeederError` whose cause is
`UnsupportedCapabilityError`. Use `"none"` and a database-specific prepared
batch when D1 seed work must be atomic.

## Make seeders idempotent

Seeders are not tracked like migrations because they commonly need to be
rerunnable and environment-specific. Use stable natural keys, existence checks,
or upserts:

```ts
await User.upsert(
  {
    email: "admin@example.com",
    name: "Administrator",
  },
  ["email"],
);
```

Avoid random identifiers for records that must not be duplicated. Keep
production-only or destructive data policies in the application/framework CLI,
where environment and confirmation information is available.

## Framework integration

A framework should:

1. Load the application's `orm.config.ts`.
2. Construct its normal ORM instance.
3. Delegate execution to `SeederRunner`.
4. Add framework-specific environment and production confirmation checks.
5. Close the ORM in `finally`.

Do not create a second seeding engine or reimplement transaction behavior.

The complete pattern is available in the
[SQLite starter](../examples/sqlite-starter/README.md).
