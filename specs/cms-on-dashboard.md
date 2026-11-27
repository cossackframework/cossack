# The CMS on the dashboard's accounts and tenants

Status: built 2026-11-22, steps 1 to 8, committed one by one. It replaces "step 6" of `specs/romedb-orm.md`,
which was built in part and reverted on 2026-11-21, before the dashboard had tenants
(`specs/dashboard-tenants.md`) and before a user's field values were documents
(`specs/cms-field-values.md`).

## What the survey found (2026-11-22)

- **The coupling is contained.** No content query joins the account tables. Outside
  `accounts.ts` and `users.ts`, RomeQL names them in `security.ts` (37), `stores.ts` (22),
  `handoffs.ts` (15), `api-tokens.ts` (6), `sites.ts` (3), and site export and import.
- **`Principal` is everywhere** (about 1,900 mentions in 120 files). It stays. Only where it
  is built from a user changes (`CmsUsers.resolve`).
- **The CMS has no ORM dependency**, and its served files may import from a project only
  what `cossack.host` lists (`cms.config.ts`, `stores.client.ts` today).
- **The two packages already export almost the same names** from `auth.ts` and
  `services/{users,roles,rbac}.ts`.
- **The dashboard lacks:** invitations, avatar uploads, held accounts, tenant-only accounts
  and their conversion, self-service tenant registration, recovery mode, permissions with
  wildcards and grant checks (`checkGrant`), the last-administrator rule, user hooks and
  outbox events, author slugs and field values.
- **Tenants and sites disagree on:** domain verification and a primary domain with
  redirects, a `deleted` state with a purge, the runtime on/off switch, the creation steps,
  where a site's sessions live (site database or main), and who reaches every site
  (`network_admin` on the account, or the main tenant's `admin` role).

## Decisions (user, 2026-11-22)

All four accepted. On 3, the user's answer was "the dashboard adopts the CMS's behaviour": where
the two differ, the CMS's wins, sessions included. `tenants.signIn` stays, as the user asked
for it the same day. On 4, `network_admin` stays a flag on the account.

1. **Tables.** The CMS uses the dashboard's tables (`users`, `roles`, `user_roles`,
   `sessions`, security, tokens, `tenants`, `tenant_domains`, `tenant_members`) and drops
   `cms_accounts`, `cms_users`, `cms_roles`, `cms_user_roles`, `cms_auth_sessions`,
   `cms_memberships`, `cms_sites`, `cms_site_domains`, `cms_handoffs`, `cms_session_sites`
   and the security and token tables. Alpha, no converter: an existing CMS site loses its
   accounts and sites list.
2. **Dependency.** `@cossackframework/cms` depends on `@cossackframework/database`, and a
   CMS project gets the account models and migrations (`src/models`, `src/migrations`) that
   a dashboard project has. Each site database holds ORM tables beside the CMS's own.
3. **Which model wins where they disagree.** Proposed: the dashboard takes the CMS's
   behaviour for domains (verification, primary, redirects), the `deleted` state, tenant-only
   accounts, wildcard permissions and grant checks. The CMS takes the dashboard's for
   sessions (all in the main database) and for sign-in (`tenants.signIn`).
4. **`network_admin`.** Kept as a flag on the account, or replaced by the main tenant's
   `admin` role.

## Order (each step ships and is tested alone)

1. Dashboard: permissions with wildcards, grant checks, the last-administrator rule. **Done**:
   `lib/permissions.ts` (`permissionMatches`, `holds`, `holdsAll`, `validPermission`),
   `services/rbac.ts` (`permissionsOf`; the admin role holds everything and cannot change),
   role changes check the acting user's permissions, the last administrator stays. The
   last-administrator check reads, then writes: two requests at once can both pass.
2. Dashboard tenants take the CMS's behaviour. In parts:
   - **Done:** network administration is the account's flag (`users.network_admin`, migration
     `0013`): every permission in every tenant, the Tenants screen, and the last active one
     stays. The main tenant's `admin` role no longer reaches other tenants.
   - **Done** (user, 2026-11-22: "as the CMS"): a tenant's sessions are in its own database.
     A session made from a main one names its public ID (`sessions.parent_id`), and
     `tenant_sessions` in the main database records which tenants a main session reached, so
     ending one ends the family. A new password and a removed account end the account's
     sessions on every host it is a member of. Migration `0015`.
   - **Done:** an account of one tenant only (`users.tenant_account` in the tenant's database):
     its password, second factors, tokens, links and sessions are there. It is made by
     registering on the tenant's host, or by the tenant's administrator for an email no main
     account has, and signs in on that host only. `accounts()` follows the account
     (`accountOf`, `accountByEmail`, `accountByToken` in `auth.ts`).
   - **Done:** shared sign-in as the CMS's: the tenant's sign-in page stays, for its own
     accounts; a visitor is sent to the main host once on their own (`auto=1`) and comes back
     signed in or to that page, which links to the main host's sign-in.
   - Not done for a tenant's own accounts: passkey sign-in (a passkey challenge is made in
     the main database) and OAuth. Converting an account between the two kinds, as the CMS's
     `moveTo` does, comes with step 5.
   - **Done:** domains are verified before they serve (`/.well-known/cossack-tenant`;
     `tenants.verifyDomains: false` trusts them), one may be primary and the tenant's other
     hosts redirect to it with 301; `deleted` (404, restorable for 30 days,
     `purgeDeletedTenants()`); the network's on/off switch (`tenant_network`). Migration `0014`.
   - Open: nothing calls `purgeDeletedTenants()` on a schedule, and it does not drop a
     tenant's database; hooks for the creation steps (the CMS seeds settings, a theme and
     plugins) come with step 6.
3. Dashboard account features the CMS has. In parts:
   - **Done:** invitations (`createUser({ invite: true })` emails a seven-day link to set the
     password; `canInvite`, `sendInvitation`), and recovery mode (`RECOVERY_CODE`,
     `POST /auth/recovery`, `recoverAccount`: a one-hour reset link, optionally without the
     account's second factors).
   - **Done:** self-service tenant registration: a network administrator turns it on, and a
     signed-in main account makes up to three tenants a day (`registerTenant`, the "Your
     tenants" screen).
   - Moved to step 5, where the CMS's own code decides them: avatar uploads (the CMS stores
     pictures in its media library, so the upload stays a hook the CMS fills) and held
     accounts (in the CMS a network account made by a site's registration waits "held"; with
     a tenant's own accounts a registration on a tenant's host makes such an account instead).
   - No command wraps the recovery request yet.
The CMS's side (user, 2026-11-22: "use a port"). The CMS library drops its account stores
and takes users through `PeoplePort` (`packages/cms/src/server/people.ts`), which the
application fills from the dashboard's services. Slugs and field values stay CMS documents.

As built: `cms.users` is still the API the application calls (`getMany`, `get`, `roles`, ...),
but `CmsUsers` (`packages/cms/src/server/users.ts`) no longer stores accounts. It is a facade
that reads people, roles and sign-in state from `PeoplePort` and adds only the CMS's own data
(`cms_authors` slugs, `cms/user_fields` values). The inventory below is the pre-change state.

What the rest of the CMS calls on the stores today (inventory of 2026-11-22):

- Library: `users.get/roles/role/resolve/principal/findByEmail/list/create/update/setSystemMeta/
  defineRole/addMember/setRoles`, `accounts.count/existing/join/leave/get`, `security.attempt/
  release` (forms), `apiTokens.verify`, the session store handed to `server/auth.ts`, and raw
  RomeQL on the account tables in `site-import.ts`.
- Application, outside the six files that are replaced: `users.getMany` (20 places), `get`
  (15), `roles`, `list`, `authors`, `count`, `bySlug`, `withSlugs`, `usingFile`,
  `setSystemMeta`; ten network screens; `CmsNetwork` for the host of each site and for what
  is not about accounts (plugin and theme policy, network settings, export requests, updates).
- Tests: 17 files test the stores directly, 9 use users as fixtures, 66 do not touch them.

4. **Done:** the port and its in-memory version (`memoryPeople`), with tests. Nothing uses it yet.
5. `CmsUsers` over the port. In parts:
   - **Done:** `createCMS({ people })` makes `host.users` a `PeopleUsers`
     (`src/server/people-users.ts`): who a user is and their roles come from the port; the
     author slug (`cms_authors`, host step 16) and the field values are the CMS's. What is
     about accounts and sign-in is refused there (`CMS_UNAVAILABLE`). Without `people` the
     present store is used, so every suite stays as it was. Test: `tests/people-users.test.ts`.
   - **Done:** the nine test files that only need users as fixtures run on `memoryPeople`
     (automations, capabilities, field groups, form files, forms, seed, site search,
     isolation, round trips). With a port, `tokenPrincipal` answers null (application
     passwords are the application's) and an automation's `$user` is the member.
   - Stays the CMS's: the counters of forms and comments (`security.attempt` on
     `cms_attempts`), which step 8 moves out of `security.ts`.
6. **Done:** the application signs people in with the dashboard's code.
   - A CMS project has the `database` feature on RomeDB (the CMS's own instance) with the
     account models and migrations; `@cossackframework/cms` depends on
     `@cossackframework/database` and lists the models in `cossack.host`.
   - The CMS app's `auth.ts`, `services/users.ts`, `services/roles.ts` and its verify, sign-in
     link and site registration pages are gone; the dashboard's come in with the shell.
   - CMS-owned, on the dashboard's user shape: `auth-options.ts` (registration and two-step
     sign-in from Settings → General, as getters over the request's settings), `mail.ts`,
     `avatars.ts`, `auth-events.ts` (the dashboard's replaceable modules), `lib/permissions.ts`,
     `services/rbac.ts`, `cms/people.ts` (the port over the ORM models), `cms/actor.ts`.
   - Roles: the ID is the handle (`admin`, `editor`; a role made on the Roles screen gets one
     from its name) and the name is what people read. The dashboard finds the admin role by
     its ID. New accounts get the default role.
   - `cms/middleware.ts` builds the principal from the dashboard's user and verifies
     `Bearer cms_…` through the dashboard.
   - A site's database file leaves out the account tables that hold secrets.
   - **Red until step 7:** added sites. `generated-runtime-cms` fails in its browser case (the
     network's users screen) and its Workers development case (adding a site);
     `generated-runtime-cms-cli` fails at `sites create`. Everything single-site passes.
   - **Thinner coverage:** eight test files of the old `auth.ts` were deleted (account flows,
     network account takeover, OAuth sign-in, passkey sign-in policy, second factor changes and
     gate, site registration, user management). The dashboard's code has
     `scaffold/tests/auth-security.test.js` and `generated-runtime-account-security`, which do
     not cover: email links built from the site's address and never the request's Host, a
     per-account count of wrong current passwords, OAuth's refusal to claim an existing email,
     and the passkey-only policy. Step 8 rebuilds these.
   - **Different from before:** with two-step sign-in required and no role named, every
     account is asked, not only the people who can use the dashboard. The CMS's recovery
     endpoint, its maintenance purges and the dashboard home's "recent sessions" still read
     the old stores.
7. **Done:** sites are tenants.
   - Library: `CmsNetwork` takes its site registry (`sites: SitesStore`), a way to run work on
     a site's users in that site's database (`inSite`) and the sites of an account
     (`memberSites`); `databaseOf(id)` gives a site's database. `PeoplePort` gained `join`,
     `ownCount` and `adopt`; `PeopleUsers` adds members and pages through every user.
   - App: `cms/sites.ts` (a site is a tenant whose ID and slug are the site's ID; domains and
     members in the tenant tables; the creation step a network setting), `cms/network-accounts.ts`
     (the network's accounts are the main database's users), `cms/site-registration.ts`.
     `cms/middleware.ts` runs an added site's request in the site's database and uses the
     dashboard's shared sign-in; `cms/handoff.ts` is gone. A CMS project's `tenantORM` opens a
     site's ORM on the database the CMS opened for it.
   - The dashboard took from the CMS: the automatic visit to the main host starts from a
     dashboard page; with shared sign-in a tenant's sign-in serves its own accounts only;
     members with a main account are marked and locked; their passkeys are the main host's;
     an account moves between a tenant and the main database (`moveAccount`).
   - Export skips the account tables that hold secrets, the tenant tables and the ORM's own
     record, and leaves out password hashes; an import makes the imported users members
     (accounts the network has) or accounts of the site.
   - Different from before: moving an account keeps its password and authenticator app and
     drops its passkeys and application passwords. Registering a site with a new email, where
     the network sends email, asks for an account first.
   - Every unit and runtime suite passes, the multisite cases included.
   - Still on the old stores, for step 8: `cms/recovery.ts`, the purges of `cms/maintenance.ts`,
     the dashboard home's recent sessions, the CMS's own Registrations screen.
8. **Done:** the old stores are removed.
   - Library: `accounts.ts`, `security.ts`, `api-tokens.ts`, `handoffs.ts`, `auth.ts`
     (`createCmsAuth`) and the session stores are gone, and so are `host.accounts`,
     `authSessions`, `sessions`, `oauthStates`, `apiTokens`, `security`, `tokenPrincipal` and
     `network.handoffs`, `endSessions`, `deleteAccount`. `CmsUsers` is the store over the
     port (it checks avatar URLs itself); `createCMS` without `people` uses `memoryPeople()`.
     `sites.ts` keeps the `SitesStore` interface and `memorySites()`; `CmsNetwork` needs
     `sites`. Attempt counts are `host.attempts` (`attempts.ts`, table `cms_attempts`).
   - Schema: host step 17 drops the 19 tables (`cms_users`, `cms_roles`, `cms_user_roles`,
     `cms_accounts`, the session, token, security, passkey, challenge and reset tables,
     `cms_sites`, `cms_site_domains`, `cms_handoffs`, `cms_session_sites`, `cms_memberships`,
     `cms_registrations`). No converter: an install from before signs up again.
   - App: recovery makes its reset link with the dashboard's `recoverAccount`
     (`CMS_RECOVERY_CODE`), the dashboard home reads `recentSignIns`, Registrations reads the
     dashboard's, maintenance purges `host.attempts` only.
   - Tests: six library test files of the removed stores are deleted, the rest run on
     `memoryPeople`, `memorySites` and `networkPeople()` (`tests/helpers.ts`).
     `scaffold/tests/auth-security.test.js` gained the per-account count of wrong current
     passwords, the refusal of a password alone when the second step is a passkey, and email
     links from `APP_URL`. OAuth's refusal to claim an existing email was covered already.
   - `generated-runtime-cms-access` passes again: its table skips the sign-out of the site
     registration page (it signed every test user out) and has rows for recovery, the
     sign-in endpoints between hosts and development mail. It found two server methods that
     answered 500 without arguments (`deleteToken`, a role's `create`); the services now
     refuse a missing token ID, passkey ID and role name.
   - Docs: `docs/cms/multisite.md`, three guides of `packages/cms/agent-docs.json`.

## Left

- `pnpm test:cms:packed`, `pnpm test:databases` and `pnpm test:desktop` pass (2026-11-23). The
  packed run found six shell files the CMS package did not ship (`app/.npmignore`).
- Not run: the Workers variants of the dashboard's tenants, PostgreSQL, MySQL and Turso tenants.
- Nothing purges deleted tenants of a plain dashboard project on a schedule or drops their
  databases; no command migrates every tenant; the dashboard's `security.purgeExpired()` is
  not scheduled.
- A tenant's own accounts have no passkey or OAuth sign-in.
- The last-administrator check reads, then writes.
- Media "in use" no longer counts a user's avatar: `cms.users.usingFile` reads profile
  fields only.
- Without the application, an import does not carry users (`PeoplePort.adopt` is the
  application's); the CMS app's adoption is covered by the runtime suite only.
