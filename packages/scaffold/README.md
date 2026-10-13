# @cossackframework/scaffold

Node-only recipe engine consumed by the `cossack` CLI.

It owns the application templates, preset and feature registries, dependency
resolution, dashboard modules, conflict-safe change sets, and schema-v3
scaffold manifests.

Versions for third-party packages written to generated applications are
configured in `package.json` under `scaffold.dependencyVersions`. Workspace
Cossack packages use the scaffold package's own version.

Schema-v3 manifests also record `dependencyBaseline`, grouped by package
dependency section. These are the recipe-owned values before user edits, not
the full merged application package. Creation, feature composition, removal,
and adapter switching maintain this baseline. Existing user dependencies are
not adopted merely because they match a recipe value. Upgrade planning compares
the baseline, the current package, and the requested release. It preserves
local pins and deletions while updating unchanged owned entries.
For older manifests without dependency ownership, composition can reconstruct
the baseline locally only when the recorded template version matches this
scaffold package. Otherwise run `cossack upgrade` first so it can load the
recorded release and establish the baseline.

Node recipes generate a gitignored `.env` with safe local defaults and random
application/OAuth secrets, plus a tracked `.env.example` containing documented
placeholder values. Their generated pnpm configuration allows the trusted
native build dependencies used by SQLite and Vite.

The `desktop` feature is an independent Electron side target for every web
adapter. It generates the main-process entry, Forge configuration, native icon
set, host package scripts, and pnpm configuration required by Forge. Adding or
removing the feature owns those files without changing the selected web runtime.

```js
import {
  createApp,
  addFeature,
  removeFeatureFromProject,
  switchAdapter,
} from '@cossackframework/scaffold';

const project = await createApp('my-app', {
  adapter: 'cloudflare',
  preset: 'minimal',
  interactive: false,
});

await addFeature(project.projectDir, 'dashboard', {
  features: ['users', 'sessions'],
  interactive: false,
});

await removeFeatureFromProject(project.projectDir, 'database', {
  interactive: false,
});

await switchAdapter(project.projectDir, 'node', {
  database: 'sqlite',
  interactive: false,
});

await addFeature(project.projectDir, 'desktop', { interactive: false });
```

`switchAdapter()` requires a schema-v3 scaffold manifest and re-renders the
recorded recipe for the target runtime. It returns a conflict-safe change set
for confirmation or dry-run use. Local `.env` and `.dev.vars` files are merged
without becoming scaffold-owned, and the source environment file is retained.
Database configuration can change, but database contents are never migrated.

## Testing the workspace CLI end to end

A generated project normally installs the latest published packages. The local
smoke test builds and packs every workspace package. It forces direct and
transitive Cossack dependencies to those tarballs. It installs a generated Node
Full Stack app offline, runs migrations, and runs its production SSG build:

```sh
pnpm run test:scaffold:local
```

Retain the generated app for inspection when you diagnose a failure:

```sh
COSSACK_KEEP_SMOKE=1 pnpm run test:scaffold:local
```

`recipeCapabilityRequirements(recipe, target)` returns serializable selected
requirements for `web` (the default) or `desktop`. Generated Vite configurations
include these declarations, and CLI inspection exposes them without reading
secret values. SQLite contributes a filesystem requirement only when database
support is selected. Desktop contributes one only to its side target. Source
locations point to `.cossack/scaffold.json`, where the recipe selection is
recorded. D1 declares the native `DB` binding. Hyperdrive providers declare
`HYPERDRIVE`. These requirements apply to both targets because the generated
database code is shared. Creation and composition reject either provider with
Desktop during planning, before writing application files. Builds also enforce
these requirements. Select a portable provider, or provide a separate
target-specific database setup.
Page transports and durable-state requirements remain discovered from page code.
The pure `@cossackframework/core/runtime-capabilities` checker evaluates
availability, and the framework re-exports the same model. This registry does
not copy runtime capability profiles or depend on framework.
`recipeCapabilityDiagnostics(recipe)` reports host support for selected
targets. Binding configuration remains a build/deploy check.
Recorded unsupported recipes remain inspectable with source-bearing diagnostics.
Requirements for other features must be added as
those features acquire runtime dependencies.

Generated Cloudflare projects disable the Workers Vite plugin in Desktop mode.
The web build still uses that plugin. The Desktop build uses Electron's runtime
boundary and evaluates its own selected capability requirements.

## Read-only resource recipe

Run `cossack add resource` to add `/resource` to an existing app, or select
`--features=resource` during creation. The recipe uses `server$`, explicit
category dependencies, and `resourceStatus$` for loading, stale data, errors,
and empty results. Refresh and retry use `refresh$`. Client handlers use
`@Client`.

The sample catalog is public and read-only. Replace its server loader with an
application service or a database read when needed. Database support is not
added implicitly. Keep authorization inside the server loader for private data.
Composition records ownership, supports repeated application, and preserves
edited pages. The recipe declares HTTP transport capability for every selected
target.

## Validated mutation recipe

Run `cossack add mutation` to add `/mutation`, or select `--features=mutation`
during creation. This HTTP recipe uses a typed `storeRules` map for built-in
client form validation and a separate private `input.object()` schema in
`@Server({ input })` for server validation. Declare accepted keys explicitly
and normalize browser form values before calling a method whose parameter is
`InputOf<typeof schema>`.
`RawInputOf` describes incoming boundary values, not a widened method signature.
Public function-field actions receive the same schema parameter checks.
Client-only
form state is sent as an explicit argument snapshot. The handler displays field
errors, disables the form while submitting, keeps input after failure, and clears
it after success. It uses framework RPC proxies. No manual fetch is needed.

The public demonstration returns an acknowledgment. It does not persist data or
send email. To perform a real write, add authorization and call an application
service or selected database inside the server method. Use the auth package's
resource policy with `@Server({ input, authorize: policy.action('edit', lookup) })`
to enforce record ownership after parsing and before invocation. Native API or
loader calls explicitly authorize their resource. Component state and client
input are not a trusted database. The recipe adds no database or UI dependency,
declares HTTP capability, and preserves edited pages during repeat composition.

Generated production browser acceptance runs in the CLI package with Playwright.
Install its Chromium browser with `pnpm --filter cossack exec playwright install chromium`
before running `pnpm --filter cossack exec vitest run tests/generated-runtime-`
(the `generated-runtime-*.test.js` files: production, auth, recipes and development).

## Layout-scoped service recipe

Run `cossack add scoped-service` to add `/scoped-service` and its sibling page.
The layout declares `ScopedCounterService` in `@Page({ services })`. Its pages
and a nested component use `@Inject` to receive that layout's instance. A
`@Server` method updates public state through the service RPC proxy. `@Shared`
formats it on both sides. Pending, failure, and retry behavior use client state.

The browser keeps the same service while navigating between sibling pages.
Leaving the layout disposes it. Returning or reloading creates fresh state.
HTTP RPC reconstructs request scopes and receives public service state from the
browser. This counter is a demonstration, not durable storage or a trusted quota.
Use server storage and authorization for authoritative records. The recipe
declares HTTP capability and adds no database or UI dependency. Repeat
composition preserves edited layout, pages, and service files.

## Protected route recipe

Generated login, register and reset forms keep drafts in `ClientStore`, validate
locally and send one explicit object to a typed server action. App-owned
`src/auth-input.ts` contracts validate inbound RPC and native calls. Credentials
stay outside shared form state. Fixed failure messages retain the browser draft.
Session creation must succeed before the page sets a cookie and redirects.

The sessions dashboard adds rotation and guarded logout. Rotation replaces the
token and redirects before listing with the new cookie. Storage errors do not
clear an existing cookie. Account writes, token consumption and HTTP delivery
are separate steps. Failed responses can follow partial writes. Read the
[auth flow and failure guidance](../../docs/authentication.md) before changing
these generated application files. Upgrade planning preserves edited files.
Updating a package dependency alone does not update the pages.

Run `cossack add protected-route` to add `/protected-route` and its details page.
This selects the existing `auth`, `database`, and `ui` features. Choose a database
supported by the web runtime, install dependencies, and run `cossack migration up`
before signing in through `/auth/login`. Credentials registration is available at
`/auth/register` when credentials authentication is selected.

Global auth middleware resolves the session. The protected layout's
`createAuthorizer().requireUser` middleware requires that identity before page
rendering or RPC. Anonymous page requests redirect to the configured login route.
RPC receives a coded 401 error. Server methods read `this.user` from the request,
never an identity from component state. The example handles expired sessions and
provides a sign-in link. Auth-only apps register only their selected entity models.
RBAC relations and models are included only with the users or roles modules.

New apps default the login destination to `/protected-route` unless dashboard is
also selected. Composition preserves existing environment values and local edits,
so set `AUTH_REDIRECT_AFTER_LOGIN` yourself when adding this to an existing app.
The guard requires a session. Application-specific permissions still belong in
server authorization policies. Repeat composition preserves both pages, the layout,
and middleware. Generated production acceptance uses real database migrations,
sessions, login UI, nested navigation, forged client state, and session expiry.

## Background jobs and Turnstile

`cossack add jobs` composes a Cloudflare Queue consumer and producer with an
independent D1 job ledger and receipt migration. Apply the local `JOB_STATE`
migration before consuming jobs. Select real remote resource IDs before
deploying. Keep `JOB_NAMESPACE` distinct for environments sharing a ledger.
Dispatch from authorized server code with explicit tenant/actor scope and a
stable logical idempotency key. The portable local adapter is deterministic test
infrastructure, not durable background execution. See [jobs guidance](../../docs/jobs.md).

`cossack add turnstile` adds UI and the focused auth verifier without adding
full authentication or the ORM. Set the public `TURNSTILE_SITE_KEY` and expected
`TURNSTILE_HOSTNAME`, then provide `TURNSTILE_SECRET_KEY` privately through
`.dev.vars` on Cloudflare or `.env` on Node. Use Cloudflare test keys for
local development. The generated contact page publishes only the site key in
hydrated state and validates the token on the server before the protected
operation. Replace its acceptance placeholder with your authorized mutation.
Reset the widget after each verification attempt. Expired and reused tokens
require a fresh challenge. See the [server guide](../auth/docs/turnstile.md) and
[widget guide](../ui/docs/turnstile.md).

## Schedules and notifications

`cossack add schedules` composes jobs, `src/schedules.json`, a native Cloudflare
scheduled handler, Cron configuration and static Vite validation. Update JSON and
selected environment Cron declarations together. `cossack inspect schedules`
lists names without exposing payloads. `runOnce` uses the same jobs validation
and cleanup as provider events. Repeated occurrence keys deduplicate. Separate
occurrences can overlap. No framework catch-up or autonomous local scheduler is
provided. See [schedule policy](../../docs/schedules.md).

`cossack add notifications` composes jobs, typed escaped templates, a D1 delivery
ledger, scoped opt-in preferences and the EMAIL binding. Apply both generated job
and notification migrations to JOB_STATE. Preferences default to disabled. Grant
an exact tenant/user/template/channel before enqueue. Resolve recipients from
trusted server context. Configure MAIL_FROM and onboard the email domain before
sending. Previews never call the email provider. Provider acceptance and actual
delivery remain separate. Uncertain sends require deliberate reconciliation.
Repeated additions preserve authored templates and migrations. These generated
recipes require Cloudflare. Portable contracts and an explicit SMTP adapter are
available for other runtimes. See [notifications](../../docs/notifications.md)
and [provider setup](../../docs/notification-providers.md).
