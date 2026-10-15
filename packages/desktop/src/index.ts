import { randomUUID } from 'node:crypto';
import { authorizeDesktopRequest, desktopOwnerHeader, desktopTokenHeader, isDesktopAppUrl } from './request-security.js';
import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';
import type {
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  NativeImage,
  WebPreferences,
} from 'electron';
import type { CossackRuntimeAdapter } from '@cossackframework/core';
import { STATIC_ASSET_DIRECTORY } from '@cossackframework/core/static-assets';
import { DesktopUnavailableError } from './error.js';

const electronApi = (typeof electron === 'object' && electron !== null ? electron : {}) as typeof import('electron');
export const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  protocol,
  shell: electronShell,
  Tray,
} = electronApi;

export { DesktopUnavailableError } from './error.js';
export { electronShell as shell };
export type {
  App,
  BrowserWindowConstructorOptions,
  Certificate,
  ContextMenuParams,
  Dialog,
  FileFilter,
  JumpListCategory,
  JumpListItem,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  MessageBoxReturnValue,
  NativeImage,
  NotificationConstructorOptions,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  Shell,
  ThumbarButton,
  WebContents,
  WebPreferences,
  WillNavigateEvent,
} from 'electron';
export type BrowserWindow = import('electron').BrowserWindow;
export type Menu = import('electron').Menu;
export type Notification = import('electron').Notification;
export type Tray = import('electron').Tray;
export type Dock = NonNullable<import('electron').App['dock']>;

export const electronRuntimeAdapter = {
  name: 'electron',
  supportedTransports: ['http'],
  getClientMetadata: () => ({ platform: 'desktop', adapter: 'electron' }),
} as const as CossackRuntimeAdapter & {
  readonly name: 'electron';
  readonly supportedTransports: readonly ['http'];
};

const protocolScheme = 'cossack';
const protocolOrigin = 'cossack://app';
let schemeRegistered = false;
let activeApplication: Promise<DesktopApplication> | undefined;
let desktopTraySequence = 0;

function debugDesktop(message: string): void {
  if (process.env.COSSACK_DESKTOP_DEBUG === '1') {
    console.error(`[Cossack Desktop] ${message}`);
  }
}

function registerDesktopScheme(): void {
  if (schemeRegistered) return;
  if (!protocol?.registerSchemesAsPrivileged) return;
  protocol.registerSchemesAsPrivileged([{
    scheme: protocolScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }]);
  schemeRegistered = true;
}

registerDesktopScheme();

export type DesktopFetch = (
  request: Request,
  env?: Record<string, unknown>,
) => Response | Promise<Response>;

export type SafeBrowserWindowOptions = Omit<BrowserWindowConstructorOptions, 'webPreferences'> & {
  webPreferences?: Pick<WebPreferences,
    'spellcheck' | 'enableWebSQL' | 'navigateOnDragDrop'>;
};

export interface CreateDesktopAppOptions {
  identifier: string;
  productName: string;
  /** Client build output (`dist/client`), read when `assets` is not given. */
  assetsRoot: string;
  /**
   * Optional asset provider that replaces filesystem lookup in `assetsRoot`.
   * It answers hashed build output under `/assets/` before the application,
   * and it is the application's `ASSETS` binding, which serves every other
   * file after global and page policies. Return 404 for a missing file.
   */
  assets?: { fetch(request: Request): Response | Promise<Response> };
  fetch: DesktopFetch;
  env?: Record<string, unknown>;
  startPath?: string;
  window?: SafeBrowserWindowOptions;
}

export interface CreateDesktopWindowOptions extends SafeBrowserWindowOptions {
  path?: string;
}

export interface DesktopShell {
  readonly app: typeof app;
  /**
   * The window this shell controls. For `DesktopApplication.shell` it always
   * resolves to the application's current main window.
   */
  readonly window: BrowserWindow;
  readonly Menu: typeof Menu;
  readonly Tray: typeof Tray;
  readonly dialog: typeof dialog;
  readonly Notification: typeof Notification;
  readonly nativeImage: typeof nativeImage;
  readonly shell: typeof electronShell;
  readonly dock: typeof app.dock;
  show(): void;
  hide(): void;
  focus(): void;
  quit(): void;
  setBadge(value: string | number | null): boolean;
  setOverlayIcon(image: NativeImage | null, description?: string): void;
}

export interface DesktopApplication {
  readonly app: typeof app;
  /**
   * The current main window. It is replaced when the main window closes while
   * another managed window stays open, and when activation (macOS) or a second
   * instance needs a new window. Read it when needed instead of caching it.
   */
  readonly mainWindow: BrowserWindow;
  /** A stable shell whose window methods always target the current main window. */
  readonly shell: DesktopShell;
  readonly quitting: boolean;
  createWindow(options?: CreateDesktopWindowOptions): BrowserWindow;
  show(): void;
  hide(): void;
  quit(): void;
}

export interface CreateDesktopTrayOptions {
  image: NativeImage | string;
  menu?: Menu | null;
  toolTip?: string;
  guid?: string;
}

export type DesktopCloseBehavior = 'quit' | 'hide-to-tray' | 'confirm-quit';

export interface ConfigureDesktopCloseOptions {
  window?: BrowserWindow;
  behavior: DesktopCloseBehavior;
  tray?: Tray;
  confirmation?: Partial<MessageBoxOptions>;
  confirmResponse?: number;
  onQuit?: () => void;
}

export interface DesktopCloseController {
  readonly behavior: DesktopCloseBehavior;
  quit(): void;
  dispose(): void;
}

function assertElectron(): void {
  if (!process.versions.electron || process.type === 'renderer' || !app || !BrowserWindow) {
    throw new DesktopUnavailableError();
  }
  const [major, minor] = process.versions.electron.split('.').map(Number);
  if (major < 43 || major === 43 && minor < 7 || major === 44 && minor < 4)
    throw new Error('Cossack Desktop requires Electron 43.7+ or 44.4+ for native request initiator verification.');
}

function repairUbuntuTrayRegistration(tray: Tray, sequence: number): void {
  if (process.platform !== 'linux') return;
  const serviceName = `org.freedesktop.StatusNotifierItem-${process.pid}-${sequence}`;
  // Ubuntu retries Chromium's unusable self-registration three times, once per
  // second. Register after that proxy is discarded so the replacement keeps
  // the well-known service name.
  const timer = setTimeout(() => {
    if (tray.isDestroyed()) return;
    // Chromium self-registers from the StatusNotifierItem's own D-Bus
    // connection. Ubuntu's AppIndicator extension then targets the unique bus
    // name, which Chromium does not answer. A separate registration preserves
    // the well-known service name required by the StatusNotifierItem spec.
    execFile('dbus-send', [
      '--session',
      '--print-reply',
      '--type=method_call',
      '--dest=org.kde.StatusNotifierWatcher',
      '/StatusNotifierWatcher',
      'org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem',
      `string:${serviceName}`,
    ], { timeout: 2_000 }, (error) => {
      if (error) debugDesktop(`could not repair Linux tray registration: ${error.message}`);
    });
  }, 4_000);
  timer.unref();
}

/** Create a native Electron tray and apply Cossack's Linux host compatibility fix. */
export function createDesktopTray(options: CreateDesktopTrayOptions): Tray {
  assertElectron();
  const sequence = ++desktopTraySequence;
  const tray = options.guid
    ? new Tray(options.image, options.guid)
    : new Tray(options.image);
  if (options.toolTip) tray.setToolTip(options.toolTip);
  if (options.menu !== undefined) tray.setContextMenu(options.menu);
  repairUbuntuTrayRegistration(tray, sequence);
  return tray;
}

/** Apply one explicit, disposable policy to a native BrowserWindow close event. */
export function configureDesktopClose(options: ConfigureDesktopCloseOptions): DesktopCloseController {
  assertElectron();
  const window = options.window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!window) throw new DesktopUnavailableError();
  if (options.behavior === 'hide-to-tray' && !options.tray) {
    throw new TypeError('Desktop hide-to-tray behavior requires a tray.');
  }

  let disposed = false;
  let quitting = false;
  let confirmationPending = false;
  const beginQuitting = () => { quitting = true; };
  const quit = () => {
    if (quitting) return;
    quitting = true;
    (options.onQuit ?? (() => app.quit()))();
  };
  const controller: DesktopCloseController = {
    behavior: options.behavior,
    quit,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeListener('close', handleClose);
      app.removeListener('before-quit', beginQuitting);
    },
  };
  const handleClose = (event: { preventDefault(): void }) => {
    if (disposed || quitting) return;
    event.preventDefault();

    if (options.behavior === 'quit') {
      quit();
      return;
    }
    if (options.behavior === 'hide-to-tray') {
      if (options.tray && !options.tray.isDestroyed()) window.hide();
      else quit();
      return;
    }
    if (confirmationPending) return;

    confirmationPending = true;
    const applicationName = app.getName();
    void dialog.showMessageBox(window, {
      type: 'question',
      title: applicationName,
      message: `Quit ${applicationName}?`,
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      ...options.confirmation,
    }).then(({ response }) => {
      if (response === (options.confirmResponse ?? 0)) quit();
    }).catch((error) => {
      console.error('[Cossack Desktop] Could not show the close confirmation.', error);
    }).finally(() => {
      confirmationPending = false;
    });
  };

  window.on('close', handleClose);
  app.on('before-quit', beginQuitting);
  return controller;
}

function normalizePathname(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new URIError('Malformed Desktop URL path.');
  }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    throw new URIError('Unsafe Desktop URL path.');
  }
  const segments = decoded.split('/');
  if (segments.includes('..')) throw new URIError('Desktop URL traversal is not allowed.');
  return decoded.replace(/^\/+/, '');
}

function containedAssetPath(assetsRoot: string, pathname: string): string {
  const root = path.resolve(assetsRoot);
  const candidate = path.resolve(root, pathname || '__cossack_ssr__');
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new URIError('Desktop URL traversal is not allowed.');
  }
  return candidate;
}

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Vite writes hashed client build output to `assets/`. Like Cloudflare's
// `["/*", "!/assets/*"]` routing and the generated Node server, Desktop serves
// only this namespace before the application. Every other file, including
// `public/`, goes through the framework, which serves it from ASSETS after
// global and page/layout policies.
const buildAssetPrefix = `${STATIC_ASSET_DIRECTORY}/`;
const hashedFileName = /\.[a-zA-Z0-9_-]{8,}\.[^/]+$/;

/** True for a GET or HEAD request in the hashed build-output namespace. */
function isBuildAssetRequest(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  return normalizePathname(new URL(request.url).pathname).startsWith(buildAssetPrefix);
}

/** The generated Node server's cache headers: hashed build output never changes. */
function assetCacheControl(pathname: string): string {
  return pathname.startsWith(buildAssetPrefix) && hashedFileName.test(pathname)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';
}

async function assetResponse(assetsRoot: string, request: Request): Promise<Response | undefined> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (!pathname) return undefined;
  const filePath = containedAssetPath(assetsRoot, pathname);
  try {
    const [realRoot, realFile] = await Promise.all([realpath(assetsRoot), realpath(filePath)]);
    const relative = path.relative(realRoot, realFile);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
    const info = await stat(realFile);
    if (!info.isFile()) return undefined;
    const headers = new Headers({
      'content-type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(info.size),
      'cache-control': assetCacheControl(pathname),
    });
    return new Response(request.method === 'HEAD' ? null : await readFile(realFile), { headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined;
    throw error;
  }
}

function toFrameworkRequest(request: Request): Request {
  const desktopUrl = new URL(request.url);
  const url = new URL(`${desktopUrl.pathname}${desktopUrl.search}`, 'https://app');
  url.searchParams.delete('__cossack_window');
  const mapped = new Request(url, request);
  // Native initiator and owned-window proof were checked before this rewrite.
  mapped.headers.delete(desktopOwnerHeader);
  mapped.headers.delete(desktopTokenHeader);
  mapped.headers.set('origin', url.origin);
  return mapped;
}

const desktopProofHeaders = new Set([desktopOwnerHeader, desktopTokenHeader]);

/**
 * Strip private Desktop proof from an outbound request. Return an empty
 * response, which leaves the request unchanged, when no proof is present.
 * Other header names and values are preserved exactly as given.
 */
function withoutDesktopProof(requestHeaders: Record<string, string>): { requestHeaders?: Record<string, string> } {
  const entries = Object.entries(requestHeaders);
  const kept = entries.filter(([name]) => !desktopProofHeaders.has(name.toLowerCase()));
  return kept.length === entries.length ? {} : { requestHeaders: Object.fromEntries(kept) };
}

function secureWindowOptions(options: SafeBrowserWindowOptions = {}): BrowserWindowConstructorOptions {
  const { webPreferences, ...windowOptions } = options;
  return {
    width: 1000,
    height: 720,
    show: false,
    ...windowOptions,
    webPreferences: {
      ...webPreferences,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: undefined,
    },
  };
}

function secureWebContents(window: BrowserWindow): void {
  window.webContents.on('will-navigate', (event, target) => {
    try {
      const url = new URL(target);
      if (!isDesktopAppUrl(url)) {
        event.preventDefault();
        if (url.protocol === 'https:' || url.protocol === 'http:') void electronShell.openExternal(url.href);
      }
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        void electronShell.openExternal(target.href);
      }
    } catch {
      // Invalid URLs and every non-HTTP(S) scheme are denied.
    }
    return { action: 'deny' };
  });
}

export function createDesktopShell(options: { window?: BrowserWindow } = {}): DesktopShell {
  assertElectron();
  const window = options.window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!window) throw new DesktopUnavailableError();
  return shellFor(() => window);
}

function shellFor(currentWindow: () => BrowserWindow): DesktopShell {
  return {
    app,
    get window() { return currentWindow(); },
    Menu,
    Tray,
    dialog,
    Notification,
    nativeImage,
    shell: electronShell,
    get dock() { return app.dock; },
    show() { currentWindow().show(); },
    hide() { currentWindow().hide(); },
    focus() { currentWindow().focus(); },
    quit() { app.quit(); },
    setBadge(value) {
      return app.setBadgeCount(value === null ? 0 : typeof value === 'number' ? value : Number(value) || 0);
    },
    setOverlayIcon(image, description = '') {
      currentWindow().setOverlayIcon(image, description);
    },
  };
}

async function initializeDesktopApp(options: CreateDesktopAppOptions): Promise<DesktopApplication> {
  assertElectron();
  debugDesktop('initializing Electron application');
  if (!options.identifier.trim()) throw new TypeError('Desktop identifier is required.');
  if (!options.productName.trim()) throw new TypeError('Desktop productName is required.');
  const assetsRoot = path.resolve(options.assetsRoot);
  const startPath = `/${(options.startPath ?? '/').replace(/^\/+/, '')}`;
  let quitting = false;
  let mainWindow: BrowserWindow;
  let mainWindowOpen = false;

  app.setName(options.productName);
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('class', options.identifier);
  }
  if (process.platform === 'win32') app.setAppUserModelId(options.identifier);
  debugDesktop('requesting single-instance lock');
  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  debugDesktop(`single-instance lock ${hasSingleInstanceLock ? 'acquired' : 'unavailable'}`);
  if (!hasSingleInstanceLock) {
    app.quit();
    throw new Error(`[Cossack] Another ${options.productName} instance is already running.`);
  }

  await app.whenReady();
  debugDesktop('Electron app is ready');
  const desktopSession = electronApi.session.fromPartition(`persist:cossack.${options.identifier}`);
  const windows = new Map<number, BrowserWindow>();
  const requestToken = randomUUID();
  // This session belongs to the runtime, so its single-listener WebRequest hook
  // does not replace hooks attached to Electron's default session by the app.
  desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!details.url.startsWith(`${protocolScheme}:`)) {
      // A redirect must not forward private proof to an external server.
      // Other requests keep Chromium's headers exactly as sent.
      callback(withoutDesktopProof(details.requestHeaders));
      return;
    }
    const headers = authorizeDesktopRequest(details, windows.has(details.webContentsId ?? -1), requestToken);
    if (!headers) debugDesktop(`rejected ${details.resourceType} from ${details.initiatorOrigin ?? 'browser'} (owned: ${windows.has(details.webContentsId ?? -1)})`);
    callback(headers ? { requestHeaders: headers } : { cancel: true });
  });

  const createWindow = (windowOptions: CreateDesktopWindowOptions = {}): BrowserWindow => {
    const { path: requestedPath = startPath, ...browserOptions } = windowOptions;
    const target = new URL(requestedPath, `${protocolOrigin}/`);
    if (!isDesktopAppUrl(target)) {
      throw new TypeError('Desktop window paths must stay within cossack://app.');
    }
    const secureOptions = secureWindowOptions({ ...options.window, ...browserOptions });
    const window = new BrowserWindow({ ...secureOptions, webPreferences: { ...secureOptions.webPreferences, session: desktopSession } });
    const contentsId = window.webContents.id;
    windows.set(contentsId, window);
    window.once('closed', () => windows.delete(contentsId));
    debugDesktop(`created BrowserWindow ${window.id}`);
    secureWebContents(window);
    void window.loadURL(target.href).then(
      () => debugDesktop(`loaded ${target.href}`),
      (error) => console.error(`[Cossack Desktop] Failed to load ${target.href}`, error),
    );
    window.once('ready-to-show', () => window.show());
    return window;
  };

  const fileAssets = {
    fetch: async (assetRequest: Request) =>
      await assetResponse(assetsRoot, assetRequest) ?? new Response('Not found', { status: 404 }),
  };
  await desktopSession.protocol.handle(protocolScheme, async (request) => {
    debugDesktop(`handling ${request.method} ${request.url}`);
    let url: URL;
    try {
      url = new URL(request.url);
      if (!isDesktopAppUrl(url)) return new Response('Forbidden Desktop authority', { status: 403 });
      const origin = request.headers.get('origin');
      if (origin && origin !== protocolOrigin) return new Response('Forbidden Desktop origin', { status: 403 });
      normalizePathname(url.pathname);
      const referringUrl = request.headers.get('referer');
      const scopeUrl = new URL(referringUrl || request.url);
      if (!isDesktopAppUrl(scopeUrl)) {
        return new Response('Forbidden Desktop authority', { status: 403 });
      }
    } catch {
      return new Response('Invalid Desktop URL', { status: 400 });
    }
    const owner = request.headers.get(desktopOwnerHeader);
    const browserWindow = owner === null ? undefined : windows.get(Number(owner));
    if (request.headers.get(desktopTokenHeader) !== requestToken || !browserWindow)
      return new Response('Unverified Desktop request', { status: 403 });
    const scopedShell = createDesktopShell({ window: browserWindow });
    const frameworkRequest = toFrameworkRequest(request);
    const assets = options.assets ?? fileAssets;
    if (isBuildAssetRequest(frameworkRequest)) {
      // A missing build file continues to the application and its 404 handling.
      const asset = await assets.fetch(frameworkRequest);
      if (asset.status !== 404) return asset;
      await asset.body?.cancel();
    }
    return options.fetch(frameworkRequest, {
      ...(options.env ?? {}),
      ASSETS: assets,
      COSSACK_DESKTOP: scopedShell,
    });
  });
  debugDesktop('registered cossack:// protocol handler');

  const setMainWindow = (window: BrowserWindow): BrowserWindow => {
    mainWindow = window;
    mainWindowOpen = true;
    window.once('closed', () => {
      if (mainWindow !== window) return;
      // Keep the application pointing at a live window when one remains.
      // `windows` already dropped this window: its listener was added first.
      const next = windows.values().next().value;
      if (next) setMainWindow(next);
      else mainWindowOpen = false;
    });
    return window;
  };
  const openMainWindow = (): BrowserWindow => mainWindowOpen ? mainWindow : setMainWindow(createWindow());

  setMainWindow(createWindow());
  // Resolve lazily so references taken before a window is replaced keep working.
  const shell = shellFor(() => mainWindow);
  const application: DesktopApplication = {
    app,
    get mainWindow() { return mainWindow; },
    shell,
    get quitting() { return quitting; },
    createWindow,
    show() { const window = openMainWindow(); window.show(); window.focus(); },
    hide() { if (mainWindowOpen) mainWindow.hide(); },
    quit() { quitting = true; app.quit(); },
  };

  app.on('before-quit', () => { quitting = true; });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) setMainWindow(createWindow());
    else application.show();
  });
  app.on('second-instance', () => application.show());
  process.on('message', (message) => {
    if ((message as { type?: unknown } | null)?.type === 'cossack:renderer-reload') {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.reloadIgnoringCache();
    }
  });

  return application;
}

/** Initialize the process-wide Desktop application exactly once. */
export function createDesktopApp(options: CreateDesktopAppOptions): Promise<DesktopApplication> {
  assertElectron();
  return activeApplication ??= initializeDesktopApp(options).catch((error) => {
    activeApplication = undefined;
    throw error;
  });
}
