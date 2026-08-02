# Cossack Studio

`@cossackframework/studio` is the Node-only database inspector bundled with the
Cossack CLI. It loads `orm.config.ts` through the application's installed ORM
tooling.

```sh
cossack add studio
pnpm install
pnpm studio
```

The default command opens a loopback-only Studio session for the configured
local adapter:

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

For local connections, Studio detects the ORM driver's dialect.
`DB_CONNECTION` or `COSSACK_STUDIO_DRIVER` can distinguish SQLite-family
adapters. PostgreSQL and MySQL drivers remain project dependencies; Studio
executes through the ORM driver and never exposes credentials to browser code.
Project `.env` and `.dev.vars` files are loaded into the Studio server process
before `orm.config.ts` is imported; existing shell variables keep precedence.

Studio merges physical introspection with `orm.schema()`, displays logical
types and relation provenance, surfaces drift, and hides migration bookkeeping.
This means storage-oriented SQLite declarations can retain richer application
semantics through model decorators:

```ts
@Column({ type: 'json', name: 'meta', nullable: true })
declare meta: Record<string, unknown> | null;

@CreateDateColumn({ name: 'created_at' })
declare createdAt: Date;
```

The Structure tab shows both the ORM type (`json`, `datetime`) and physical
database type (`TEXT`, `VARCHAR(32)`). The Browse tab adds relation-property
columns for navigable ORM relations. Selecting one toggles a read-only related
table directly below that row, loaded through the corresponding foreign-key
filter. Relation data is fetched lazily and capped at 50 rows per expansion;
the panel's new-tab action opens the fully browsable filtered relation.

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
