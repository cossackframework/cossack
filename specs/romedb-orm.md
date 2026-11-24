# RomeDB as an ORM database

Status: built 2026-11-20 and 2026-11-21 on `feat/romedb-database-driver`: steps 1–5. Steps 6
and 7 are decided against.

## Why

Packages that keep data through the ORM (`dashboard`, `studio`, a project's own models) run
on D1, SQLite, Turso, PostgreSQL and MySQL. RomeDB applications could not use them, so the
CMS carries its own data module. One adapter lets every ORM package run on RomeDB, and
document entities let application code use RomeDB's document model through the same API.

## Decisions

- **RomeDB is an adapter of `database`, not a second set of packages.** RomeDB's relational
  model is the SQLite dialect, so the driver reuses that dialect and rewrites `?` to named
  parameters.
- **`database` has no dependency on RomeDB.** The driver (`@cossackframework/database/romedb`)
  takes the instance and RomeDB's value classes as arguments. Applications import
  `romedb()` and `romedbClient()` from `@cossackframework/romedb/orm`, which passes them. A
  second copy of `@romedb/client` would make a client refuse the other copy's values.
- **Framework tables are relational on every database**: users, sessions, roles, OAuth
  accounts, cache. The served `auth.ts` and services stay one module.
- **Document entities are opt-in per entity**: `@Entity({ model: "document" })`. The SQL the
  ORM writes for a relational table also runs on a document table, so the query builder is
  shared. Fields are not declared in the database; the schema diff compares indexes only.
- **A relation between two document entities is a record link.** A relation that crosses the
  two models keeps the other row's key, with no foreign key.
- **`romedbClient()` gives the RomeDB instance** for RomeQL the ORM does not write. The ORM
  never closes that instance.
- **No interactive transactions**, as on D1. A batch is one atomic write of at most 32
  statements; migrations use it.
- **The CMS keeps its own data layer** and shares the pages only (user, 2026-11-21; see
  below). A CMS project's own ORM tables share the CMS's RomeDB instance.

## Order

1. Driver: reads and writes, batch, `RETURNING`, introspection through `INFO FOR`. Done.
2. Document entities, record links, `RecordLink` in the `sql` tag. Done.
3. Tests and docs: `packages/database/test/romedb.test.ts` (no engine needed),
   `packages/romedb/tests/orm.test.ts` (live), `packages/database/docs/romedb.md`. Done.
4. Scaffold: `romedb` is a database provider on Node and Workers. Done.
   - The server applies pending migrations with its first request
     (`applyPendingMigrations`), because one process owns a RomeDB file (user, 2026-11-20).
     Commands still work against a file while the server is stopped.
   - Node opens the database with the first request, not when a module loads, so a build
     does not take the file from a running server.
   - Workers bind `ROMEDB_PENDING`; the `cossack/vite` preset starts `romedb serve` in
     development.
   - A CMS project's ORM takes the CMS's RomeDB instance.
   - Tests: `packages/cossack/tests/generated-runtime-romedb.test.js` (Node, Workers, CMS).
5. The dashboard package gets the account features that only the CMS had (below). Done.
6. Not built (user, 2026-11-21): the CMS on the dashboard's account module.
7. Not built (user, 2026-11-20): Studio on RomeDB. People who want a studio for a RomeDB
   database use the `@romedb/studio` package.

## Step 5: the dashboard's account features

Before this work the dashboard's `auth.ts` answered "not available" for most of what the
CMS's does. It now has every account feature of the CMS that is not about sites, on ORM
entities, so they work on SQLite, PostgreSQL, MySQL, D1 and RomeDB.

Built 2026-11-20, first slice: sign-in limits, two-step sign-in (authenticator, recovery
codes), passkeys, and required two-step sign-in (`security` in `src/dashboard.config.ts`).

- Store: `packages/dashboard/app/src/services/security.ts`, on four entities of the project
  (`UserSecurity`, `Passkey`, `AuthChallenge`, `AuthAttempt`) and `sessions.second_factor`,
  from migration `0007_create_account_security`.
- Every limit is one conditional write, as in the CMS, so it holds for requests sent at once
  on each database.
- Test: `packages/cossack/tests/generated-runtime-account-security.test.js`, the same flow
  on SQLite and on a RomeDB file.
- Not done: a browser test of passkeys; `cossack.hostSteps` for projects made before this
  migration; a schedule that calls `security.purgeExpired()`.

Built 2026-11-20, second slice: the rest of the features that are not about sites.

- **Setup page** (`/auth/setup`): the first account, with the `admin` role, while no account
  exists. It needs `SETUP_CODE`; without it the seeder makes the first account as before.
- **Registration** (`registration` in `src/dashboard.config.ts`): open or closed, email
  confirmation, an administrator's approval, a default role. Accounts have a `status`
  (in `0001_create_users`); only `active` accounts sign in or keep a session.
- **Links**: `/auth/verify` and `/auth/magic`. A link's token is kept as its hash, in the
  sessions table under its own `kind`, and is spent in one conditional delete.
- **Users → Registrations** (`/dashboard/users/registrations`): approve or delete. The CMS
  gets the same page from the shell, on three functions its `auth.ts` now exports too.
- **Application passwords** (`services/api-tokens.ts`, migration `0008_create_api_tokens`),
  and `apiTokenUser(token)` for a project's API routes. Tokens start with `app_`.
- Tests: `generated-runtime-account-security.test.js` runs both flows on SQLite and RomeDB.

Not ported: avatar uploads (a project has no file storage of its own) and everything about
sites (network accounts, memberships, site registration).

## The CMS keeps its own data layer

Decided (user, 2026-11-21), after the first steps of a merge were built and then taken out.

- **Shared:** the sign-in pages, the dashboard layout and its kit, as before. The CMS gets
  them as a synced copy and adds its own screens beside them. A shared page imports only
  names that both `auth.ts` modules export. The CMS's `auth.ts` gained `registrations`,
  `deleteRegistration` and `registrationApproval` for the shared Registrations page.
- **Not shared:** accounts, members, roles, sessions, second factors and application
  passwords. The CMS keeps `CmsAccounts`, `CmsUsers`, `CmsSecurity`, `CmsApiTokens`, its
  session store and their `cms_` tables, with no ORM tables in its databases and no
  dependency on `@cossackframework/database`.
- **Why:** the dashboard needs one relational `users` table that works on every database.
  The CMS needs multisite (an account is not a member; each site has its own database) and
  wants RomeDB's document model. One schema for both needed side tables for everything that
  only a CMS member has, and ruled out documents for users.
- **What was tried:** second factors and limits, application passwords and sessions ran on
  the dashboard's stores through one ORM per CMS database, with every suite passing. It
  worked because those stores need only a user's ID. It was taken out so the CMS has one
  data layer, not two.
- **Not built:** a `romedb-dashboard` package. A plain RomeDB project uses `dashboard`
  through the adapter. If a RomeDB project later needs document users or multisite without
  the CMS, lift the CMS's account module then.

Kept from that work, because the dashboard's own store uses it: `atomic()` and
`currentDialect()` (a counter with a limit is one transaction, or one request on RomeDB and
D1), `isWriteConflict()`, and the innermost-scope rule for several ORMs.

### Later, in the CMS only: field group values as documents

Built 2026-11-21 for users and terms: `specs/cms-field-values.md`.

A field group attaches to collections, taxonomies, users and menus, and its values are
stored in two ways. On a collection they are typed fields of the entry's document: they can
be indexed, filtered and kept unique, and a reference is a record link. On users, terms and
menu items they are JSON text in a `meta` column: the database cannot index or filter them,
and every write replaces the whole value.

Proposed: field group values are always document fields. Users, terms and menu items each
get a CMS-only document under the same ID as their relational row, which keeps what guards
and sign-in read (email, status, roles).

Probed on RomeDB 0.2.27 (2026-11-21), with a relational `cms_users` and a document
`cms_user_fields` keyed by the user's ID. It works:

- The row and its document are made, changed and deleted in one atomic write; a failing
  statement undoes the document's change too.
- One field updates without the others (`UPDATE t SET "team" = $v WHERE id = $id`), a nested
  field too, and a nested set makes its parent. Two writers of different fields at once
  both keep their change. `UPSERT` merges into the document.
- `UPDATE t UNSET "field"` removes a field; several in one statement. A missing field reads
  as null and matches `IS NULL`.
- Indexes on a field and on a nested field; a unique index is enforced, and members without
  a value (missing or null) do not collide.
- A reference is a record link: filter by it, `record::fetch` it, and `array::contains`
  finds it in a list.
- A member list is one statement: `FROM cms_users u LEFT JOIN cms_user_fields d ON
  record::id(d.id) = u.id`, with the whole document as a column, and it can filter, order
  and group by a field.
- A write to the document can be guarded by the relational row
  (`... AND EXISTS (SELECT 1 FROM cms_users WHERE id = $key AND status = 'active')`), and a
  document can be inserted only while its row exists.

Limits found:

- A relational write cannot be guarded by a document's field (`unsupported: managed
  collection SQL requires logical lowering`). Keep what guards read in the relational row,
  or use the guard rows of `CmsHost.batch`.
- `null` in a field that is the parent of an indexed nested field is refused. Unset the
  field to clear it.
- `SET` and `UNSET` cannot share a statement: use two, in one write.
- A plain index does not cover a field that holds a list. Use `CREATE SEARCH INDEX … USING
  ARRAY`, as the CMS does for collections (`src/server/schema.ts`).

## Open

- **Whether `romedb` becomes the default database** for new projects, or stays a choice.
- `generated-runtime-cms-access.test.js` fails on the last commit too, with about 520
  problems: its signed-in principals are answered as guests. Not caused by this work, and
  not fixed here; it cannot confirm the session step until it passes again.
- `generated-runtime-cms-essentials.test.js` fails on Node at its Health check ("No email
  sender") on the last commit too: with a local `APP_URL` the development mail transport is
  always set. Not changed here.
- Not checked: `pnpm dev` of a `--database romedb` project on either runtime, the deploy
  preflight for `ROMEDB_URL`/`ROMEDB_TOKEN`, and `cossack adapter` on such a project.

## Requests for RomeDB

Filed 2026-11-21 in `~/Sites/fastdb/requests.md` as Q1 to Q6. None blocks work here: each
has a workaround that goes when a release lifts the limit.

- Q1: a record link and a graph edge that point at a relational row.
- Q2: `null` in the parent of an indexed nested field.
- Q3: `SET` and `UNSET` in one `UPDATE`.
- Q4: a relational write guarded by a document's field.
- Q5: index columns and foreign keys in `INFO FOR TABLE` for a relational table.
- Q6: renaming a document table.
