export type DesktopValue =
  | undefined | null | boolean | number | string | Uint8Array
  | DesktopValue[] | { [key: string]: DesktopValue };

export type DesktopBinding = (...args: any[]) => DesktopValue | void | Promise<DesktopValue | void>;
export type DesktopBindingRegistry = Record<string, DesktopBinding>;

export interface DesktopWindow {
  bind(name: string, handler: (...args: any[]) => unknown): void;
  unbind?(name: string): void;
}

const DISPATCH_BINDING = '__cossackDesktopInvoke';
const capabilityToken = crypto.randomUUID();
let activeRegistry: DesktopBindingRegistry | undefined;
let mainWindow: DesktopWindow | undefined;

function denoGlobal(): any {
  return (globalThis as any).Deno;
}

export function isDesktopRuntime(): boolean {
  const deno = denoGlobal();
  return typeof deno?.BrowserWindow === 'function'
    || typeof deno?.desktopVersion === 'string';
}

/** Define the allowlisted desktop surface and attach it to the startup window. */
export function defineDesktopBindings<const Registry extends DesktopBindingRegistry>(registry: Registry): Registry {
  activeRegistry = Object.freeze({ ...registry });
  if (isDesktopRuntime()) {
    const BrowserWindow = denoGlobal()?.BrowserWindow;
    if (typeof BrowserWindow === 'function') {
      const window = mainWindow ??= new BrowserWindow() as DesktopWindow;
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
