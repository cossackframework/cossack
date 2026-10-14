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

The printed launch URL contains a one-time token. The first visit exchanges it
for an HttpOnly, `SameSite=Strict` session cookie and the token stops working;
later visits from the same browser use the cookie. To open Studio in another
browser or profile, restart it to get a new launch URL.

Remote D1 uses the project's authenticated Wrangler installation:

```sh
cossack studio --remote
cossack studio --remote --database DB --env production
```

Studio supports Cloudflare D1, SQLite, Turso, PostgreSQL, and MySQL
schema inspection. It shows exact row counts and adjustable pagination, with
100 rows by default. It supports inline and JSON-aware keyed row editing. It runs one arbitrary SQL
statement per execution. Its SQL editor includes syntax highlighting plus table
and column completion. Remote D1 changes affect deployed data immediately.

Batch delete and batch update apply all or nothing on SQLite, Turso,
PostgreSQL and MySQL: Studio runs them in one transaction and rolls back if a
selected row is stale or a statement fails. D1 (local and remote) has no
interactive transactions, so batches there are best-effort. Rows changed
before the failure stay changed, and the error reports how many. Remote D1
sends up to 50 statements in one Wrangler call, as one D1 batch: a failing
statement rolls back the rows of its own call, but a stale row does not stop
the other rows in the same call.

Studio groups remote D1 statements into few Wrangler calls, because each call
starts a Wrangler process. A schema load takes three or four calls, whatever
the number of tables. A browse takes one call, and the Pragmas tab takes one
call after the first visit.

For local connections, Studio detects the ORM driver's dialect.
`DB_CONNECTION` or `COSSACK_STUDIO_DRIVER` can distinguish SQLite-family
adapters. PostgreSQL and MySQL drivers remain project dependencies. Studio
executes through the ORM driver and never exposes credentials to browser code.
Project `.env` and `.dev.vars` files are loaded into the Studio server process
before `orm.config.ts` is imported. Existing shell variables keep precedence.

Studio merges physical introspection with `orm.schema()`, displays logical
types and relation provenance, surfaces drift, and hides migration bookkeeping.
The introspected schema is cached. Studio invalidates it after SQL console
statements that may change the schema (DDL, writes, `SELECT … INTO`, PRAGMA
writes) and after pragma edits. The Browse tab's refresh button re-introspects
to pick up changes made outside Studio.

The "Database capabilities and migrations" panel loads `inspection` on demand
when it is opened: the shared read-only database facts used by
`cossack orm schema inspect --json`. Programmatic callers use
`StudioDatabase.getInspection()`; `getSchema()` includes `inspection` only
after it has been loaded. These facts include the
selected target and environment, driver/dialect capabilities, physical and
model schema, known relationships, and applied, pending or changed migrations.
Inspection does not create migration bookkeeping tables or apply migrations.
Credential fields and temporary connection identities are excluded.

For programmatic inspection of a configured project:

```ts
import { inspectStudioProject } from '@cossackframework/studio';

const facts = await inspectStudioProject({
  projectRoot: process.cwd(),
  environment: 'staging',
  target: 'local',
  binding: 'STAGING_DB',
});
```

The project adapter receives the selected environment and target with
`readOnly: true`. The optional binding must match the inspected target.
Named environments must select their own configured binding. An absent binding
must fail rather than use an unrelated top-level database. Temporary inspection
connections close after success or failure. An existing local Studio connection
keeps ownership of its borrowed ORM until Studio closes it.

Storage-oriented SQLite declarations can retain richer application
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
filter. Relation data is fetched lazily and capped at 50 rows per expansion.
The panel's new-tab action opens the fully browsable filtered relation.

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
