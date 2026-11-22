# Tenants

A tenant is an organization with its own database, members and roles. Accounts are shared:
one person signs in with the same email and password on every tenant they belong to.
Tenants are part of `@cossackframework/dashboard` and are off by default.

A CMS project does not use this: the CMS has a network of sites (`docs/cms/multisite.md`).

## Turn them on

```ts
// src/dashboard.config.ts
export const dashboard: DashboardConfig = {
  tenants: { enabled: true },
};
```

Set `APP_URL` to the application's address. Its host is the **main host**: the main tenant,
where accounts are made and tenants are managed. A tenant answers at `<slug>.<main host>`,
so the main host needs a wildcard DNS record (`*.app.example.com`), and at any domain you
give it on the Tenants screen. Without `APP_URL` every request is the main tenant's.

## What is where

| In the main database | In each tenant's database |
| --- | --- |
| Accounts (`users`, with the password) | A member row in `users` under the account's ID: email and name copied, no password |
| The main host's sessions, OAuth accounts, second factors, passkeys, application passwords | The tenant's sessions, `roles` and `user_roles` |
| `tenants`, `tenant_domains`, `tenant_members`, `tenant_sessions` | Your own tables |

Every database has the same schema: each gets all of the project's migrations. A request
for a tenant's host runs in that tenant's database, so your models and services need no
change. Code that must reach the main database from a tenant's request wraps itself:

```ts
import { accounts, currentTenant } from '@cossackframework/dashboard/app/tenants';

const tenant = currentTenant();          // null on the main host
const total = await accounts(() => User.count());
```

## Managing tenants

Dashboard → Tenants, on the main host, for network administrators:

- **Create** a tenant from a name and an address (`acme`). Its database is opened, the
  migrations run, the main tenant's roles are copied, and you become its administrator.
- **Members**: add an account by its email. On the tenant's own host, Users → Add user does
  the same, and makes the account when the email has none.
- **Domains**: add a host name of the tenant's own and point it at the application. Press
  **Verify**: the application asks the domain for `/.well-known/cossack-tenant` and expects
  the tenant's ID, which it answers itself for every host a tenant asked for. A verified
  domain reaches the tenant. **Make primary** makes it the tenant's address: its other hosts
  redirect there. `tenants: { verifyDomains: false }` skips the check.
- **Archive**: the tenant's hosts answer 503 and its data stays.
- **Delete**: its hosts answer 404. It can be restored for 30 days. After that
  `purgeDeletedTenants()` (from `@cossackframework/dashboard/app/services/tenants`) forgets
  it and returns what it forgot, so a schedule of yours can drop each database.
- **Turn the network off**: only the main host answers, and tenants keep their data.

An account that is not a member of a tenant cannot sign in on its host. A network
administrator can, on every tenant, with every permission: it is a flag on the account (the
first account has it), set on the Tenants screen, and the last one cannot lose it. Only
network administrators see the Tenants screen. Registration and the setup page are on the main host only.
A tenant's administrators choose a member's roles; a member's profile, password and sign-in
methods belong to the account's owner.

## Sign-in: per host or shared

```ts
tenants: { enabled: true, signIn: 'host' }    // default
tenants: { enabled: true, signIn: 'shared' }
```

- **`host`**: each tenant's host has its own sign-in page. A person signs in once per host,
  with the same account.
- **`shared`**: people sign in on the main host only. A tenant's sign-in page sends the
  visitor there; a signed-in member comes back with a one-time code (one minute, one use, and
  only in the browser that started), and the tenant's host makes its own session from it.
  Signing out on any host ends the session on the main host and on every tenant's host.

Accounts are in the main database in both modes, so the setting can change later. A
tenant's sessions are in its own database; with shared sign-in the main database records
which tenants a session reached. Shared sign-in works for subdomains and for a tenant's own domain, because each host
keeps its own cookie.

## Where a tenant's database is

`src/orm/factory.ts` has `tenantORM(env, tenant)`, written for the project's database. A
tenant's migrations are applied the first time its database is opened in a process.

| Database | A tenant's database | Who creates it |
| --- | --- | --- |
| SQLite (Node) | `tenants/<name>.sqlite` beside the main file | The application, on first use |
| RomeDB file (Node) | `tenants/<name>.romedb` beside the main file | The application, on first use |
| RomeDB service or Cloud | `TENANT_DATABASE_URL`, with `{tenant}` in it | You |
| PostgreSQL, MySQL (Node) | `TENANT_DATABASE_URL`, with `{tenant}` in it | You |
| Turso | `TENANT_DATABASE_URL`, with `{tenant}` in it; `TENANT_DATABASE_TOKEN` | You |
| D1 | The binding `DB_<SLUG>` | You, in `wrangler.jsonc` |
| Hyperdrive | The binding `HYPERDRIVE_<SLUG>` | You, in `wrangler.jsonc` |

`<name>` is the tenant's address with `-` as `_` (`acme-labs` is `acme_labs`). `<SLUG>` is
the address in capitals with `-` as `_` (`DB_ACME_LABS`).

### PostgreSQL and MySQL

Create the database before you create the tenant on the Tenants screen. The application
applies the migrations when it first opens it.

```bash
# .env
TENANT_DATABASE_URL=postgres://app:secret@db.example.com:5432/app_{tenant}
```

```bash
createdb --host db.example.com --username app app_acme
```

```bash
mysql --host db.example.com --user app --password --execute "CREATE DATABASE app_acme"
```

To create the databases of several tenants at once:

```bash
for tenant in acme globex initech; do createdb --host db.example.com --username app "app_$tenant"; done
```

The database user needs the right to create tables in each tenant's database.

## Limits today

- A member's email and name in a tenant are copied when they join and are not updated when
  the account changes.
- Tenant-only accounts and self-service tenant registration are not built. Nothing purges
  deleted tenants on a schedule or drops their databases.
- Uploaded files are not separated by tenant.
- The Workers bindings (D1, Hyperdrive, RomeDB Cloud) are written and not yet run in a test.
