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
cossack studio --driver postgres
```

Remote D1 uses the project's authenticated Wrangler installation:

```sh
cossack studio --remote
cossack studio --remote --database DB --env production
```

Studio supports Cloudflare D1, SQLite, Turso/libSQL, PostgreSQL, and MySQL
schema inspection, exact row counts, adjustable pagination (100 rows by
default), inline and JSON-aware keyed row editing, and one arbitrary SQL
statement per execution. Its SQL editor includes syntax highlighting plus table
and column completion. Remote D1 changes affect deployed data immediately.

For local connections, Studio detects the dialect exposed by the Kysely client
returned by `getCliClient()`. `DB_CONNECTION` or `COSSACK_STUDIO_DRIVER` can be
set to `sqlite`, `turso`, `d1`, `postgres`, or `mysql` when a custom Kysely
dialect wrapper cannot be identified automatically. PostgreSQL and MySQL
drivers remain project dependencies; Studio reuses the already configured
Kysely client and does not read database credentials in browser code.
Project `.env` and `.dev.vars` files are loaded into the Studio server process
before `getCliClient()` is imported; existing shell variables keep precedence.

For programmatic startup:

```ts
import { runStudio } from '@cossackframework/studio';

await runStudio({
  projectRoot: process.cwd(),
  // Optional when a custom dialect wrapper cannot be detected:
  // provider: 'postgres',
  remote: false,
  port: 4983,
  open: true,
});
```
