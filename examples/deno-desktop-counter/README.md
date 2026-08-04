# Deno Desktop counter

One Cossack page runs in a browser and in a Deno Desktop window. Its action
methods use normal Cossack RPC in both environments: the web build executes
them on its configured web server, while the Desktop build executes them in
the local Deno server packaged with the app.

The page uses `this.isDesktop` to load and save the Desktop count with
Deno-side `localStorage`. The browser counter remains in memory. No manual
Desktop binding or `invoke()` call is needed.

Requires Deno 2.9 or newer.

## Run the web app

```sh
pnpm install
deno task dev
```

Build and run the Deno production web server:

```sh
deno task build
deno task start
```

The same web application could instead use the Cossack Cloudflare Workers or
Node.js adapter. Only the Desktop entry at `src/desktop/index.ts` must use the
Deno adapter.

## Run the Desktop app

```sh
deno task desktop:dev
```

This builds the shared client and local Desktop server, then launches Deno
Desktop with HMR. Package a production app with:

```sh
deno task desktop:build
```

To verify persistence, increment the counter, close the Desktop application,
relaunch it, and confirm the previous count is restored.

The default backend is WebView. Change `desktop.backend` in `deno.json` to
`cef` when a bundled Chromium engine is required. The `raw` backend is not
supported because Cossack renders HTML.

Generated Desktop launchers, binaries, `.so` files, `.deno-desktop-app`,
`.downloaded`, and `dist/` are build output and should remain ignored. Keep
`deno.json`, `deno.lock`, and application source under version control.
