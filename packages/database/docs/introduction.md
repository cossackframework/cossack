---
title: Introduction
description: Learn the design, core concepts, and first steps of Cossack ORM.
---

# Introduction

Cossack ORM is an ESM-only, serverless-first SQL ORM for Node.js, Bun,
Cloudflare Workers, and Deno. It combines decorated models, Active Record
methods, a typed query builder, safe SQL fragments, migrations, introspection,
and explicit runtime adapters.

The package is deliberately small in shape:

- Models are ordinary classes that extend `BaseEntity`.
- Every application registers its complete entity list with `createORM()`.
- Static Active Record methods resolve through the current request or job scope.
- Dialects compile SQL while adapters execute it.
- Relations are loaded explicitly and batched.
- Migrations are generated and reviewed; startup never mutates the schema.

## A first model and query

```ts
import "reflect-metadata";
import {
  BaseEntity,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  createORM,
} from "@cossackframework/database";
import { nodeSQLite } from "@cossackframework/database/node";

@Entity()
class User extends BaseEntity {
  @PrimaryGeneratedColumn()
  declare id: number;

  @Column({ unique: true })
  declare email: string;

  @Column()
  declare name: string;
}

const orm = createORM({
  adapter: await nodeSQLite({ filename: "app.db" }),
  entities: [User],
});

try {
  await orm.run(async () => {
    await User.create({
      email: "ada@example.com",
      name: "Ada Lovelace",
    }).save();

    const users = await User.find({
      order: { name: "asc" },
    });
  });
} finally {
  await orm.close();
}
```

`orm.run()` establishes the current ORM for static methods such as
`User.find()`, `entity.save()`, and the global `sql` tag. Put one scope around a
request, queue job, scheduled task, or command—not around each query.

Framework middleware normally installs this scope automatically. For example,
the Cossack/Hono middleware wraps the request once:

```ts
import { ormMiddleware } from "@cossackframework/database/cossack";

app.use("*", ormMiddleware(orm));
```

Handlers below that middleware can call `User.find()` directly.

## Explicit model access

Code that already owns an ORM instance can query through a model manager without
an Active Record scope:

```ts
const users = await orm.model(User).find({
  order: { name: "asc" },
});
```

This form is useful for framework integrations and simple read-only scripts.
Use `orm.run()` when you want static Active Record methods, instance persistence,
the global `sql` tag, or automatic transaction rebinding.

## What `orm.run()` does

An ORM scope identifies the correct ORM and transaction client across
asynchronous calls. It does not, by itself, promise to reserve a database
connection. Pooling adapters generally acquire connections as needed.
`orm.transaction()` and `orm.reserve()` explicitly pin the appropriate client
when the adapter supports those capabilities.

This distinction matters when an application has multiple databases, concurrent
requests, request-specific Workers bindings, or nested transactions. Cossack ORM
throws an actionable `ScopeError` instead of silently guessing a global
connection.

## Design boundaries

Cossack ORM v1 does not provide a repository/Data Mapper layer, automatic schema
synchronization, a legacy query-builder compatibility API, NoSQL or GraphQL integration, or
query-result caching. Database-specific work remains possible through safe SQL
fragments and public adapter contracts.

## Continue reading

- [Installation](./installation.md)
- [Models](./models.md)
- [Queries](./queries.md)
- [Relationships](./relationships.md)
- [Raw queries](./raw-queries.md)
- [Comparison](./comparison.md)
- [Complete SQLite starter](../examples/sqlite-starter/README.md)
