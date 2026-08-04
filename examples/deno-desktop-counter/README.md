# Deno desktop counter

The same Cossack page runs in a normal browser and in a Deno Desktop window.
The browser counter is in-memory. Desktop calls the typed, allowlisted Deno
bindings and persists the value in Deno-side `localStorage`.

Requires Deno 2.9 or newer.

```sh
pnpm install
deno task dev             # browser development
deno task build
deno task start           # production Deno HTTP server
deno task desktop:dev     # desktop HMR
deno task desktop:build   # web/SSR production build, then host package
```

To verify persistence, increment the counter in the desktop window, close the
application, relaunch the packaged app, and confirm that the previous count is
restored. Change `desktop.backend` in `deno.json` from `webview` to `cef` when
you need a bundled Chromium engine. The `raw` backend is intentionally not
supported because Cossack renders HTML.
