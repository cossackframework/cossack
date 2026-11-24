---
title: "Vite Plugins"
description: "The one-call Vite preset of a Cossack project, and the plugins it composes."
---

# Vite Plugins

## The preset

A project's `vite.config.ts` is one call:

```ts
import { cossackApp } from 'cossack/vite';

export default cossackApp({
  // options
});
```

`cossackApp` returns the whole Vite configuration: the framework's plugins, the plugins of
the project's runtime (Cloudflare or Node), those of its features, and the part each mounted
package gives (the CMS starts its database in development and delivers its icons). The
preset reads the project to decide: its recipe, its `package.json` and what it has installed.
A release changes the preset, so it does not change your file.

The dependencies your pages import are bundled before the first request. The framework
finds them in `src/` and in the mounted packages, so the file lists none.

| Option | What it does |
| --- | --- |
| `markdownProcessor` | Your own processor of Markdown pages. A project with the `markdown` feature uses the framework's without it (see [Markdown pages](./markdown.md)). |
| `configPath` | The Wrangler configuration file, when it is not `wrangler.jsonc`. Every plugin that reads it gets the path. |
| `pages` | More options for `cossackPages()`, such as `developmentTraces` or `templateDiagnostics`. `capabilities` is merged with the project's own. |
| `ssg` | Options for `cossackSsg()`, such as `baseUrl`; `false` leaves static generation out. |
| `cloudflare`, `node` | More options for the runtime's plugin, such as `auxiliaryWorkers`. |
| `budgets`, `security` | More options for `cossackBuildBudgets()` and `cossackSecurityPlugin()`. |
| `plugins` | More Vite plugins, after the preset's. |
| `config` | More Vite configuration, or a function of `{ mode, command }` that returns it. It is merged last, so it wins. |

```ts
export default cossackApp({
  pages: { developmentTraces: true },
  ssg: { baseUrl: 'https://example.com' },
  plugins: [visualizer()],
  config: { server: { port: 4000 } },
});
```

The sections below describe the plugins one at a time. Where an example calls a plugin with
options, pass the same options through the preset: `cossackPages({ developmentTraces: true })`
is `cossackApp({ pages: { developmentTraces: true } })`. A project can still write its
configuration by hand from the same plugins; then each release's changes are yours to copy.

A mounted package adds its part through `cossack.vite` in its `package.json`: a module, named
from the package directory, whose `cossackVite({ root, runtime, mode, command })` export
returns `setup` (plugins that go first), `plugins`, `pages` and `cloudflare` (options for
those plugins), `pluginPolicy` and `config`.

`cloudflare.config` adds to the Worker's configuration (an object, or a function of the
configuration that returns one). The preset adds up every part's and then the project's
(`cossackApp({ cloudflare: { config } })`), objects deeply and lists appended: a project's own
variables never drop the CMS's development ones (`ROMEDB_URL`, `ROMEDB_TOKEN`) or its Worker
exports. A later value wins for the same key. The other `cloudflare` options are replaced: the
project's win over the parts'.

### Pages load on first use in development

The development server does not import every page when it starts. It registers each route
from its file path and imports a page's module with the first request, RPC call or realtime
connection that names it. Layouts, 404 and error pages and Markdown pages are imported at the
start. Builds and the Desktop target import every page, as before.

A page with an error therefore fails when it is first opened, not when the server starts:
that page answers 500, the terminal prints the error, and the other pages keep working.
`cossackApp({ pages: { deferPages: false } })` imports every page at the start again.

### What the development server bundles up front

On Workers, the development server fetches the server's modules from Vite one at a time, so
the preset keeps their number low:

- Core and the renderer are bundled with the packages that import them, every entry in one
  pass, so the application and the packages share one copy. A build and the Desktop target
  keep them as separate modules.
- Vite transforms a module's imports ahead of the server asking for them.
- Vite's own requests do not go through the Worker. With `run_worker_first` rules (the
  generated `["/*", "!/assets/*"]`, or `true`), the Cloudflare plugin sends every request to
  the Worker before Vite, the modules a page's scripts import included: hundreds of requests
  a page, each through the application's middleware and back to Vite. In development the
  preset adds `!/@vite/*`, `!/@fs/*`, `!/@id/*`, `!/node_modules/*` and `!/src/*` to the
  rules, so a page of the application under one of those paths is not reachable in
  development.
- The CMS bundles its library and the RomeDB bindings, and names the Worker classes its
  entry exports (`PluginBridge`, `PluginTail`) as service bindings of the local Worker. The
  Cloudflare plugin compares the exports the configuration declares with the ones the Worker
  has, and starts the local runtime a second time when they differ. The bindings exist in
  development only.

A project that exports its own `WorkerEntrypoint` class without a binding that names it
pays for that second start; a service binding to the class in `wrangler.jsonc` avoids it.

## The security plugin

Cossack includes a security plugin named `vite-security-plugin`. It removes server code from client bundles.

## Client-only modules

Files named `*.client.ts` or `*.client.mts` are browser-only modules. The client
environment receives their source unchanged, including top-level browser
initialization. SSR environments receive generated placeholders for their
named and default runtime exports instead, which prevents top-level `window`,
`document`, and browser-library code from executing on the server.

Static imports from shared component files are supported. Importing a
client-only export during SSR does not throw, but reading or invoking it does,
with guidance to move the access into `onMount()`, `clientInit()`, or an
`@Client()` method. Never access these exports from SSR paths such as
`render()`, `init()`, or server-side field initializers.

A dynamic `import()` of a client-only module (`./chart.client`, or a package's
`editor.client.js`) becomes a rejected promise in server environments, so a
server build has no chunk of the module or of what it imports. The UI
package's `CodeEditor` loads CodeMirror this way: a Workers build stays one
server file. Load such a module in `onMount()` or an `@Client()` method.

Use explicit exports in client-only modules. Type-only exports are ignored,
while runtime `export *` is rejected because the plugin cannot safely derive a
local placeholder interface for it.

## Runtime capability checks

Select a runtime in `cossackPages` to check page transports before a build emits
bundles. Build checks and route inspection use the same source parser and
capability model. Generated recipes enable this selection automatically, using
Desktop in desktop mode and their web adapter otherwise. For Cloudflare, the
plugin reads the project Wrangler configuration through its installed Wrangler
parser, including selected-environment inheritance rules.

```ts
import { cossackPages } from '@cossackframework/framework/vite-plugin';

cossackPages({
  capabilities: {
    runtime: 'cloudflare',
    // Optional: environment: 'staging' (otherwise uses CLOUDFLARE_ENV).
  },
});
```

The plugin scans routes under the Vite project's `src/pages`, extracts static
`@Page` options, and adds their transport requirements. It does not execute
constructors or import application modules. Unknown options fail with
`COSSACK_CAPABILITY_REQUIREMENTS_UNKNOWN` rather than defaulting to HTTP.
Recognized functional HTTP handlers under `src/pages/api/` use HTTP without
needing component decorators.
Configured Markdown routes use the HTTP transport emitted by the Markdown
transform. Layout, loading, declaration, and test files are excluded from page
transport discovery using the same route scanner as the plugin.

Discovered WebSocket pages with `stateful: true` also require `durableState`.
Node WebSockets hold process-local state, so Node builds reject `stateful: true`
before bundle output. Cloudflare requires `COSSACK_OBJECT`. Dynamic
`stateful` expressions produce an unknown-requirements diagnostic instead of
being assumed safe. Use a static boolean in the page declaration.

Add `requirements` inside `capabilities` for other selected features:

```ts
requirements: [{
  feature: 'chat coordination',
  source: { file: 'vite.config.ts', line: 12 },
  requires: { realtimeCoordination: true },
}],
```

Each explicit requirement identifies its feature and source declaration.
Optional `line` and `column` fields improve diagnostic locations. Missing bindings
produce `COSSACK_CAPABILITY_BINDING_MISSING`. Unsupported requirements produce
`COSSACK_CAPABILITY_UNSUPPORTED`. Requirements needing a separate integration
produce `COSSACK_CAPABILITY_ADAPTER_REQUIRED`. For example, the built-in Node
adapter does not dispatch scheduled handlers. Desktop supports HTTP transport only.

These checks do not validate remote resources or install adapters. Runtime selection is explicit. Cloudflare uses `capabilities.environment` or
`CLOUDFLARE_ENV` to choose bindings. An unknown environment fails the build.
Missing Wrangler configuration and invalid syntax fail safely without parser
excerpts. Provide `bindings: ['COSSACK_SSE']` to override discovery for
custom tooling. Pass names only, never values. Keep the names aligned with the
environment being built.
Unused provider-specific modules outside the route set do not make portable
code unsupported. Generated recipes declare selected SQLite filesystem needs
and, only for Desktop builds, native filesystem needs. Their diagnostic source is
`.cossack/scaffold.json`, or `package.json` for a CMS project. Unselected recipe defaults contribute no requirements.
Generated D1/Hyperdrive recipes also declare `cloudflareBindings: ['DB']` or
`['HYPERDRIVE']`. The shared model requires their names in the selected Cloudflare
configuration and rejects them on process runtimes, including Desktop. The check
proves binding configuration presence, not remote resource readiness.
Other feature requirements still need explicit declarations.
`checkCapabilityRequirements` is exported from
`@cossackframework/framework/runtime-capabilities` for tooling that needs all
diagnostics instead of a Vite build error. The parser is exported from
`@cossackframework/framework/page-inspection` for build and CLI consumers.
