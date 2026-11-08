---
title: 'CMS Plugins'
description: 'Package, render, activate and upgrade a CMS plugin, and the rules its source must follow.'
---

# CMS Plugins

A plugin is an npm package with a JSON manifest and a source tree. `cossack add plugin`
renders the source into `src/plugins/<name>/` as ordinary application code. Nothing in
the package executes during installation: the CLI reads it as data, npm installs run with
`--ignore-scripts`, and tarballs are unpacked in memory.

Once rendered, the plugin is part of the build. Its pages route like `src/pages`, its
translations and configuration join the application's under a namespace, its `server.ts`
registers hooks and commands with the CMS host, and its `ui.ts` fills dashboard slots and
renders its blocks. At runtime it does nothing until its schema is migrated and an
administrator grants what its manifest asks for.

## The package

```
support-desk/
├── package.json
├── cossack-plugin.json
└── plugin/
    ├── server.ts
    ├── ui.ts
    ├── pages/dashboard/support/index.ts
    ├── components/DeskBadge.ts
    ├── lang/en.json
    ├── config/desk.ts
    ├── middlewares.ts
    ├── templates/        (themes)
    └── assets/           (logo, cover, stylesheets, fonts)
```

`package.json` points at the manifest and ships both:

```json
{
  "name": "@acme/support-desk",
  "version": "1.0.0",
  "type": "module",
  "cossack": { "plugin": "cossack-plugin.json" },
  "files": ["plugin", "cossack-plugin.json"]
}
```

- `cossack.plugin` names the manifest; `cossack-plugin.json` is the default. The manifest's
  `version` must equal the package version.
- The source directory is `plugin/` unless the manifest's `source` field names another
  relative directory. It holds at most 2,000 files, 1 MiB each and 16 MiB in total, with no
  symbolic links or special files. The manifest is at most 256 KiB.
- The plugin `name` is 1 to 64 lowercase letters, digits and single hyphens. `cms`,
  `cossack`, `core`, `framework` and `app` are reserved.

Every manifest field is described in [Plugin manifest](/docs/cms/manifest.md). A minimal one:

```json
{
  "schemaVersion": 1,
  "name": "support-desk",
  "version": "1.0.0",
  "description": "Support tickets",
  "compatibility": { "@cossackframework/cms": ">=0.9.0" }
}
```

Pack it with `npm pack` and render it:

```bash
cossack add plugin ./support-desk-1.0.0.tgz
```

`cossack add plugin` also takes a directory or an npm package name. It writes
`src/plugins/support-desk/` with the source tree, a rendered `plugin.json` (the manifest
plus `package`, the npm package it came from) and records every file's hash in
`.cossack/plugins.json`.

## Files in a plugin

Every file is optional. Each one has a fixed role.

### `server.ts`

Exports `register(context)`. The host calls it once at startup, after it has validated
every manifest and built every extension point. The context is limited to what the
manifest declares.

```ts
import { beforeWrite } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

export function register(context: PluginContext) {
  context.hooks.addFilter(beforeWrite, (draft, { input }) =>
    input.resource === 'support-desk/tickets' && typeof draft.subject === 'string'
      ? { ...draft, subject: draft.subject.trim() }
      : draft);

  context.commands.add('close-all', async (input, { principal }) => {
    const tickets = context.cms.resource('support-desk/tickets');
    const page = await tickets.list({ where: { status: 'open' }, limit: 100 }, { principal });
    for (const ticket of page.records) {
      await tickets.update(ticket.id, { status: 'closed' }, { principal, expectedRevision: ticket.rev });
    }
    return { closed: page.records.length, reason: input.reason ?? null };
  });
}
```

The `PluginContext` holds:

| Member | What it is |
| --- | --- |
| `name`, `version` | From the manifest. |
| `resources` | The IDs of the resources the plugin declares, such as `support-desk/tickets`. |
| `hooks.addAction(point, handler, { priority })` | Handle an action the manifest lists in `hooks`. |
| `hooks.addFilter(point, handler, { priority })` | Handle a filter the manifest lists in `hooks`. |
| `hooks.point(name, kind)` | A point by name: one the manifest lists in `hooks` or `provides`. |
| `hooks.doAction(point, payload)`, `hooks.applyFilters(point, value, input)` | Run the handlers of a point the plugin `provides`. |
| `commands.add(name, handler)` | Handle a command the manifest declares. |
| `settings.get(name)`, `settings.all()` | Read the active plugin's declared settings, with defaults, as detached values. |
| `cms.resource(id)` | A repository (`get`, `list`, `search`, `create`, `update`, `delete`) for the plugin's own resources and the ones it is granted. |
| `fetch` | `fetch` limited to the hosts in `permissions.network`. |
| `files`, `mail`, `jobs`, `users`, `cache`, `secrets`, `ai`, `payments` | The [capabilities](#capabilities) the manifest's `permissions` ask for. |

A theme's `server.ts` exports `loaders` instead of, or beside, `register`; see
[Themes](/docs/cms/themes.md#loaders).

#### Capabilities

Beyond its data, a plugin asks for what it needs in the manifest's `permissions` (see
[the manifest](/docs/cms/manifest.md#permissions)); each becomes a grant the administrator
gives with the rest. Every context carries every member, and each call checks the grant:
`CMS_FORBIDDEN` when it is not held, `CMS_UNAVAILABLE` while the plugin is inactive or the site
lacks the service (no file storage, no mail sender).

```ts
export function register(context: PluginContext) {
  // Jobs: name handlers here; queue them from hooks, commands or pages.
  context.jobs.handle('notify', async (payload: { ticket: string }, { principal }) => {
    const ticket = await context.cms.resource('support-desk/tickets').get(payload.ticket, { principal });
    const owner = ticket && await context.users.get(String(ticket.owner));
    if (owner) await context.mail.send({ to: owner.email, subject: 'Your ticket was updated', text: `See ${ticket.subject}.` });
  });
  // The manifest's schedule "digest" runs this handler at its cron times.
  context.jobs.handle('digest', async (_payload, { scheduledAt }) => {
    const open = await context.cache.remember('open-count', 60_000, () => countOpen(context));
    const report = await context.files.upload({ name: `digest-${scheduledAt}.txt`, contentType: 'text/plain', body: `${open} open tickets` });
    console.log(context.files.url(report));
  });
  context.hooks.addAction(afterCommit, async event => {
    if (event.resource === 'support-desk/tickets') await context.jobs.enqueue('notify', { ticket: event.recordId }, { key: `${event.recordId}:${event.revision}`, delayMs: 60_000 });
  });
}
```

| Member | What it does |
| --- | --- |
| `files.upload({ name, contentType, body, size?, title?, alt? })`, `get`, `open`, `list`, `update`, `delete`, `url(file)` | Files in the media library owned by `plugin:<name>`, shown there like any upload. `body` is a stream (with `size`), bytes or a string. The plugin changes and deletes its own files and reads any. |
| `mail.send({ to, subject, text, replyTo? })` | One plain-text email from the site's sender (`MAIL_FROM`); one recipient, a subject up to 200 characters, text up to 100 KB. |
| `jobs.handle(name, handler)` | Names a handler at `register()`. The handler gets the payload and `{ principal, scheduledAt, signal }`; `principal` is the system principal `plugin:<name>`, so repositories accept it. A thrown error retries the job with the outbox's backoff, up to ten attempts. |
| `jobs.enqueue(name, payload?, { at?, delayMs?, key? })` | Queues a job for now, for a time or after a delay (within a year), as an outbox row; JSON payloads up to 64 KB. A `key` queues once: the same key again returns false. |
| `users.get(id)`, `findByEmail`, `list({ search, role, limit, offset })` | Members as the plugin sees them: id, email, name, slug, avatar, status, roles, and the plugin's own `meta`. |
| `users.create({ email, name, password?, roles? })`, `setMeta(id, value)` | A new member with assignable roles only: roles whose every permission is the plugin's own (`<plugin>:<name>` or `<plugin>/<resource>:<action>`), or none, such as `subscriber`; a JSON value kept with the member under the plugin's key, null removes it. |
| `cache.get`, `set(key, value, ttlMs?)`, `delete`, `remember(key, ttlMs, compute)` | The site's cache under `plugin:<name>:`; keys up to 150 characters. |
| `secrets.get(name)` | A binding named in `permissions.secrets`, or undefined when the application has none; the name is a string literal the policy lint checks. |
| `ai.complete({ system?, prompt, maxTokens? })` | The application's model answers; `CMS_UNAVAILABLE` when it has none (`ANTHROPIC_API_KEY`, or a Workers AI binding `AI`). Prompts are capped at 60,000 characters and answers at 4,000 tokens. |
| `payments.checkout({ amount, currency, description } or { priceId }, successUrl, cancelUrl, customerEmail?, reference?, metadata? })`, `payments.provider` | A checkout with the application's provider (`STRIPE_SECRET_KEY`); the buyer goes to `url`. The result comes back as a `cms.payment.event` action with the `reference`, delivered from the outbox. |

Realtime needs no capability: a plugin's own realtime component
(`@Component({ transport: 'durable-object' })` in its `components/` or `pages/`) runs as the
CMS's own co-editing room does, because plugin files are application source. Cron triggers of
the application stay the application's; a plugin's clock is `schedules`.

Declare a `settings` object in the manifest to receive a generated form under Settings →
Plugins. Its fields use the scalar kinds `string`, `text`, `boolean`, `integer`, `number`,
and `enum`. String fields can use `control: "color"` for a color picker or `control: "file"`
for a URL input with media selection and upload. Both controls store strings and support
the same JSON editor and validation as other settings. Optional sections organize the
form without changing stored keys. The host
owns the namespace `plugin:<name>` and requires `cms:settings` to view or edit its values.
See [Plugin settings](/docs/cms/settings.md#plugin-settings) for a declaration and the
JSON import/export rules.

Read `context.settings` inside active handlers. It cannot write values or read another
plugin's settings. Administrators can configure disabled plugins before activation, and
disabling a plugin retains its values. Invalid and absent plugins expose no editable
settings. Theme options stay under Appearance → Customize.

Handlers registered here do nothing while the plugin is inactive: a filter returns its
value unchanged and an action returns at once.

#### Unrestricted access

Most plugins fit inside the context above. A migration tool, a custom report or a deep
integration may not, so a plugin can ask for everything with
`"permissions": { "unrestricted": true }`:

```ts
context.commands.add('report', async () => {
  const { db, host, env } = await context.unrestricted();
  const result = await db.read([{ rql: 'SELECT count(*) FROM cms_audit' }]);
  return Number(result.results[0].rows[0][0]);
});
```

| Member | What it is |
| --- | --- |
| `db` | The site's database with no access rules. `read` and `write` take RomeQL statements. |
| `host` | The whole CMS host: repositories, accounts, settings, files and the outbox. |
| `env` | Every binding of the application, including what reaches other sites' databases. |

The call refuses until the plugin is active and granted. The grant also lifts the limits of the
other members: `context.fetch` reaches any host, `context.secrets` reads any string binding,
`context.cms.resource()` takes any resource, handlers may use any extension point, and
`schedules` need no `permissions.jobs`. The policy lints step aside, so the plugin's source may
import `@cossackframework/cms/server`, use global `fetch` and read `process.env`.

Asking for this is the point where the plugin stops being limited, so it is hard to miss:

- **Installing warns.** A plugin's code can run as soon as the application starts, before
  anyone grants it. `cossack add plugin` and `cossack plugins upgrade` print a danger message
  and stop until it is accepted: a prompt that defaults to no in a terminal, or
  `--allow-unrestricted` anywhere else. `--yes` and `--force` do not count. The scaffold API takes
  `allowUnrestricted: true`.
- **Granting warns again.** Plugins and Network → Plugins show a danger notice with a box to tick
  beside the button. Bulk actions never grant it, and new sites' default plugins skip it.
- **Only a network admin grants it**, since `env` reaches every site.
- **The grant leaves a trail.** Tools → Activity shows who approved it, the plugin's row keeps an
  Unrestricted badge, and every build warns with `COSSACK_PLUGIN_UNRESTRICTED`.
- **It does not travel.** A site import removes the grant, so the plugin waits for a new one.

Disabling the plugin stops its handlers, its commands and `context.unrestricted()`. Code it
runs on its own at startup keeps running until you remove the plugin with
`cossack plugins remove`.

### `ui.ts`

Exports components the host renders. It is imported in every environment, so it holds
no server code.

```ts
import { Component, Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Component()
export class SupportWidget extends Cossack {
  render() {
    return html`<div class="rounded-lg border border-border p-4">Support desk is active</div>`;
  }
}

@Component()
export class SupportContact extends Cossack {
  declare props: { block: { data: { email?: string } } };
  render() {
    return html`<p>Write to ${this.props.block.data.email ?? ''}</p>`;
  }
}

/** Components for dashboard slots. */
export const slots = { 'dashboard.overview': [SupportWidget] };

/** Renderers for the manifest's blocks, by the part of the name after the slash. */
export const blocks = { contact: SupportContact };

/** A theme's templates can also live here, as `theme`; see Themes. */
```

- `slots['dashboard.overview']` lists components the dashboard's overview page renders,
  with no props, while the plugin is active. Navigation links come from the manifest's
  `ui.slots['dashboard.nav']`, not from code.
- `blocks` maps each block the manifest declares (`support-desk/contact`) to a component,
  keyed by `contact` or by the full name. The site renders it with the props `block`
  (the `RenderedBlock`: `id`, `type`, `data`, `children`) and `helpers` (the theme
  helpers). A block type is offered in the editor only while its plugin is active.
- `head` (a `PluginHead`) adds tags to the document head of every site page while the plugin
  is active, under the theme's and the page's own: `(site, helpers, plugin) => HeadValue`, where
  `plugin.asset(path)` is the URL of a file in the plugin's `assets/`, such as a stylesheet its
  blocks need. A page's meta of the same name wins.

### `pages/`

Pages, layouts and loading skeletons overlay `src/pages`: `pages/dashboard/support/index.ts`
serves `/dashboard/support`, inside the dashboard layout, with its middleware and error
handling. A path the application also defines fails the build with
`COSSACK_PLUGIN_ROUTE_CONFLICT`. Markdown pages work once the application has the
`markdown` feature.

A functional handler module is an HTTP endpoint at any path: `pages/webhooks/support/index.ts`
exporting `POST` serves `/webhooks/support`, and `pages/api/support/tickets.ts` serves
`/api/support/tickets`. See [API routes](../api-routes.md).

A plugin's pages, layouts and handlers answer only while the plugin is active. The CMS passes
`isPluginActive` to `createApp`, and the framework answers a request for an inactive plugin's
route, including RPC, SSE and WebSocket requests addressed to its components, exactly like an
unknown URL: a JSON 404 under `/api`, otherwise the nearest 404 boundary that is not the
plugin's own. None of the plugin's guards or handlers run.

A dashboard page reads the plugin's data through the host on the request, as the
signed-in user:

```ts
import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class SupportDesk extends Cossack {
  @State() open = 0;

  async init() {
    const tickets = this.c.get('cms').pluginCms('support-desk').resource('support-desk/tickets');
    const page = await tickets.list({ where: { status: 'open' }, limit: 100 }, { principal: this.c.get('principal') });
    this.open = page.records.length;
  }

  render() {
    return html`<h1>Support</h1><p>Open tickets: ${this.open}</p>`;
  }
}
```

`pluginCms(name)` gives the same repositories as `context.cms` in `server.ts`: the plugin's
own resources and the granted ones, every call authorized for the principal passed in.

### `components/`

Components the plugin's pages import by relative path. They are ordinary components.

### `lang/<locale>.json`

Translations, joined to the application's catalog under the plugin's namespace:
`lang/en.json` with `{ "title": "Support desk" }` is read as `__('support-desk::title')`.

### `translations/`

A language pack's catalogs: `translations/<locale>.json` translates the application's text,
and `translations/<locale>/<plugin>.json` another plugin's. Packs add their locales. See
[Languages](/docs/cms/languages.md#language-packs).

### `config/<file>.ts`

Configuration factories like `src/config/*.ts`, joined as `<plugin>::<file>`:
`config/desk.ts` exporting `() => ({ greeting: 'Hello' })` is read as
`config('support-desk::desk.greeting')`. Run `cossack config --generate` after adding one,
so the typed config registry knows the key. Plugins read configuration this way, never
`process.env`.

### `middlewares.ts`

Default-exports an array of Hono middleware. They run after the application's own, on
every request.

### `templates/` and `assets/`

`templates/*.ts` are a theme's site templates. `assets/` holds the plugin's logo and cover
(`assets/logo.*`, `assets/cover.*`, or the files the manifest names) and a theme's
stylesheets and fonts, served as build assets and reachable through `helpers.asset()`.

## Lifecycle

```
render → build → migrate → grant → active
```

1. **Render.** `cossack add plugin` validates the manifest's structure and writes the files.
2. **Build.** The plugin's manifest is validated against the CMS rules
   (`manifestProblems`), its source passes the policy lints, and `vite build` and the type
   check cover it like any other code. A plugin whose manifest is invalid is listed as
   inactive with the reason, and nothing of it runs.
3. **Migrate.** The plugin's `resources` and `collections` are planned and migrated with the
   rest of the schema, from Tools → Schema in the dashboard or `cms.migrate()`. A failed
   step rolls back and leaves the plugin inactive.
4. **Grant.** An administrator opens Plugins in the dashboard and grants what the manifest
   requests: `plugin:enabled` plus every `resource:<id>:<action>` in `permissions.resources`,
   every `network:<host>` and every `hook:<point>`. `cms.grantPlugin(name, principal)` does
   the same from code. A plugin whose manifest only has a `theme` field is "theme only": it
   needs no grant and is managed under Appearance instead. A theme with ordinary plugin
   `settings` follows plugin activation rules for those settings' runtime reads.
5. **Active.** Hooks run, commands run, slots and blocks show, and the plugin's collections
   appear on the site and in the dashboard.

Disabling a plugin removes its grants: its hooks, commands, slots, blocks and collections
stop, and its data stays. An upgrade whose manifest requests more than before leaves the
plugin inactive until it is granted again. `cms.status()` lists every plugin with
`active`, a `reason` when it is not, and the grants still `missing`.

## Where server code runs

A plugin's server code runs in one of three places, and the dashboard's Plugins page says which:

| Tier | Where | What holds it to its manifest |
| --- | --- | --- |
| Isolated | A Worker of its own, on Cloudflare | The runtime: no bindings, no network but `context.fetch`, and only what it is granted. |
| In the application | The application's own Worker or process | The build's policy lints, which honest code passes and other code can evade. |
| Unrestricted | The application | Nothing: it asked for everything, and installing and granting it warn. |

**The plugin's files decide.** A plugin runs isolated when its only code is `server.ts`, with
data beside it: `plugin.json`, `lang/`, `translations/` and `assets/`. A plugin with `ui.ts`,
`pages/`, `components/`, `middlewares.ts`, `config/` or `templates/` runs in the application
as a whole, since those run there at render time and in the browser on the site's own domain.
So does a theme, a plugin with `permissions.unrestricted`, and one added with `--in-app`. A
manifest cannot ask to be isolated.

**On Cloudflare**, isolated plugins run in Dynamic Workers, one per plugin version, shared by
every site of a network. They need the Workers Paid plan and the Worker Loader binding:
`cossack add plugin` adds `"worker_loaders": [{ "binding": "LOADER" }]` to `wrangler.jsonc`
with the first isolated plugin, and a build with an isolated plugin and no binding fails with
`COSSACK_PLUGIN_ISOLATION_BINDING`. Add a plugin with `--in-app` to keep it in the application
instead, for example on the free plan. Without the binding at run time, an isolated plugin
stays inactive with that reason; it never runs in the application instead. **On Node.js**,
every plugin runs in the application, and its status says why.

Writing for isolation changes a few things. The same plugin runs in the application on Node:

- **Everything crosses as a copy.** Payloads, results and errors cross between the plugin's
  Worker and the host as structured clones. An error keeps its `code`. Functions and class
  instances do not cross; `COSSACK_PLUGIN_PAYLOAD` names the call when something cannot.
- **The network is `context.fetch`.** The global `fetch` and sockets throw, and `process.env`
  is empty. Importing a Node.js built-in or a `cloudflare:` module fails the build with
  `COSSACK_PLUGIN_ISOLATED_IMPORT`, naming the file.
- **Act as who you were given.** A repository call must pass the principal its handler received
  (a command's user, a job's principal) or `systemPrincipal('plugin:<name>')`. Any other
  principal is refused with `CMS_FORBIDDEN`.
- **`register()` runs once per site in each Worker**, and again in a fresh one, so keep it free
  of effects beyond registering. The host registers stand-ins from the manifest's `hooks`,
  `commands` and jobs, and calls the plugin's Worker for each. A manifest hook's `priority`
  places the plugin's handlers among other plugins'; the handlers' own priorities order them
  inside its Worker.
- **Each call has limits.** A handler's `signal` aborts at the point's deadline, and the
  bridge refuses calls after it. On Cloudflare a hook may use 50 ms of CPU and 50 subrequests,
  and a command, job or schedule 1,000 of each; local development does not enforce these.

For an isolated plugin, installing is no longer the real gate: its `register()` runs in a
Worker that reaches nothing it was not granted.

## Policy lints

Rendered plugin source is build-time code, so the CLI checks that it stays within its
manifest. `cossack plugins check` runs the lints; `vite build` runs them too. Source is
parsed, never executed.

The lints keep honest code inside its manifest. They are not a sandbox: code written to evade
them can, so review a plugin you did not write, whatever it asks for. On Cloudflare an isolated
plugin is held by its Worker instead, and the lints only catch mistakes early. A plugin with
`permissions.unrestricted` passes every lint but `COSSACK_PLUGIN_PARSE` and gets the warning
`COSSACK_PLUGIN_UNRESTRICTED` instead.

| Code | What fails |
| --- | --- |
| `COSSACK_PLUGIN_RAW_QUERY` | Importing the RomeDB client or `@cossackframework/cms/server`, calling `db.read()` and friends, or a string that looks like a RomeQL statement. Data goes through `context.cms` repositories. |
| `COSSACK_PLUGIN_NETWORK` | Global `fetch`, sockets or `http`/`https`/`net`/`ws` modules. Use `context.fetch` with a literal URL on a host in `permissions.network`. |
| `COSSACK_PLUGIN_PERMISSION` | Naming a permission or resource the manifest does not declare, define or request. |
| `COSSACK_PLUGIN_SECRET` | Reading `process.env` or a host secret such as `ROMEDB_TOKEN`. |
| `COSSACK_PLUGIN_HOOK` | A handler for an extension point the manifest does not list in `hooks`. |
| `COSSACK_PLUGIN_PARSE` | A file that does not parse. |

## Commands

A manifest can declare commands with typed options. The plugin handles them in
`server.ts` with `context.commands.add(name, handler)`; the handler receives the parsed
options and `{ principal, signal }` and returns JSON.

```bash
CMS_PASSWORD=… cossack support-desk:close-all --reason "Spring cleaning" --email admin@example.com
```

The CLI signs in to the running application (`--url` or `APP_URL`, `--email` or
`CMS_EMAIL`, and `CMS_PASSWORD`) and runs the command as that user, so the handler's
repository calls are authorized like the dashboard's. The command needs the plugin active,
the dashboard permission, and the command's own `permission` when it names one. The
dashboard's entry lists can run commands too, through the `cms.dashboard.entry-actions`
and `bulk-actions` hooks.

## Permissions

- The plugin's own resources authorize through their `access` rules. Unlisted actions
  need `<plugin>/<resource>:<action>`, such as `support-desk/tickets:delete`.
- `permissions.define` declares permissions of the plugin's own, named `<plugin>:<name>`,
  that administrators assign to roles and that access rules, commands and slot links can
  name.
- `permissions.resources` requests actions on resources the plugin does not own, such as
  `{ "cms/posts": ["read"] }`. Each becomes a grant.
- `hasPermission(principal, permission)` from `@cossackframework/cms` checks one, but the
  permission must be one the manifest knows, or the policy lint fails.

## Upgrades and removal

```bash
cossack plugins list
cossack plugins upgrade support-desk --source ./support-desk-1.1.0.tgz
cossack plugins remove support-desk
```

An upgrade re-renders the package over the existing files. Files you edited locally are
kept; a file you edited that also changed upstream is a conflict, reported with
`COSSACK_PLUGIN_CONFLICT`, and nothing is written. Pass `--force` to overwrite. The
manifest's resources are migrated again; added grants need a new grant.

`cossack plugins list` shows rendered plugins and installed packages that declare
`cossack.plugin` in their `package.json` but are not rendered yet.

## Testing a plugin

- Pack with `npm pack --ignore-scripts`, render into a generated application, then run
  `cossack plugins check`, `cossack config --generate`, the type check and `vite build`.
  The repository's `packages/cossack/tests/generated-runtime-plugins.test.js` and
  `generated-runtime-cms-plugins.test.js` do exactly this with the fixtures in
  `tests/fixtures/plugin-package.js` and `cms-plugin-package.js`.
- To test hooks and commands in process, build a host with `createCMS({ db, plugins })`
  where each plugin is `{ name, version, manifest, module: { register } }` against a RomeDB
  file or a local `romedb serve`, then `grantPlugin()` and call `runCommand()` or write through a
  repository. `packages/cms/tests/stores.test.ts` shows the pattern.
