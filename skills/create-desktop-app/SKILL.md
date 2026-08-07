---
name: create-desktop-app
description: Add a secure Electron Desktop side target to a Cossack application while preserving its Cloudflare Workers, Node.js, or Deno web runtime. Use for shared web/Desktop pages, local server-method RPC, Electron native APIs, persistence, Electron Forge packaging, icons, lifecycle, and verification.
---

# Create Desktop App

Add Electron as an independent side target. Preserve the existing web adapter
and shared `src/pages/` tree.

## Inspect and scaffold

Read `.cossack/scaffold.json`, `package.json`, `vite.config.ts`, `src/index.ts`,
and existing Desktop files. Prefer:

```sh
cossack add desktop
pnpm install
```

The scaffold owns `src/desktop/index.ts`, `forge.config.ts`, Desktop assets,
Electron/Forge dependencies, and Desktop scripts. Do not create a Desktop
section in `deno.json`, use `--desktop-backend`, or add Desktop-only
`@types/deno`.

## Runtime structure

Keep routes shared. The Electron main process is Node-based regardless of the
web adapter:

```text
src/index.ts              selected web adapter
src/pages/                shared routes
src/desktop/index.ts      Electron main process
forge.config.ts           native-host packaging
desktop-assets/           app and tray icons
```

Use a stable `dev.cossack.<sanitized-project-name>` identifier. Resolve
`dist/client` from `import.meta.url`, never the current working directory.

## Cossack and native APIs

Desktop supports `@Page({ transport: 'http' })` only. Leave native application
actions undecorated or mark them `@Server()`; Cossack strips their bodies from
the renderer and proxies them through `cossack://app`. Access the window-scoped
shell through `this.env.COSSACK_DESKTOP`. Do not add a renderer client, preload
script, manual `fetch()`, generic IPC bridge, or `@Client()` to native methods.

Use Electron semantics directly:

- asynchronous `dialog` methods;
- `Notification.isSupported()` and notification events;
- `Menu`, `Tray`, `nativeImage`, macOS `app.dock`, Linux badges, and Windows
  overlay/taskbar APIs only where the platform supports them;
- a strongly retained tray and click-to-show only on tested desktop hosts;
- `configureDesktopClose()` with `confirm-quit` on unverified Linux hosts,
  `hide-to-tray` on Windows/macOS only after tray construction succeeds, and
  `quit` as the fallback;
- explicit Quit menu actions routed through the returned close controller.

Cloudflare-only bindings such as D1 do not exist in Electron automatically.
Supply an Electron-compatible binding or isolate that code to the web target.

## Security and packaging

Keep context isolation and sandbox enabled. Never enable Node integration,
preload, unsafe navigation, or renderer window creation. Open only validated
HTTP(S) links externally.

Commit PNG icons through 512px, multi-frame ICO, ICNS, Windows/Linux tray
sizes, and macOS template/@2x images. Tray PNGs must be 8-bit RGBA; Linux
StatusNotifier hosts can reject 16-bit PNGs even when `nativeImage.isEmpty()`
is false. Forge uses ASAR and builds only on the native host: DEB on Linux,
MSI on Windows, DMG on macOS. Signing/notarization hooks may stay conditional
on credentials.

```sh
pnpm tsc --noEmit
pnpm run build
pnpm run build:desktop
pnpm run desktop:package
pnpm run desktop:make
```

Inspect the client bundle for Electron, Node built-ins, preload, shell
implementations, or generic IPC. Manually test menus, tray, close/reopen,
notifications, badges/overlays, persistence, installed icons, and host
installer behavior. Linux trays require AppIndicator/KStatusNotifierItem;
macOS notifications should be tested in a signed package.

Use Electron's official security, protocol, Forge, menu, tray, and notification
documentation for current platform behavior.
