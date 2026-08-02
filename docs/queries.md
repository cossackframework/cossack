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

`Equal`, `Not`, `MoreThan`, `MoreThanOrEqual`, `LessThan`, `Like`, `In`,
`NotIn`, and `IsNull` are available for object predicates.

## Parameterized SQL

Use the scoped `sql` tag for joins or database-specific operations. Values are
always parameters; identifiers must be explicit.

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

Arbitrary SQL in Studio is an explicitly trusted local developer operation.
Studio still binds parameters and uses safe row locators for edits.

## Transactions

Node SQLite, libSQL, PostgreSQL, and MySQL support interactive transactions:

```ts
await sql.transaction(async () => {
  await User.insert(user);
  await AuditEvent.insert(event);
});
```

D1 does not emulate interactive transactions. Use D1’s native `batch()` for
multi-statement atomic work; the batch is transactional and rolls back when a
statement fails. Prefer a single idempotent statement when possible.

Calling a model or the global `sql` tag outside an ORM scope throws a clear
scope error. Standalone jobs should use `orm.run(() => ...)`.
