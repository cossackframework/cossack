# The CMS on the dashboard's accounts and tenants

Status: decided 2026-11-22 (below); steps 1 and 2 built. Steps are committed one by one. It replaces "step 6" of `specs/romedb-orm.md`,
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
   - Open: avatar uploads through a storage hook; accounts held for a tenant's approval;
     self-service tenant registration. No command wraps the recovery request yet.
4. CMS: sessions, second factors and tokens on the dashboard's stores (what was built and
   reverted, now with tenants).
5. CMS: accounts, members and roles; `Principal` from the dashboard's user; slugs and field
   values stay CMS documents beside the member row.
6. CMS: sites on tenants; site export and import; the network screens.
7. Remove the CMS's own stores, tables and host steps. Docs.

Done when the CMS unit suite, the CMS runtime suites and `pnpm test:cms:packed` pass.
