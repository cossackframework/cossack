---
title: "Vite Plugins"
description: "Use the Vite security plugin to remove server code from client bundles."
---

# Vite Plugins

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
Node and Deno WebSockets hold process-local state, so their builds reject that
setting before bundle output. Cloudflare requires `COSSACK_OBJECT`. Dynamic
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
produce `COSSACK_CAPABILITY_BINDING_MISSING`; unsupported requirements produce
`COSSACK_CAPABILITY_UNSUPPORTED`. Requirements needing a separate integration
produce `COSSACK_CAPABILITY_ADAPTER_REQUIRED`. For example, built-in Node and Deno
adapters do not dispatch scheduled handlers. Desktop supports HTTP transport only.

These checks do not validate remote resources or install adapters. Runtime selection is explicit. Cloudflare uses `capabilities.environment` or
`CLOUDFLARE_ENV` to choose bindings; an unknown environment fails the build.
Missing Wrangler/configuration and invalid syntax fail safely without parser
excerpts. You may provide `bindings: ['COSSACK_SSE']` to override discovery for
custom tooling; pass names only, never values, and keep them aligned with the
environment being built.
Unused provider-specific modules outside the route set do not make portable
code unsupported. Generated recipes declare selected SQLite filesystem needs
and, only for Desktop builds, native filesystem needs. Their diagnostic source is
`.cossack/scaffold.json`. Unselected recipe defaults contribute no requirements.
Generated D1/Hyperdrive recipes also declare `cloudflareBindings: ['DB']` or
`['HYPERDRIVE']`. The shared model requires their names in the selected Cloudflare
configuration and rejects them on process runtimes, including Desktop. The check
proves binding configuration presence, not remote resource readiness.
Other feature requirements still need explicit declarations.
`checkCapabilityRequirements` is exported from
`@cossackframework/framework/runtime-capabilities` for tooling that needs all
diagnostics instead of a Vite build error. The parser is exported from
`@cossackframework/framework/page-inspection` for build and CLI consumers.
