import { DesktopUnavailableError } from './desktop-error.js';

export { DesktopUnavailableError } from './desktop-error.js';

export type DesktopValue =
  | undefined | null | boolean | number | string | Uint8Array
  | DesktopValue[] | { [key: string]: DesktopValue };

export type DesktopBinding = (...args: any[]) => DesktopValue | void | Promise<DesktopValue | void>;
export type DesktopBindingRegistry = Record<string, DesktopBinding>;

export interface DesktopWindow {
  bind(name: string, handler: (...args: any[]) => unknown): void;
  unbind?(name: string): void;
}

export type DesktopMenuItem =
  | {
    item: {
      label: string;
      id?: string;
      accelerator?: string;
      enabled: boolean;
    };
  }
  | {
    submenu: {
      label: string;
      items: DesktopMenuItem[];
    };
  }
  | 'separator'
  | { role: { role: string } };

export interface DesktopMenuEventDetail {
  id: string;
}

export interface DesktopMenuEvent extends Event {
  readonly detail: DesktopMenuEventDetail;
}

export interface DesktopWindowResizeEvent extends Event {
  readonly detail: { width: number; height: number };
}

export interface DesktopWindowMoveEvent extends Event {
  readonly detail: { x: number; y: number };
}

export interface DesktopDockReopenEvent extends Event {
  readonly detail: { hasVisibleWindows: boolean };
}

export interface DesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopShellWindow extends DesktopWindow {
  readonly windowId: number;
  setApplicationMenu(menu: DesktopMenuItem[]): void;
  showContextMenu(x: number, y: number, menu: DesktopMenuItem[]): void;
  show(): void;
  hide(): void;
  focus(): void;
  close(): void;
  reload(): void;
  isClosed(): boolean;
  isVisible(): boolean;
  getSize(): [number, number];
  setSize(width: number, height: number): void;
  getPosition(): [number, number];
  setPosition(x: number, y: number): void;
  isResizable(): boolean;
  setResizable(resizable: boolean): void;
  isAlwaysOnTop(): boolean;
  setAlwaysOnTop(alwaysOnTop: boolean): void;
  getOpacity(): number;
  setOpacity(opacity: number): void;
  setTitle(title: string): void;
  navigate(url: string): void;
  executeJs(script: string): Promise<DesktopValue>;
  openDevtools(options?: { deno?: boolean; renderer?: boolean }): void;
  getNativeWindow(): unknown;
  destroy(): void;
  addEventListener(type: 'menuclick' | 'contextmenuclick', listener: (event: DesktopMenuEvent) => void, options?: unknown): void;
  addEventListener(type: 'resize', listener: (event: DesktopWindowResizeEvent) => void, options?: unknown): void;
  addEventListener(type: 'move', listener: (event: DesktopWindowMoveEvent) => void, options?: unknown): void;
  addEventListener(type: string, listener: (event: any) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: any) => void, options?: unknown): void;
}

export interface DesktopTrayPanelOptions {
  url?: string;
  width?: number;
  height?: number;
  hideOnBlur?: boolean;
  position?: (
    trayBounds: DesktopBounds,
    panelSize: { width: number; height: number },
  ) => { x: number; y: number };
}

export interface DesktopTrayPanel {
  readonly window: DesktopShellWindow;
  readonly visible: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  destroy(): void;
}

export interface DesktopTray {
  readonly trayId: number;
  setIcon(icon: Uint8Array): void;
  setIconDark(icon: Uint8Array | null): void;
  setTooltip(tooltip: string | null): void;
  setMenu(menu: DesktopMenuItem[] | null): void;
  getBounds(): DesktopBounds | null;
  attachPanel(options: string | DesktopTrayPanelOptions): DesktopTrayPanel;
  destroy(): void;
  addEventListener(type: 'click' | 'dblclick', listener: (event: Event) => void, options?: unknown): void;
  addEventListener(type: 'menuclick', listener: (event: DesktopMenuEvent) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: any) => void, options?: unknown): void;
  [Symbol.dispose]?(): void;
}

export interface DesktopDock {
  setBadge(value: string | null): void;
  bounce(critical?: boolean): void;
  setVisible(visible: boolean): void;
  setMenu(menu: DesktopMenuItem[] | null): void;
  addEventListener(type: 'menuclick', listener: (event: DesktopMenuEvent) => void, options?: unknown): void;
  addEventListener(type: 'reopen', listener: (event: DesktopDockReopenEvent) => void, options?: unknown): void;
  removeEventListener(type: 'menuclick' | 'reopen', listener: (event: any) => void, options?: unknown): void;
}

export interface DesktopDialogs {
  alert(message?: unknown): void;
  confirm(message?: string): boolean;
  prompt(message?: string, defaultValue?: string): string | null;
}

export type DesktopNotificationPermission = 'default' | 'denied' | 'granted';

export interface DesktopNotificationOptions {
  body?: string;
  icon?: string;
  tag?: string;
  requireInteraction?: boolean;
  silent?: boolean | null;
  badge?: string;
  dir?: 'auto' | 'ltr' | 'rtl';
  lang?: string;
  data?: unknown;
}

export interface DesktopNotification extends EventTarget {
  readonly title: string;
  readonly body: string;
  readonly data: unknown;
  readonly dir: 'auto' | 'ltr' | 'rtl';
  readonly lang: string;
  readonly tag: string;
  readonly icon: string;
  readonly badge: string;
  readonly requireInteraction: boolean;
  readonly silent: boolean | null;
  onclick: ((this: DesktopNotification, event: Event) => unknown) | null;
  onshow: ((this: DesktopNotification, event: Event) => unknown) | null;
  onclose: ((this: DesktopNotification, event: Event) => unknown) | null;
  onerror: ((this: DesktopNotification, event: Event) => unknown) | null;
  close(): void;
}

export interface DesktopNotifications {
  readonly permission: DesktopNotificationPermission;
  requestPermission(): Promise<DesktopNotificationPermission>;
  show(title: string, options?: DesktopNotificationOptions): DesktopNotification;
}

export interface DesktopShell {
  readonly available: boolean;
  readonly window: DesktopShellWindow | undefined;
  createTray(): DesktopTray;
  readonly dock: DesktopDock;
  readonly dialogs: DesktopDialogs;
  readonly notifications: DesktopNotifications;
}

export interface DesktopShellOptions {
  window?: DesktopShellWindow;
}

const DISPATCH_BINDING = '__cossackDesktopInvoke';
const capabilityToken = crypto.randomUUID();
let activeRegistry: DesktopBindingRegistry | undefined;
let mainWindow: DesktopWindow | undefined;
let mainWindowConstructor: unknown;

function denoGlobal(): any {
  return (globalThis as any).Deno;
}

export function isDesktopRuntime(): boolean {
  const deno = denoGlobal();
  return typeof deno?.BrowserWindow === 'function'
    || typeof deno?.desktopVersion === 'string';
}

function unavailable(): never {
  throw new DesktopUnavailableError();
}

function adoptStartupWindow(): DesktopShellWindow | undefined {
  const BrowserWindow = denoGlobal()?.BrowserWindow;
  if (typeof BrowserWindow !== 'function') return undefined;
  if (!mainWindow || mainWindowConstructor !== BrowserWindow) {
    mainWindow = new BrowserWindow() as DesktopShellWindow;
    mainWindowConstructor = BrowserWindow;
  }
  return mainWindow as DesktopShellWindow;
}

/** Create a Deno-side façade over the native Desktop shell APIs. */
export function createDesktopShell(options: DesktopShellOptions = {}): DesktopShell {
  const available = isDesktopRuntime();
  const deno = denoGlobal();
  const window = available ? options.window ?? adoptStartupWindow() : undefined;

  const dock = new Proxy({} as DesktopDock, {
    get(_target, property) {
      const nativeDock = deno?.dock;
      if (!available || !nativeDock) return unavailable();
      if (property === 'setBadge') {
        return (value: string | null) => {
          // Deno 2.9's native binding declares null as supported, but its Rust
          // op accepts a string and coerces null to "null". Linux displays that
          // as a title badge, producing `(null) …`; the documented empty-string
          // form clears the badge without that coercion.
          nativeDock.setBadge(value ?? '');
        };
      }
      const value = nativeDock[property];
      return typeof value === 'function' ? value.bind(nativeDock) : value;
    },
  });

  const dialogs: DesktopDialogs = {
    alert(message) {
      if (!available) return unavailable();
      globalThis.alert(message);
    },
    confirm(message) {
      if (!available) return unavailable();
      return globalThis.confirm(message);
    },
    prompt(message, defaultValue) {
      if (!available) return unavailable();
      return globalThis.prompt(message, defaultValue);
    },
  };

  const notifications: DesktopNotifications = {
    get permission() {
      const NativeNotification = (globalThis as any).Notification;
      if (!available || typeof NativeNotification !== 'function') return unavailable();
      return NativeNotification.permission as DesktopNotificationPermission;
    },
    async requestPermission() {
      const NativeNotification = (globalThis as any).Notification;
      if (!available || typeof NativeNotification?.requestPermission !== 'function') return unavailable();
      return await NativeNotification.requestPermission() as DesktopNotificationPermission;
    },
    show(title, notificationOptions) {
      const NativeNotification = (globalThis as any).Notification;
      if (!available || typeof NativeNotification !== 'function') return unavailable();
      return new NativeNotification(title, notificationOptions) as DesktopNotification;
    },
  };

  return {
    available,
    window,
    createTray() {
      const Tray = deno?.Tray;
      if (!available || typeof Tray !== 'function') return unavailable();
      return new Tray() as DesktopTray;
    },
    dock,
    dialogs,
    notifications,
  };
}

/** Define the allowlisted desktop surface and attach it to the startup window. */
export function defineDesktopBindings<const Registry extends DesktopBindingRegistry>(registry: Registry): Registry {
  activeRegistry = Object.freeze({ ...registry });
  if (isDesktopRuntime()) {
    const BrowserWindow = denoGlobal()?.BrowserWindow;
    if (typeof BrowserWindow === 'function') {
      const window = adoptStartupWindow()!;
      attachDesktopBindings(window, activeRegistry);
    }
  }
  return registry;
}

/** Attach the current allowlist to an explicitly-created additional window. */
export function attachDesktopBindings<Registry extends DesktopBindingRegistry>(
  window: DesktopWindow,
  registry: Registry,
): void {
  const allowlist = Object.freeze({ ...registry });
  window.unbind?.(DISPATCH_BINDING);
  window.bind(DISPATCH_BINDING, async (token: unknown, name: unknown, args: unknown) => {
    if (token !== capabilityToken) throw new Error('Desktop capability token rejected');
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(allowlist, name)) {
      throw new Error(`Desktop binding '${String(name)}' is not registered`);
    }
    if (!Array.isArray(args)) throw new TypeError('Desktop binding arguments must be an array');
    return await allowlist[name]!(...args);
  });
}

/** @internal Metadata injected into SSR state by the Deno runtime adapter. */
export function getDesktopClientMetadata(): Record<string, unknown> {
  return activeRegistry && isDesktopRuntime()
    ? { desktop: { available: true, capabilityToken } }
    : { desktop: { available: false } };
}
