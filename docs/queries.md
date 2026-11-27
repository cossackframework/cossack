---
title: 'ORM queries'
description: 'Active Record, entity query builders, scoped SQL, and transactions.'
---

# ORM queries

Decorated models extend `BaseEntity` and can be used anywhere inside an
`orm.run()` scope. The generated ORM middleware establishes that scope for each
request.

```ts
const users = await User.find({
  where: { email: Like('%@example.com') },
  order: { createdAt: 'desc' },
  take: 20,
});

const user = await User.findOne({ where: { id } });
const admins = await User.findBy({ role: 'admin' });
const exists = await User.exists({ email });
const total = await User.count();
```

## Writes

```ts
await User.insert({
  id: crypto.randomUUID(),
  email,
  name: null,
  createdAt: new Date().toISOString(),
});

await User.update({ id }, { name: 'Ada' });
await User.delete({ id });
await UserRole.upsert({ userId, roleId, createdAt }, ['userId', 'roleId']);
```

`update()` and `delete()` reject an empty `where` such as `{}`. To change every
row on purpose, use `User.updateAll(values)` or `User.deleteAll()`. A `where`
property set to `undefined` also throws. Use `null` to match `NULL`.

Call `Entity.create(values)` plus `entity.save()` when lifecycle hooks or a
mutable entity instance are useful.

## Query builder

```ts
const page = await User.query()
  .where((expression) => expression.or(
    expression.like('name', `%${search}%`),
    expression.like('email', `%${search}%`),
  ))
  .orderBy('createdAt', 'desc')
  .limit(20)
  .offset(20)
  .getMany();
```

The builder also has `andWhere`, `orWhere`, `innerJoin`, `leftJoin`,
`groupBy`, `select`, `distinct` and `withDeleted`. Besides `getMany()`, it ends
with `getOne()`, `getRawMany()`, `count()`, `exists()`, `sum()`, `average()`,
`minimum()` and `maximum()`.

`Equal`, `Not`, `MoreThan`, `MoreThanOrEqual`, `LessThan`, `LessThanOrEqual`,
`Like`, `In`, `NotIn`, `IsNull`, and `IsNotNull` are available for object
predicates.

## Parameterized SQL

Use the scoped `sql` tag for joins or database-specific operations. Values are
always parameters. Name identifiers explicitly.

```ts
import { sql } from '@cossackframework/database';

const result = await sql<{ id: string; role: string }>`
  SELECT users.id, roles.name AS role
  FROM users
  INNER JOIN user_roles ON user_roles.user_id = users.id
  INNER JOIN roles ON roles.id = user_roles.role_id
  WHERE users.id = ${userId}
`;
```

The tag also builds pieces: `sql.fragment` (a statement that is not run yet),
`sql.id('table', 'column')` (a quoted identifier), `sql.join(values)`,
`sql.values(rows)`, `sql.json(value)` (a value for a `json` column),
`sql.type('json')` (a column type per dialect, for DDL) and `sql.unsafe(text)`
(trusted, static text only). `currentDialect()` returns `'sqlite'`,
`'postgres'` or `'mysql'` for the few statements that differ.

Arbitrary SQL in Studio is an explicitly trusted local developer operation.
Studio still binds parameters and uses safe row locators for edits.

## Transactions

Node SQLite, PostgreSQL, and MySQL support interactive transactions:

```ts
await sql.transaction(async () => {
  await User.insert(user);
  await AuditEvent.insert(event);
});
```

D1 and RomeDB do not emulate interactive transactions: `sql.transaction()`
throws `UnsupportedCapabilityError` there. For multi-statement atomic work on
any provider, pass fragments to `atomic()`. It runs them in one transaction, or
in one native batch on D1 and RomeDB, and returns each statement's result:

```ts
import { atomic, sql } from '@cossackframework/database';

const [created] = await atomic([
  sql.fragment`INSERT INTO posts (id, title) VALUES (${id}, ${title})`,
  sql.fragment`UPDATE authors SET post_count = post_count + 1 WHERE id = ${authorId}`,
]);
```

A batch rolls back when a statement fails, but it cannot branch on a result:
guard a write in its own `WHERE` and read its `meta.rowsAffected`. Prefer a single
idempotent statement when possible. `isWriteConflict(error)` tells whether a
write lost to a concurrent write of the same rows and may be retried.

Calling a model or the global `sql` tag outside an ORM scope throws a clear
scope error. Run standalone jobs inside `orm.run(() => ...)`.
