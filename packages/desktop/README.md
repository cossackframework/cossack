# @cossackframework/desktop

The Electron main-process runtime for Cossack Desktop applications. It serves
the renderer and local Cossack SSR/RPC over the private `cossack://app` origin,
injecting `ASSETS` and a window-scoped `COSSACK_DESKTOP` shell into request
bindings.

The generated `src/desktop/index.ts` exports its application and bootstrap so
`desktop:dev` can load server modules through Vite inside Electron:

```ts
import { app, createDesktopApp, electronRuntimeAdapter } from '@cossackframework/desktop';
import { createApp } from '@cossackframework/framework/router';
import { fileURLToPath } from 'node:url';
import { App } from '../App';
import { template } from '../root';

export function createEnv(variables: Record<string, string | undefined> = process.env) {
  return { ...variables };
}
export const env = import.meta.env.DEV ? {} : createEnv();
export const frameworkApp = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: electronRuntimeAdapter,
});

export async function startDesktop(createApplication = createDesktopApp) {
  const desktop = await createApplication({
    identifier: 'dev.cossack.my-app',
    productName: 'My App',
    assetsRoot: fileURLToPath(new URL('../client/', import.meta.url)),
    env,
    fetch: (request, bindings) => frameworkApp.fetch(request, bindings),
  });
  // Set up native menus, trays and close behavior here.
  return desktop;
}

if (!import.meta.env.DEV) {
  void startDesktop().catch(error => { console.error(error); app.exit(1); });
}
```

Do not top-level `await` `createDesktopApp()` in an ESM entry. Electron emits
`ready` after the main module's first event-loop tick. Desktop creation waits
for that event. Development calls the exported bootstrap once. Production starts
it through the guarded call above.

`pnpm desktop:dev` requires Vite 8.1.4 or later in the 8.x series. The CLI
supervises Electron, which runs the development module loader and asset server.
Pages retain the private origin and native request checks. Source edits reload
managed windows. Changes under `src/desktop/`, to the Vite configuration, or to
root `.env*` files restart Electron. Reloads do not undo application side effects.
Development passes only declared bindings: the `env` given to
`createDesktopApp()` and the bootstrap's `env` export, or the result of an
exported `createEnv(variables)`, which receives the root `.env*` values for the
`desktop` mode and the process variables. Other host variables are not exposed.
Page syntax errors remain visible and source repair can recover without
restarting the CLI.

Keep `ssr.noExternal: true` restricted to production Desktop builds:
`mode === 'desktop' && command === 'build'`. Development needs normal external
package resolution. Do not register another server that exposes native handlers
on HTTP. Enable `developmentTraces: true` in `cossackPages()` to use the shared
inspector and CLI/MCP capture readers.

`createDesktopApp()` serves only hashed build output under `/assets/` before
the application, with `Cache-Control: public, max-age=31536000, immutable` for
hashed names. A missing `/assets/` file continues to the application. Every
other request, including `public/` files, goes to the application. The
framework serves those files from `ASSETS` after global and page policies, with
`Cache-Control: public, max-age=0, must-revalidate`.

The optional `assets.fetch(request)` provider on `createDesktopApp()` replaces
filesystem lookup in `assetsRoot`. The runtime asks it for `/assets/*` before
the application and cancels the body of a 404. It is also the application's
`ASSETS` binding. The development runner supplies a Vite provider. It sends
requests for `publicDir` files to the application, so their policies run, and
lets Vite answer its client and modules first. Ordinary packaged apps use
`assetsRoot`. Native proof headers are stripped before either provider or
application code receives a request.

`createDesktopApp()` forces context isolation and renderer sandboxing, with Node
integration and preload bridges disabled. Only same-origin navigation is
allowed. Valid HTTP(S) popups are opened in the operating-system browser.
Desktop pages require `@Page({ transport: 'http' })`.

Use Electron 43.7+ in the 43.x series, or 44.4+. The runtime enforces native
request initiators and managed window identity before dispatching local actions.
Cossack reserves the `persist:cossack.<identifier>` session and its
`onBeforeSendHeaders` hook. Default-session cookies/storage are not migrated.
Keep the identifier stable. Native app files retain their existing paths.

On Linux, `desktop:dev` inspects Electron's local `chrome-sandbox` helper. pnpm's
download is normally user-owned rather than root-owned/setuid, so the runner
prints a warning and applies Electron's testing-only `--no-sandbox` flag to the
development process. Forge packages and installed DEB applications do not use
this fallback. The DEB installs its helper with the required permissions.
For Wayland sessions that expose XWayland, the development runner selects X11
to avoid Chromium's current Wayland/Vulkan incompatibility and hides nonfatal
GPU probe noise. Set `COSSACK_DESKTOP_OZONE_PLATFORM=wayland` to force native
Wayland, or `COSSACK_DESKTOP_DEBUG=1` to retain Chromium diagnostics and print
Desktop lifecycle tracing.

The generated Linux desktop entry also starts the installed DEB through
XWayland so Electron can register its tray with GNOME's StatusNotifier host.
An unpacked Forge executable bypasses that desktop entry. Launch it with both
`--no-sandbox` and `--ozone-platform=x11` when you test it directly from `out/`.
The sandbox flag is only appropriate for that uninstalled test package.

Node 22 or 24 LTS is recommended for Forge packaging. Node 26 is supported, but
the current Forge/Packager ZIP stack can extract Electron pathologically slowly
there. Generated Desktop projects declare `node: ">=22"`.

Use Electron APIs in the bootstrap or through ordinary `@Server()` methods via
`this.env.COSSACK_DESKTOP`. There is deliberately no renderer client or generic
IPC bridge. See Electron's security checklist before adding any renderer-facing
capability: https://www.electronjs.org/docs/latest/tutorial/security

Use `createDesktopTray({ image, menu, toolTip })` when the application needs a
tray. It returns Electron's native `Tray` and, on Linux, performs the separate
StatusNotifier registration needed by Ubuntu's AppIndicator extension. The
compatibility registration uses `dbus-send`, supplied by the standard `dbus`
package on Debian/Ubuntu. Keep the returned tray strongly referenced.

Choose close behavior explicitly with `configureDesktopClose()`:

```ts
const behavior = process.platform === 'linux'
  ? 'confirm-quit'
  : tray
    ? 'hide-to-tray'
    : 'quit';

const close = configureDesktopClose({
  window: desktop.mainWindow,
  behavior,
  tray,
  onQuit: () => desktop.quit(),
});
```

`desktop.mainWindow` is a live getter. It changes when the main window closes
while another managed window stays open, and when macOS activation, a second
instance or `desktop.show()` must create a new window. `desktop.shell` is
stable and its window methods always target the current main window. A close
policy applies to the window it was given.

`quit` closes the application, `hide-to-tray` hides only while its tray is
alive and otherwise quits, and `confirm-quit` uses an asynchronous native
dialog. Linux tray activation varies by desktop host, so prefer
`confirm-quit` unless the target distribution has been tested. Use
`close.quit()` from every explicit Quit menu action.
