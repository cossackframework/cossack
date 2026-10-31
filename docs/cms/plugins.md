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
| `cms.resource(id)` | A repository (`get`, `list`, `search`, `create`, `update`, `delete`) for the plugin's own resources and the ones it is granted. |
| `fetch` | `fetch` limited to the hosts in `permissions.network`. |

A theme's `server.ts` exports `loaders` instead of, or beside, `register`; see
[Themes](/docs/cms/themes.md#loaders).

Handlers registered here do nothing while the plugin is inactive: a filter returns its
value unchanged and an action returns at once.

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

### `pages/`

Pages, layouts and loading skeletons overlay `src/pages`: `pages/dashboard/support/index.ts`
serves `/dashboard/support`, inside the dashboard layout, with its middleware and error
handling. A path the application also defines fails the build with
`COSSACK_PLUGIN_ROUTE_CONFLICT`. Markdown pages work once the application has the
`markdown` feature.

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
   needs no grant and is managed under Appearance instead.
5. **Active.** Hooks run, commands run, slots and blocks show, and the plugin's collections
   appear on the site and in the dashboard.

Disabling a plugin removes its grants: its hooks, commands, slots, blocks and collections
stop, and its data stays. An upgrade whose manifest requests more than before leaves the
plugin inactive until it is granted again. `cms.status()` lists every plugin with
`active`, a `reason` when it is not, and the grants still `missing`.

## Policy lints

Rendered plugin source is trusted build-time code, so the CLI checks that it stays within
its manifest. `cossack plugins check` runs the lints; `vite build` runs them too. Source is
parsed, never executed.

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
  where each plugin is `{ name, version, manifest, module: { register } }` against a local
  `romedb serve`, then `grantPlugin()` and call `runCommand()` or write through a
  repository. `packages/cms/tests/stores.test.ts` shows the pattern.
