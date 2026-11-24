# Tenants in the dashboard package

Status: built 2026-11-22 on `feat/romedb-database-driver` (Outcome below).

## Why

The dashboard package serves one application with one database. The CMS has its own account
layer mostly because it needs sites: an account is not a member, and each site has its own
database. With the same model in the dashboard, a project gets multi-tenancy without the
CMS, and the CMS could later run on the dashboard's accounts (`specs/romedb-orm.md`, step 6).

## Decisions

- **Off by default.** `tenants: { enabled: true }` in `src/dashboard.config.ts` turns it on.
  Without it nothing changes: one database, no extra request work.
- **A database per tenant** (user, 2026-11-22). No `tenant_id` columns.
- **Every database has the same schema.** A tenant's database gets every migration of the
  project. So services, pages and the project's own models run unchanged inside a tenant.
  The main database is also the main tenant's, and holds what is shared.
- **Shared, in the main database:** accounts (`users` with the password), the main host's
  sessions (a tenant's are in its own database since 2026-11-22), OAuth
  accounts, second factors, passkeys, application passwords, and three new tables:
  `tenants`, `tenant_domains`, `tenant_members`.
- **Per tenant:** a member row in the tenant's `users` under the account's ID (email, name
  and status copied, no password), `roles`, `user_roles`, and the project's own tables.
- **A request runs in its tenant's ORM scope.** The middleware finds the tenant by host and
  opens that ORM's scope inside the main one; the innermost scope wins, so models reach the
  tenant's database. Account code runs in the main ORM through `accounts(() => …)`.
- **A tenant is found by host:** `<slug>.<APP_URL host>` or a row of `tenant_domains`.
  `APP_URL`'s own host is the main tenant. An unknown host answers 404.
- **Sign-in is per host or shared, by `tenants.signIn`** (user, 2026-11-22). The account and
  its sessions are in the main database either way, so the setting can change later.
  - `host` (default): each tenant host has its own sign-in page and cookie.
  - `shared`: a tenant host sends the visitor to the main host, which answers with a
    one-time code (60 seconds, kept as its hash in `tenant_handoffs`). The tenant host trades
    it for a session of its own, linked to the main one (`sessions.parent_id`). Ending a
    session ends the sessions linked to it.
- **Membership.** A signed-in account that is not a member of the host's tenant is a guest
  there. Main-tenant administrators are members of every tenant.
- **Where a tenant's database is** comes from the project's `src/orm/factory.ts`
  (`tenantORM(env, tenant)`), written by the scaffold for its database:
  - SQLite and RomeDB files: a file beside the main one, created on first use.
  - URLs (PostgreSQL, MySQL, Turso, a RomeDB service): `TENANT_DATABASE_URL` with `{tenant}`
    in it. The database must exist; `docs/tenants.md` has the commands and a script.
  - D1: a binding per tenant, named `DB_<SLUG>`.
- **A tenant's migrations are applied when its database is first opened** in a process.
- **Tenants screen** (`/dashboard/tenants`, main tenant, administrators): list, create,
  archive, domains, members. Creating one makes the row, opens the database, applies
  migrations, copies the default roles and adds the creator as its administrator.

## Order

1. Models and migration; `tenantORM` in the scaffold's factories; the middleware.
2. `auth.ts`: account code in the main scope, membership, roles from the tenant.
3. The tenants service and screen.
4. Shared sign-in: the handoff route, codes, linked sessions.
5. Tests (`generated-runtime-tenants.test.js`: SQLite and RomeDB), docs, the script.

## Outcome

- `@cossackframework/database`: `createTenantORMs`, `tenantUrl`; `ORM.run` re-enters its own
  scope in front of another ORM's scope opened inside it (`accounts()` relies on it).
- Scaffold: `tenantORM` in every generated `src/orm/factory.ts`; four models
  (`Tenant`, `TenantDomain`, `TenantMember`, `TenantHandoff`), migration `0009_create_tenants`
  (with `sessions.parent_id`); `tenantMiddleware` before the sign-in middleware.
- Dashboard package: `src/tenants.ts` (`currentTenant`, `accounts`, `inTenant`, `withTenant`),
  `middlewares/tenant.ts`, `services/tenants.ts`, the Tenants screen and module. In `auth.ts`
  every exported function runs in the main database; roles and membership come from the
  tenant. `services/users.ts` adds and removes members inside a tenant.
- Files the CMS copies from the dashboard (`middlewares/auth.ts`, `dashboard/registry.ts`,
  pages) import no tenant module; the CMS's `auth.ts` has stubs for the shared Tenants page.
- Registration and setup are on the main host only.
- Test: `packages/cossack/tests/generated-runtime-tenants.test.js`, SQLite and a RomeDB file.
- Docs: `docs/tenants.md`, with the PostgreSQL and MySQL commands.
- Shared sign-in: `/auth/tenant/redirect` (main host, issues the code) and
  `/auth/tenant/callback` (tenant's host, trades it), `issueTenantHandoff` and
  `completeTenantHandoff` in `auth.ts`. The tenant middleware sends a tenant's `/auth/login`
  to the main host with a state cookie, and brings a visitor who signed in there back
  (`tenant_return` cookie). A session made from a code has `parent_id`; revoking any session
  of the family ends all of it, and rotation moves `parent_id` along.
- Not built: a command that migrates every tenant; a script that creates
  databases (the docs have the commands). Not run: the Workers variants, PostgreSQL, MySQL,
  Turso.

## Later

- Tenant-only accounts, self-service tenant
  registration, deleting a tenant's database, per-tenant file storage.
- The CMS on this model.
