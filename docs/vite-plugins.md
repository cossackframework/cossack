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

## Selected runtime requirements

Pass explicit feature requirements to `cossackPages` to check them before a build
emits bundles. The checker uses the same capability model as route inspection.
Pass binding names, never binding values or secrets.

```ts
import { cossackPages } from '@cossackframework/framework/vite-plugin';

cossackPages({
  capabilities: {
    runtime: 'cloudflare',
    bindings: ['COSSACK_SSE'],
    requirements: [{
      feature: 'chat updates',
      source: { file: 'vite.config.ts' },
      requires: { transports: ['sse'] },
    }],
  },
});
```

Each requirement identifies the selected feature and its declaration. Optional
`line` and `column` fields improve the build diagnostic location. Missing bindings
produce `COSSACK_CAPABILITY_BINDING_MISSING`; unsupported runtime requirements
produce `COSSACK_CAPABILITY_UNSUPPORTED`. Desktop supports HTTP transport only.

These checks cover the supplied requirements. They do not discover every route,
validate remote resources, or install runtime adapters. Only declare selected
features: an unused provider-specific module does not make portable code
unsupported. Cloudflare bindings must come from the environment being built.
`checkCapabilityRequirements` is also exported from
`@cossackframework/framework/runtime-capabilities` for tooling that needs the
complete diagnostic list instead of a Vite build error.
