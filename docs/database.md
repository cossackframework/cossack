---
title: 'ORM'
description: 'Decorated Active Record models for Cloudflare Workers and Node.js.'
---

# ORM

Cossack applications use `@cossackframework/orm`. The Framework package remains
ORM-agnostic; generated applications install and compose the ORM explicitly.

```sh
cossack add orm
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
Workers recipes create an ORM per request from D1, libSQL/Turso, or Hyperdrive
bindings; `ormMiddleware` closes factory-created instances after downstream
work completes.

## Models

```ts
import {
  BaseEntity,
  Column,
  Entity,
  PrimaryColumn,
} from '@cossackframework/orm';

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

Properties may be camel-case while `name` preserves an existing snake-case
physical column.

## Runtime middleware

```ts
import { ormMiddleware } from '@cossackframework/orm/cossack';
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
| Node | SQLite (`node:sqlite`), libSQL/Turso, PostgreSQL, MySQL |
| Workers | D1, Workers-safe libSQL/Turso, Hyperdrive PostgreSQL, Hyperdrive MySQL |

Hyperdrive recipes enable `nodejs_compat` and install only the selected
PostgreSQL or MySQL driver. Other Workers recipes use `nodejs_als`.

## Tooling

`orm.config.ts` registers entities, migrations, and seeders as deterministic
arrays. The application’s installed ORM tooling powers all commands:

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
