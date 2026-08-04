---
title: Raw Queries
description: Write parameterized, dialect-aware SQL with safe fragments, identifiers, bulk values, and normalized results.
---

# Raw Queries

The `sql` API is the escape hatch for database-specific or unusually complex
queries. It builds an immutable fragment tree: interpolated values become bound
parameters, while identifiers are quoted by the selected dialect.

## Scoped and bound SQL tags

The global tag resolves through the current ORM scope:

```ts
import { sql } from "@cossackframework/database";

await orm.run(async () => {
  const email = "ada@example.com";
  const result = await sql<{ id: number; email: string }>`
    SELECT ${sql.id("id")}, ${sql.id("email")}
    FROM ${sql.id("users")}
    WHERE ${sql.id("email")} = ${email}
  `;
});
```

When code owns an ORM instance, use its bound tag without scope lookup:

```ts
const result = await orm.sql<{ total: number }>`
  SELECT COUNT(*) AS ${orm.sql.id("total")}
  FROM ${orm.sql.id("users")}
`;
```

The result has `rows` and normalized `meta`.

## Values are always parameters

```ts
const input = "'; DROP TABLE users; --";

await orm.sql`
  SELECT *
  FROM ${orm.sql.id("users")}
  WHERE ${orm.sql.id("email")} = ${input}
`;
```

`input` is data, never executable SQL. PostgreSQL compiles it to `$1`; SQLite
and MySQL use their corresponding placeholders.

Do not interpolate table or column names as strings. Use `sql.id()`:

```ts
const table = "audit_events";
const column = "created_at";

const rows = await orm.sql`
  SELECT ${orm.sql.id(column)}
  FROM ${orm.sql.id(table)}
`;
```

Multiple arguments form a qualified identifier:

```ts
orm.sql.id("user", "email");
```

## Reusable fragments

Build a fragment without executing it:

```ts
const published = orm.sql.fragment`
  ${orm.sql.id("published")} = ${true}
`;

const result = await orm.sql`
  SELECT *
  FROM ${orm.sql.id("posts")}
  WHERE ${published}
`;
```

Fragments remain parameterized when nested.

## Lists and bulk values

Use `join()` for a dynamic list:

```ts
const ids = [1, 2, 3];

const result = await orm.sql`
  SELECT *
  FROM ${orm.sql.id("users")}
  WHERE ${orm.sql.id("id")} IN (${orm.sql.join(ids)})
`;
```

Use `values()` for object or bulk inserts:

```ts
const values = orm.sql.values([
  { email: "ada@example.com", active: true },
  { email: "grace@example.com", active: false },
]);

await orm.sql`
  INSERT INTO ${orm.sql.id("users")} ${values}
`;
```

Every row passed to `values()` must have the same columns in the same order.
Large application writes should respect `orm.driver.capabilities.parameterLimit`
and `batchLimit`.

## Unsafe SQL

`unsafe()` is the only API that injects literal SQL:

```ts
await orm.sql`
  SELECT ${orm.sql.unsafe("CURRENT_TIMESTAMP")}
`;
```

Use it only for trusted static syntax such as a SQL function, operator, or
reviewed migration statement. Never pass request data, form values, headers, or
untrusted configuration to `unsafe()`.

## Executing an existing fragment

```ts
const fragment = orm.sql.fragment`
  DELETE FROM ${orm.sql.id("sessions")}
  WHERE ${orm.sql.id("expires_at")} < ${new Date()}
`;

const result = await orm.sql.execute(fragment);
console.log(result.meta.rowsAffected);
```

Within a scope, the global tag also exposes `execute()`, `transaction()`,
`reserve()`, and `close()`.

## Standalone SQL client

Use `SQL` when models and entity metadata are unnecessary:

```ts
import { SQL } from "@cossackframework/database";

const client = new SQL("sqlite:app.db");

try {
  await client`
    INSERT INTO messages (body)
    VALUES (${"Safe value"})
  `;

  const result = await client<{ body: string }>`
    SELECT body FROM messages
  `;
} finally {
  await client.close();
}
```

In Node.js, URL or path inference supports PostgreSQL, MySQL, Turso HTTPS URLs, and
SQLite. Bun delegates to native Bun SQL. Workers and Deno require an explicit
adapter rather than environment guessing:

```ts
const client = new SQL({ adapter });
```

See [Runtimes](./runtimes.md) for adapter setup and
[Advanced usage](./advanced.md) for transactions and connection reservation.
