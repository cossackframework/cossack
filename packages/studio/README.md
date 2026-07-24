# Cossack Studio

`@cossackframework/studio` is the Node-only database inspector bundled with the
Cossack CLI. It reads the database configured by `src/db/config.ts` without
requiring application models.

```sh
cossack add studio
pnpm install
pnpm studio
```

The default command opens a loopback-only Studio session for the local
`getCliClient()` target:

```sh
cossack studio
cossack studio --no-open --port 4983
```

Remote D1 uses the project's authenticated Wrangler installation:

```sh
cossack studio --remote
cossack studio --remote --database DB --env production
```

Studio supports SQLite-family schema inspection, 50-row pagination, keyed row
inserts/updates/deletes, and one arbitrary SQL statement per execution. Remote
D1 changes affect deployed data immediately.

For programmatic startup:

```ts
import { runStudio } from '@cossackframework/studio';

await runStudio({
  projectRoot: process.cwd(),
  remote: false,
  port: 4983,
  open: true,
});
```
