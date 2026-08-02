---
title: 'ORM seeders'
description: 'Deterministic, named seeders for Cossack applications.'
---

# ORM seeders

Define seeders with `defineSeeder()` and register them explicitly in
`src/seeders/index.ts`.

```ts
import { defineSeeder } from '@cossackframework/orm';
import { Role } from '../models/Role';

export default defineSeeder({
  name: 'roles',
  transaction: 'auto',
  async run() {
    await Role.upsert(
      {
        id: crypto.randomUUID(),
        name: 'admin',
        permissions: '[]',
        createdAt: new Date().toISOString(),
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

`transaction: 'auto'` uses an interactive transaction when the provider
supports it. D1 seeders should use idempotent statements or explicit native
batches instead of requesting an interactive transaction.
