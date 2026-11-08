# Isolated plugins: a plugin's server code in its own Worker

Builds on `specs/cms-plugin-capabilities.md` (capabilities as grants),
`specs/cms-plugin-unrestricted.md` (the unrestricted tier) and the deferred restricted runtime of
`specs/cms-app-builder.md`, whose server half this is. Today every plugin is compiled into the
application's Worker, so a limited plugin is held to its manifest by a lint, not by the runtime.
On Cloudflare, Dynamic Workers (the Worker Loader binding) give each plugin its own isolate with
no bindings and no network unless the host hands them over. The CMS has to load plugin code
that way and hand over its context as calls. That gives three tiers: isolated (enforced),
in app (linted), unrestricted (warned).

## Decisions

- **Server code only.** Only `server.ts` runs isolated. `ui.ts`, `pages/`, `components/`,
  `middlewares.ts`, `config/*.ts` and `templates/` run in the application at render time and in
  the browser on the site's origin, where a script can act as whoever is signed in. A plugin
  with any of them runs in the app, as does a theme or an unrestricted plugin. `lang/`,
  `translations/` and `assets/` are data and keep a plugin isolated. Splitting one plugin across
  both would protect nothing, so the boundary is the whole plugin.
- **The shape decides, not a flag.** The build marks a plugin `isolated` from its files and
  manifest. A manifest cannot claim it. `PluginStatus.runtime` is `isolated` or `app` and says
  where the plugin actually runs.
- **Cloudflare isolates, Node does not.** Node has no Worker Loader, so an isolated plugin runs in
  the app there, as today, and its status says so. A `workerd` child process on Node, as EmDash
  does, is a follow-up: a native binary per platform and crash supervision for every adapter.
- **One bundle per plugin version, shipped with the deploy.** A Cloudflare build bundles each
  isolated plugin's `server.ts`, its imports and the plugin runtime into one ES module with
  Rolldown, kept out of the application bundle. The registry carries the code and its SHA-256
  instead of `module`. Node built-ins and `cloudflare:` modules fail the build with
  `COSSACK_PLUGIN_ISOLATED_IMPORT`, and the build reports each bundle's size. Installing stays a
  build, as the app builder decided. Installing from a registry without a deploy is a follow-up.
- **Loaded once per version, shared by every site.** The runner loads
  `env.LOADER.get('<name>@<version>:<hash>', ...)` with `env: {}`, `globalOutbound: null`, the
  application's compatibility date, `nodejs_als`, and a tail for logs. Code and `env` are fixed
  per ID, so nothing site-specific goes in them. Ten plugins create about 300 Dynamic Workers
  a month, inside the 1,000 that Workers Paid includes; one per site would multiply that by the
  number of sites.
- **Stand-in handlers from the manifest.** The host registers plugins synchronously and freezes
  its hooks, so it cannot ask an isolate what `register()` added. For each point in the
  manifest's `hooks`, it registers one stand-in handler that forwards the call. Commands and
  schedules come from the manifest the same way, and jobs from the outbox topic `plugin.job`.
  Manifest hooks gain an optional `priority`, the place where that plugin's handlers for the
  point run, default 10. The handlers' own priorities order them inside the isolate.
- **The bridge goes in with each call.** Every call passes a stub of `PluginBridge`, a
  `WorkerEntrypoint` the application exports, made with `ctx.exports.PluginBridge({ props })`.
  The props are the site, the plugin and the call's deadline, which plugin code cannot see or
  forge. A stub the plugin keeps stops working after the deadline. The bridge opens the site's
  host as a request does and serves the context the host builds for the plugin today, method by
  method from an allow list. It never serves `unrestricted`. The host's grant checks stay where
  they are, but they become the boundary, so each bridge method gets a test.
- **The runtime makes the context look the same.** The plugin-side runtime gives `register()` a
  context with today's shape. Its methods find the current call's bridge through
  `AsyncLocalStorage`, so handlers that captured `context` at registration work. `register()`
  runs once per site in each isolate, under that site's bridge, so a fresh isolate rebuilds what
  it needs. Handlers receive an `AbortSignal` the runtime fires at the deadline. `cache.remember`
  computes inside the isolate. `point()` is built from the manifest.
- **Plain data across.** Payloads, results and errors cross as structured clones. A payload that
  cannot be cloned fails that handler with `COSSACK_PLUGIN_PAYLOAD`, and a test runs every core
  point through the bridge.
- **The network is `context.fetch` only.** `globalOutbound: null` makes the global `fetch` and
  `connect` throw. `context.fetch` goes through the bridge and its existing host check. The lint
  rule becomes enforcement.
- **Limits per call.** `getEntrypoint(null, { limits })` caps CPU and subrequests per call, with
  separate defaults for hooks and for commands, jobs and schedules, set in `createCMS`. The
  first step decides the numbers. A plugin that reaches a limit fails that call, and the
  request goes on as after any failed handler. Hooks already run one plugin at a time, and the
  runner keeps at most four distinct isolated plugins in flight per request, the platform's
  limit.
- **The binding arrives with the first isolated plugin.** Dynamic Workers need Workers Paid, so
  `cossack add cms` does not add them. `cossack add plugin` adds `worker_loaders` and the
  `PluginBridge` export to a Cloudflare application the first time it adds an isolated plugin,
  and deploy preflight fails without them. `--in-app` keeps the plugin in the app, recorded in
  `.cossack/plugins.json`. Without the binding at run time, an isolated plugin stays inactive
  with that reason. It never falls back to running in the app.
- **Labels say what is enforced.** Plugins shows an Isolated badge. The rows of other limited
  plugins say they run in the application with permissions checked at build. `plugins list` and
  `cossack add plugin` print the same.
- **Installing stops being the gate for isolated plugins.** Their `register()` runs in an
  isolate that reaches nothing without a grant. The docs' trust section says this per tier, and
  still calls in-app plugins unenforced.

## Out of scope

- UI for isolated plugins: block renderers and dashboard pages as a validated description, the
  app builder's `PluginSurface`. Until then, a plugin with UI runs in the app.
- Inbound routes served by an isolated plugin, a registry without deploys, and the Node runner.
- Per-plugin memory limits, which the platform does not offer.

## Order

1. Measure in Miniflare with a bundled fixture: cold and warm call times, whether bridge calls
   count as subrequests, a kept stub after its call, and `AsyncLocalStorage` across concurrent
   calls. Choose the limits.
2. Build: the shape rule, the Rolldown bundle and hash in the registry for Cloudflare builds, the
   import check, the size report. Node builds unchanged.
3. Runtime: the plugin-side context, per-site `register()`, the entrypoint for hooks, commands,
   jobs and schedules.
4. Host and bridge: a `PluginRunner` option in `createCMS`, stand-in handlers, the Cloudflare
   runner and `CmsPluginBridge` in a Cloudflare-only entry (`@cossackframework/cms/cloudflare`),
   the application's `PluginBridge` opening sites through `networkFor`, the deadline, the
   in-flight cap, tails.
5. Recipe, CLI and dashboard: the binding and export, `--in-app`, preflight,
   `PluginStatus.runtime`, labels.
6. Tests and docs: `docs/cms/plugins.md` (tiers and trust), `docs/cms/manifest.md` (hook
   `priority`), `docs/cossack-cli.md`.

## Done when

- A fixture plugin with only `server.ts`, a resource, a before-write filter, an after-commit
  action, a command and a schedule behaves the same isolated in a generated Cloudflare
  application, in development and in a built preview, as in the app on Node.
- Its code is not in the application's Worker bundle.
- Inside it, the global `fetch` throws, `process.env` and the `cloudflare:workers` env are empty,
  an ungranted resource fails with `CMS_FORBIDDEN` from the bridge, a stub kept past its call is
  refused, and another site's ID passed as an argument changes nothing.
- A hook that loops past its CPU limit ends as a failed outcome, and the write still commits.
- Two sites of a network use one Dynamic Worker per plugin version, and each sees its own
  settings.
- On Node the same plugin runs in the app, and its status says so.
- `cossack add plugin` adds the binding and the export once, `--in-app` skips them, and deploy
  preflight fails an application with an isolated plugin and no binding.

## References

- [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/): the API, bindings,
  egress control, limits and pricing.
- [`ctx.exports`](https://developers.cloudflare.com/workers/runtime-apis/context/): loopback
  bindings with props, on by default since the 2025-11-17 compatibility date.
- [EmDash plugin formats](https://docs.emdashcms.com/plugins/creating-plugins/choosing-a-format/)
  and [sandbox](https://docs.emdashcms.com/deployment/plugin-sandbox/): the same split between
  sandboxed server code and native plugins with UI.
