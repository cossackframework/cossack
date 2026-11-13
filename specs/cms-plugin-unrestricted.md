# Unrestricted plugins: full access, asked for and warned about

Builds on `specs/cms-plugin-capabilities.md` (capabilities as grants) and
`specs/cms-app-builder.md` (plugins as trusted build-time modules). A plugin reaches the CMS
through a scoped context, and the policy lint keeps its source inside its manifest. That covers
most plugins, but a migration tool, a reporting plugin or a custom integration needs what
WordPress gives every plugin. The CMS sits between the two: limited by default like Emdash,
unlimited on request like WordPress, and the request is impossible to miss.

## Decisions

- **One permission.** `permissions.unrestricted: true` becomes the grant
  `capability:unrestricted`, requested like any capability, so an upgrade that adds it leaves the
  plugin inactive until it is granted again.
- **One door.** `await context.unrestricted()` checks that the plugin is active and granted, then
  returns `{ db, host, env }`: the site's database with no access rules, the whole host, and
  every binding of the application. One call is easy to find in a review and easy to lint.
- **Everything else opens too.** With the grant, every capability passes without being listed:
  `context.fetch` reaches any host, `context.secrets` reads any string binding,
  `context.cms.resource()` takes any resource, handlers may use any extension point, and
  schedules need no `permissions.jobs`.
- **The lint steps aside, and says so.** An unrestricted plugin's source passes every policy lint
  except parsing, and `cossack plugins check` and each build report
  `COSSACK_PLUGIN_UNRESTRICTED` as a warning. Using `context.unrestricted` without the permission
  is still `COSSACK_PLUGIN_PERMISSION`.
- **Installing is the real gate.** A plugin's module and `register()` run when the application
  starts, granted or not. For a limited plugin the lint holds that code to its manifest. For an
  unrestricted one nothing does, so `cossack add plugin` and `cossack plugins upgrade` print a
  danger message and stop until someone accepts it: a prompt that defaults to no in a terminal,
  `--allow-unrestricted` elsewhere, and the `allowUnrestricted` option of the scaffold API for
  the Platform. `--yes` and `--force` do not count. The acceptance is recorded in
  `.cossack/plugins.json`, so later upgrades of the same plugin do not ask again.
- **Granting takes a separate yes.** `grantPlugin(name, principal, { unrestricted: true })` and
  `setPluginState(name, 'network', { principal, unrestricted: true })` refuse with `CMS_CONFLICT`
  without it. The Plugins and Network plugins pages show a destructive notice above the table, so
  no filter or sideways scroll hides it, with a box to tick beside the button; it works without
  JavaScript. Bulk actions never pass the option, and new
  sites' default plugins skip such a plugin.
- **Only a network admin grants it.** `env` holds every site's database credentials, so a site
  admin who could grant it would own the network.
- **A grant leaves a trail, and does not travel.** A grant writes `cms_audit` with who approved
  it, shown under Tools → Activity. A site import deletes the grant, so an export cannot switch
  on unrestricted access somewhere else.
- **A theme with the permission is not theme-only.** It needs a grant like any plugin.
- **The word.** `unrestricted` everywhere: manifest, grant, CLI, dashboard. An "Unrestricted"
  badge stays on the plugin's row after the grant.
- **This is not a sandbox.** The lint is a static check of honest code, so a limited plugin that
  tries to evade it can. The deferred restricted runtime of `specs/cms-app-builder.md` is what
  would enforce limits. Neither the dashboard nor the docs call a limited plugin safe.

## Order

1. Manifest, grant, `context.unrestricted()`, capability checks, network and import rules.
2. The lint and its warning, install consent in scaffold and CLI.
3. The dashboard notices, tests, docs.

## Done when

- A plugin that asks for `unrestricted` cannot be rendered without a yes, and its build passes
  with raw queries, global `fetch` and `process.env` in its source.
- It stays inactive until a network admin ticks the box. A bulk grant, an unticked row and a site
  admin are all refused, and `context.unrestricted()` refuses until then.
- Once granted, it reads and writes through `db`, and the grant shows under Tools → Activity.
- A limited plugin calling `context.unrestricted` fails the lint and the host refuses it.

## Outcome

| Area | Delivered | Verified by |
| --- | --- | --- |
| Permission and host (2026-11-08) | `permissions.unrestricted`, `UNRESTRICTED_GRANT`, `context.unrestricted()` with `PluginUnrestricted`, `createCMS({ env })`, `PluginStatus.unrestricted`, the grant lifting `allowed`, `context.fetch`, `context.secrets`, `context.cms`, hooks and schedules, `grantPlugin(…, { unrestricted })`, `setPluginState(…, { unrestricted })`, `unrestrictedGrantAudit`, the import dropping the grant | `unrestricted.test.ts`, `capabilities-unit.test.ts`, `network-plugins.test.ts`, `site-import.test.ts` |
| Lint and install | `COSSACK_PLUGIN_UNRESTRICTED` as a warning, `lintPlugin` standing aside, `allowUnrestricted` and `unrestrictedWarning` in the scaffold, the prompt and `--allow-unrestricted` in the CLI, `unrestricted` in `plugins list`, `plugins check` and `.cossack/plugins.json` | `plugin-policy.test.js`, `plugins.test.js`, a pseudo-terminal run of the prompt, `generated-runtime-cms-plugins.test.js` |
| Dashboard | `unrestrictedNotice` and `unrestrictedConfirm` on Plugins and Network plugins, the Unrestricted badge, default plugins leaving such a plugin out | `generated-runtime-cms-plugins.test.js` (bulk, unticked and ticked grants on both pages, a raw query from a command, Tools → Activity), screenshots in light and dark |
