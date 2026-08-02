# ORM

Cossack applications use `@cossackframework/orm` with decorated Active Record
models. The generated `ormMiddleware` establishes one request scope; model
methods and the global parameterized `sql` tag resolve that scope.

```ts
import { Like } from '@cossackframework/orm';
import { User } from '@/models/User';

const users = await User.find({
  where: { email: Like('%@example.com') },
  order: { createdAt: 'desc' },
});

await User.update({ id }, { name: 'Ada' });
```

Use models only in server-executed work: `server$` loaders, `@Server()` methods,
server middleware, jobs wrapped in `orm.run()`, migrations, or seeders. ORM
value imports are server-only and the security plugin strips them from client
bundles.

For joins and provider-specific operations, use parameterized scoped SQL:

```ts
import { sql } from '@cossackframework/orm';

const result = await sql`SELECT * FROM users WHERE id = ${id}`;
```

Node SQLite, libSQL, PostgreSQL, and MySQL support `sql.transaction()`. D1 uses
native transactional batches and never emulates interactive transactions.

Generated applications register entities, migrations, and seeders as explicit
arrays in `orm.config.ts`. Apply migrations deliberately; startup never mutates
the schema.
