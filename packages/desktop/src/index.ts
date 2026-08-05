import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';
import type {
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  NativeImage,
  WebPreferences,
} from 'electron';
import type { CossackRuntimeAdapter } from '@cossackframework/framework/runtime-adapter';
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
      corsEnabled: false,
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
  assetsRoot: string;
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
  readonly mainWindow: BrowserWindow;
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

async function assetResponse(assetsRoot: string, request: Request): Promise<Response | undefined> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (!pathname) return undefined;
  const filePath = containedAssetPath(assetsRoot, pathname);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    const headers = new Headers({
      'content-type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(info.size),
    });
    return new Response(request.method === 'HEAD' ? null : await readFile(filePath), { headers });
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
  return new Request(url, request);
}

function isDesktopAppUrl(url: URL): boolean {
  return url.protocol === `${protocolScheme}:` &&
    url.hostname === 'app' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '';
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
  return {
    app,
    window,
    Menu,
    Tray,
    dialog,
    Notification,
    nativeImage,
    shell: electronShell,
    get dock() { return app.dock; },
    show() { window.show(); },
    hide() { window.hide(); },
    focus() { window.focus(); },
    quit() { app.quit(); },
    setBadge(value) {
      return app.setBadgeCount(value === null ? 0 : typeof value === 'number' ? value : Number(value) || 0);
    },
    setOverlayIcon(image, description = '') {
      window.setOverlayIcon(image, description);
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

  const createWindow = (windowOptions: CreateDesktopWindowOptions = {}): BrowserWindow => {
    const { path: requestedPath = startPath, ...browserOptions } = windowOptions;
    const target = new URL(requestedPath, `${protocolOrigin}/`);
    if (!isDesktopAppUrl(target)) {
      throw new TypeError('Desktop window paths must stay within cossack://app.');
    }
    const window = new BrowserWindow(secureWindowOptions({ ...options.window, ...browserOptions }));
    debugDesktop(`created BrowserWindow ${window.id}`);
    secureWebContents(window);
    target.searchParams.set('__cossack_window', String(window.id));
    void window.loadURL(target.href).then(
      () => debugDesktop(`loaded ${target.href}`),
      (error) => console.error(`[Cossack Desktop] Failed to load ${target.href}`, error),
    );
    window.once('ready-to-show', () => window.show());
    return window;
  };

  await protocol.handle(protocolScheme, async (request) => {
    debugDesktop(`handling ${request.method} ${request.url}`);
    let url: URL;
    try {
      url = new URL(request.url);
      if (!isDesktopAppUrl(url)) return new Response('Forbidden Desktop authority', { status: 403 });
      normalizePathname(url.pathname);
    } catch {
      return new Response('Invalid Desktop URL', { status: 400 });
    }
    const referringUrl = request.headers.get('referer');
    const windowId = new URL(referringUrl || request.url).searchParams.get('__cossack_window');
    const browserWindow = windowId ? BrowserWindow.fromId(Number(windowId)) ?? mainWindow : mainWindow;
    const scopedShell = browserWindow ? createDesktopShell({ window: browserWindow }) : undefined;
    const asset = await assetResponse(assetsRoot, request);
    if (asset) return asset;
    const assets = {
      fetch: async (assetRequest: Request) =>
        await assetResponse(assetsRoot, assetRequest) ?? new Response('Not found', { status: 404 }),
    };
    return options.fetch(toFrameworkRequest(request), {
      ...(options.env ?? {}),
      ASSETS: assets,
      COSSACK_DESKTOP: scopedShell,
    });
  });
  debugDesktop('registered cossack:// protocol handler');

  mainWindow = createWindow();
  const shell = createDesktopShell({ window: mainWindow });
  const application: DesktopApplication = {
    app,
    mainWindow,
    shell,
    get quitting() { return quitting; },
    createWindow,
    show() { mainWindow.show(); mainWindow.focus(); },
    hide() { mainWindow.hide(); },
    quit() { quitting = true; app.quit(); },
  };

  app.on('before-quit', () => { quitting = true; });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
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
