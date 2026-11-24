---
title: 'ORM'
description: 'Decorated Active Record models for Cloudflare Workers and Node.js.'
---

# ORM

Cossack applications use `@cossackframework/database`. The Framework package
does not depend on an ORM. Generated applications install and compose the ORM.

```sh
cossack add database
pnpm install
cossack migration up
cossack schema check
```

The recipe creates:

```text
orm.config.ts
src/
├── orm/factory.ts
├── middlewares/orm.ts
├── models/index.ts
├── migrations/index.ts
└── seeders/index.ts
```

The model barrel imports `reflect-metadata` once and exports deterministic
entity registration. Node recipes create one caller-owned ORM singleton.
Workers recipes create an ORM per request from Turso, D1, RomeDB or
Hyperdrive bindings. `ormMiddleware` closes factory-created instances after
downstream work completes.

## Models

```ts
import {
  BaseEntity,
  Column,
  Entity,
  PrimaryColumn,
} from '@cossackframework/database';

@Entity({ tableName: 'users' })
export class User extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', name: 'id' })
  declare id: string;

  @Column({ type: 'varchar', name: 'email', unique: true })
  declare email: string;

  @Column({ type: 'text', name: 'password_hash', nullable: true })
  declare passwordHash: string | null;
}
```

Properties can use camel case while `name` preserves an existing snake-case
physical column.

### Soft delete

A `@DeleteDateColumn()` turns deletes into timestamps. Reads then hide rows whose
delete date is set, and the delete operations stamp the column instead of
removing the row:

```ts
@Entity({ tableName: 'posts' })
export class Post extends BaseEntity {
  @PrimaryGeneratedColumn() declare id: number;
  @Column({ type: 'varchar' }) declare title: string;
  @DeleteDateColumn() declare deletedAt: Date | null;
}

await Post.delete({ id: 1 });                 // sets deleted_at
await post.remove();                          // same, for a loaded entity
await Post.find();                            // live rows only
await Post.find({ withDeleted: true });       // every row
await Post.count({ title: 'x' }, { withDeleted: true });
await Post.query().withDeleted().getMany();
await Post.find({ where: { deletedAt: IsNotNull() }, withDeleted: true }); // the trash
await Post.restore({ id: 1 });                // clears deleted_at
await post.restore();
await Post.delete({ id: 1 }, { force: true }); // removes the row
await post.remove({ force: true });
await Post.deleteAll({ force: true });
```

`Post.softDelete(where)` is the explicit form of `delete()` and only touches live
rows; `restore(where)` only touches soft-deleted rows. Both reject an empty
`where`, and both throw on an entity without a `@DeleteDateColumn()`. A condition
of your own on `deletedAt` is kept alongside that guard: `restore({ deletedAt:
MoreThan(since) })` restores only rows deleted after `since`. A soft delete by
`deletedAt` matches no live row and is refused, so purge old soft-deleted rows with
`Post.delete({ deletedAt: LessThan(cutoff) }, { force: true })`. `reload()` reads
the entity's row even when it is soft-deleted.
Relation loading (`relations: [...]`) skips soft-deleted children. `update()` and
`updateAll()` do not filter: name `deletedAt: IsNull()` in `where` to limit them
to live rows. `IsNull()` and `IsNotNull()` fit any nullable column without a cast.

## Runtime middleware

```ts
import { ormMiddleware } from '@cossackframework/database/cossack';
import { createRequestORM } from '../orm/factory';

export const ormRequestMiddleware = ormMiddleware(
  (context) => createRequestORM(context.env),
);
```

The middleware sets `c.get('orm')` and wraps all downstream work in
`orm.run()`, so Active Record and the scoped `sql` tag work without threading a
context through application services.

## Providers

| Runtime | Providers |
|---|---|
| Node | SQLite (`node:sqlite`), Turso, PostgreSQL, MySQL, RomeDB |
| Workers | D1, remote Turso, Hyperdrive PostgreSQL, Hyperdrive MySQL, RomeDB |

Hyperdrive recipes enable `nodejs_compat` and install only the selected
PostgreSQL or MySQL driver. Other Workers recipes use `nodejs_als`.

### RomeDB

`cossack create my-app --database romedb` (or `cossack add database --database romedb`)
keeps the ORM's tables in RomeDB. Entities can be relational or documents: see the ORM's
[RomeDB guide](../packages/database/docs/romedb.md).

- **Node:** `ROMEDB_URL` is a file path (default `storage/romedb/app.romedb`). The database
  opens in the server process and is created on first use. A URL of `romedb serve` or
  RomeDB Cloud needs `ROMEDB_TOKEN`.
- **Workers:** `ROMEDB_URL` and `ROMEDB_TOKEN` name a RomeDB Cloud database. `pnpm dev`
  starts `romedb serve` for the loopback URL in `.dev.vars` and passes its token. The
  `ROMEDB_PENDING` Durable Object keeps writes that are not confirmed yet.
- **Migrations apply when the server starts.** The first request applies the migrations
  that are not applied yet (`applyPendingMigrations` in `src/orm/factory.ts`). A database
  that is up to date costs one read.
- **One process owns a RomeDB file.** Run `cossack migration` and `cossack seed` against a
  file only while the server is stopped. With a URL, they run at any time.
- **A CMS project** shares the CMS's RomeDB instance with the ORM, so both use one
  connection. The CMS owns the tables whose names start with `cms_` and `cossack_`.
- `romedbClient()` from `@cossackframework/romedb/orm` gives the RomeDB instance for
  RomeQL the ORM does not write.

## Tooling

`orm.config.ts` registers entities, migrations, and seeders as deterministic
arrays. The ORM tooling installed in the application powers all commands:

```sh
cossack migration generate add_posts
cossack migration up
cossack migration down
cossack migration status
cossack migration check
cossack migration baseline
cossack schema pull
cossack schema diff
cossack schema check
cossack seed list
cossack seed run
```

Migration history is stored in `_cossack_migrations`. Cossack never mutates an
application schema during startup, development, or package installation.

See [Queries](/docs/queries.md), [Migrations](/docs/migrations.md), and
[Seeders](/docs/seeders.md).
