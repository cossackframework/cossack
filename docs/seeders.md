---
title: 'ORM seeders'
description: 'Deterministic, named seeders for Cossack applications.'
---

# ORM seeders

Define seeders with `defineSeeder()`. Register them explicitly in
`src/seeders/index.ts`.

```ts
import { defineSeeder } from '@cossackframework/database';
import { Role } from '../models/Role';

export default defineSeeder({
  name: 'roles',
  transaction: 'auto',
  async run() {
    await Role.upsert(
      {
        id: crypto.randomUUID(),
        name: 'admin',
        permissions: [],
        createdAt: new Date(),
      },
      ['name'],
    );
  },
});
```

```ts
import roles from './roles.seeder';

export const seeds = [roles] as const;
```

Run seeders through either public CLI alias:

```sh
cossack seeder list
cossack seeder run
cossack seed run --only roles
```

`transaction` is `'auto'` (the default: an interactive transaction when the
provider supports it), `'required'` (the seeder fails on D1, RomeDB and other
providers without interactive transactions) or `'none'`. Use idempotent
statements or explicit native batches instead of requiring an interactive
transaction.

`run({ orm, sql, signal })` receives the ORM and its `sql` tag. A seeder can
declare `operations` (SQL fragments) instead of `run`; they then drive both
`--dry-run` plans and execution. `--only` takes comma-separated names.
