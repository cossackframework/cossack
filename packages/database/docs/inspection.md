---
title: Database inspection
description: Shared read-only schema, model, capability and migration facts for CLI and Studio.
---

# Database inspection

Run `cossack schema inspect --json --env staging --target local` to inspect the
selected database. The result contains physical schema, declared model and
relationship metadata, provider capabilities, migration status and existing
history. Inspection does not create migration bookkeeping or apply migrations.
A named Cloudflare environment never falls back to top-level D1 bindings.

The database tooling entry exports the same service used by Studio:

```ts
import { inspectConfiguredDatabase } from '@cossackframework/database/tooling';
import config from './orm.config.js';

const facts = await inspectConfiguredDatabase(config, {
  cwd: process.cwd(),
  configPath: 'orm.config.ts',
  environment: 'staging',
  target: 'local',
  readOnly: true,
});
console.log(facts.migrations.map(item => ({ name: item.name, state: item.state })));
```

This service passes `readOnly: true` to the application adapter factory and closes
its temporary connection after success or failure. Factories must honor the
selected environment/target and avoid setup writes when read-only. If ORM model
validation fails after creating an adapter, the adapter is closed too.
`inspectDatabase(orm, migrations)` inspects an existing borrowed connection;
its owner remains responsible for closing it.

Resolved identity includes only bounded public fields. Connection URLs, credential
fields, getter properties and bound SQL values are excluded. Driver capabilities
are declarations of support, not a connectivity check or proof of server version.
Absent target metadata remains unspecified rather than guessing from a URL.
The `defaultValues: omitted` policy removes model and physical column default
values from shared inspection; entity metadata reports `hasDefault`. Use the
application-owned migration SQL when reviewing an explicit default change. Unknown historical migration names remain in `history` even
when their declarations are no longer loaded.

Studio displays these same facts under **Database capabilities and migrations**.
Its richer row editor still provides indexes, views and row locators. Those editor
details are separate from the shared versioned inspection result. Remote Studio
inspection loads the application's `orm.config.ts` and uses its remote adapter
factory; the selected binding must match an explicit `--database` request.
