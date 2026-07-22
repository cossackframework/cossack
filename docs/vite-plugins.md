---
title: "Vite Plugins"
description: "Custom Vite security plugin that strips server code from client bundles to prevent leaking sensitive logic and data."
---

# Vite Plugins

Beside of using the official Cloudflare Vite plugin, Cossack also ship with our security plugin. The plugin's job is to clear server's codes from the client bundle so all of your server code is not leaked. We called `vite-security-plugin`.

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
