# ORM

Cossack applications use `@cossackframework/database` with decorated Active Record
models. The generated `ormMiddleware` establishes one request scope; model
methods and the global parameterized `sql` tag resolve that scope.

```ts
import { Like } from '@cossackframework/database';
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
import { sql } from '@cossackframework/database';

const result = await sql`SELECT * FROM users WHERE id = ${id}`;
```

Node SQLite, PostgreSQL, and MySQL support `sql.transaction()`. D1 uses
native transactional batches and never emulates interactive transactions.

## Providers

`cossack add database --database <provider>` (or `cossack create --database`). The CLI
rejects a provider the runtime does not support.

| Provider | Runtime |
|---|---|
| `d1` | Cloudflare |
| `hyperdrive-postgres`, `hyperdrive-mysql` | Cloudflare |
| `sqlite`, `postgres`, `mysql` | Node |
| `turso`, `romedb` | Both |

## Migrations, schema, seeders, Studio

`orm.config.ts` registers entities, migrations and seeders as explicit arrays. Every command
takes `--target local|remote` (or `--local`/`--remote`) and `--env`.

```sh
cossack migration generate add_posts   # diff models against the snapshot
cossack migration up | down | latest | status | check | plan | baseline | squash
cossack schema inspect | pull | diff | check
cossack seeder run --only users        # alias: cossack seed
cossack studio                         # browse the database; --driver, --remote (D1 only)
```

Startup never changes the schema, except on RomeDB, where the first request applies pending
migrations. Change the schema with a new migration; never edit an applied one. See
`docs/database.md`, `docs/migrations.md`, `docs/seeders.md`.

## RomeDB

The `romedb` provider runs the same entities, queries and migrations through
`@cossackframework/romedb/orm`. An entity with `@Entity({ model: "document" })` is stored as a
document and can hold record links. No interactive transactions (like D1); a batch holds at
most 32 statements. Node opens a file (`ROMEDB_URL`, default `storage/romedb/app.romedb`) in
the server process, so run migrations against a file only while the server is stopped.
Workers use a URL with `ROMEDB_TOKEN`. See `packages/database/docs/romedb.md`.
