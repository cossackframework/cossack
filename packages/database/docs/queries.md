---
title: Queries
description: Read and mutate records with Active Record methods, find options, operators, and the fluent query builder.
---

# Queries

Cossack ORM offers two complementary query APIs:

- Active Record methods for common reads and writes.
- A fluent query builder for projections, compound predicates, joins,
  aggregates, grouping, and mutation `RETURNING` clauses.

Static methods require an active scope:

```ts
await orm.run(async () => {
  const users = await User.find();
});
```

Framework middleware can establish this scope once for a request. When code
already owns an ORM instance, `orm.model(User)` provides explicit access without
static scope lookup:

```ts
const users = await orm.model(User).find();
```

## Finding records

```ts
const users = await User.find({
  where: { active: true },
  select: ["id", "email", "name"],
  order: { name: "asc" },
  take: 25,
  skip: 50,
  relations: ["posts"],
});
```

When combining `select` with `relations`, include the primary/foreign-key
properties required to associate the requested relation.

Available read methods:

```ts
const all = await User.find();

const one = await User.findOne({
  where: { email: "ada@example.com" },
});

const admins = await User.findBy({ role: "admin" });
const count = await User.count({ active: true });
const exists = await User.exists({ email: "ada@example.com" });
```

`findOne()` returns `null` when no row matches. `find()` and `findBy()` return
readonly arrays.

## Find operators

Import operators for comparisons that cannot be represented by a plain value:

```ts
import {
  In,
  IsNull,
  LessThan,
  Like,
  MoreThanOrEqual,
  Not,
  NotIn,
} from "@cossackframework/database";

const users = await User.find({
  where: {
    age: MoreThanOrEqual(18),
    email: Like("%@example.com"),
    role: In(["admin", "editor"]),
    deletedAt: IsNull(),
  },
});
```

Operators include `Equal`, `Not`, `MoreThan`, `MoreThanOrEqual`, `LessThan`,
`LessThanOrEqual`, `Like`, `In`, `NotIn`, and `IsNull`.

An array of `where` objects is joined with `OR`:

```ts
const users = await User.find({
  where: [
    { email: "ada@example.com" },
    { email: "grace@example.com" },
  ],
});
```

Properties inside one object are joined with `AND`.

## Query builder

Start a builder with `Entity.query()`:

```ts
const users = await User.query("user")
  .where({ active: true })
  .andWhere((where) => where.like("email", "%@example.com"))
  .orderBy("createdAt", "desc")
  .limit(20)
  .offset(0)
  .getMany();
```

Callback predicates expose typed columns and boolean composition:

```ts
const users = await User.query("user")
  .where((where) =>
    where.and(
      where.eq("active", true),
      where.or(
        where.like("email", "%@example.com"),
        where.like("email", "%@cossack.dev"),
      ),
    )
  )
  .getMany();
```

The expression builder provides `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`,
`in`, `isNull`, `and`, `or`, and `not`.

## Projection and raw rows

`select()` narrows the result shape at compile time:

```ts
const rows = await User.query("user")
  .select("id", "email")
  .where({ active: true })
  .getRawMany();
```

Use `selectRaw()` for calculated or database-specific projections:

```ts
const totals = await User.query("user")
  .selectRaw<{ role: string; total: number }>(
    orm.sql.fragment`
      ${orm.sql.id("user", "role")},
      COUNT(*) AS ${orm.sql.id("total")}
    `,
  )
  .groupBy("role")
  .getRawMany();
```

Use `getMany()` when selecting complete entity rows that should be hydrated as
model instances. Use `getRawMany()` for custom projections.

## Joins

Query-builder joins use physical table names and explicit safe SQL fragments:

```ts
const rows = await User.query("user")
  .innerJoin(
    "posts",
    "post",
    orm.sql.fragment`
      ${orm.sql.id("post", "author_id")} =
      ${orm.sql.id("user", "id")}
    `,
  )
  .where((where) => where.eq("active", true))
  .distinct()
  .getMany();
```

Available joins are `innerJoin()` and `leftJoin()`. For ordinary model
relationships, prefer explicit `relations` loading; it hydrates both sides and
batches relation keys.

## Aggregates

```ts
const total = await User.query().count();
const hasAny = await User.query().where({ active: true }).exists();
const sum = await Invoice.query().sum("amount");
const average = await Invoice.query().average("amount");
const minimum = await Invoice.query().minimum("amount");
const maximum = await Invoice.query().maximum("amount");
```

`sum`, `average`, `minimum`, and `maximum` return `number | null`.

## Inserts, upserts, updates, and deletes

```ts
await User.insert({
  email: "ada@example.com",
  name: "Ada Lovelace",
});

await User.insert([
  { email: "ada@example.com", name: "Ada" },
  { email: "grace@example.com", name: "Grace" },
]);

await User.upsert(
  { email: "ada@example.com", name: "Augusta Ada King" },
  ["email"],
);

await User.update(
  { email: "ada@example.com" },
  { name: "Ada Lovelace" },
);

await User.delete({ active: false });
```

These methods return a normalized `QueryResult` containing `rows` and `meta`.
Always make bulk update/delete predicates explicit.

For adapters that support `RETURNING`, use a mutation builder:

```ts
const result = await orm.model(User)
  .insertQuery({
    email: "ada@example.com",
    name: "Ada",
  })
  .returning("id", "email")
  .execute<{ id: number; email: string }>();
```

MySQL reports `RETURNING` as an unsupported capability instead of emulating it.

## Result metadata

Every execution returns normalized metadata:

```ts
const result = await User.update(
  { active: false },
  { active: true },
);

console.log(result.meta.rowsAffected);
console.log(result.meta.durationMs);
console.log(result.meta.dialect);
console.log(result.meta.operation);
```

See [Raw queries](./raw-queries.md) when a query cannot be expressed cleanly by
the model APIs.
