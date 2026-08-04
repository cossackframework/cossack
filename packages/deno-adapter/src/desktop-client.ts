import type { DesktopBindingRegistry } from './desktop.js';
import { DesktopUnavailableError } from './desktop-error.js';
export { DesktopUnavailableError };

type AwaitedReturn<Fn> = Fn extends (...args: any[]) => infer Result ? Awaited<Result> : never;
type BindingArgs<Fn> = Fn extends (...args: infer Args) => any ? Args : never;

interface NativeBindings {
  __cossackDesktopInvoke(token: string, name: string, args: unknown[]): Promise<unknown>;
}

export interface DesktopClient<Registry extends DesktopBindingRegistry> {
  readonly available: boolean;
  invoke<Name extends Extract<keyof Registry, string>>(
    name: Name,
    ...args: BindingArgs<Registry[Name]>
  ): Promise<AwaitedReturn<Registry[Name]>>;
}

function runtimeDesktopMetadata(): { available?: boolean; capabilityToken?: string } | undefined {
  return (globalThis as any).window?.__INITIAL_STATE__?.runtime?.desktop;
}

function normalizeNativeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const value = error as { name?: unknown; message?: unknown; stack?: unknown };
    const normalized = new Error(typeof value.message === 'string' ? value.message : 'Desktop binding failed');
    normalized.name = typeof value.name === 'string' ? value.name : 'Error';
    if (typeof value.stack === 'string') normalized.stack = value.stack;
    return normalized;
  }
  return new Error(String(error));
}

export function createDesktopClient<Registry extends DesktopBindingRegistry>(): DesktopClient<Registry> {
  const metadata = runtimeDesktopMetadata();
  const nativeBindings = (globalThis as any).bindings as NativeBindings | undefined;
  const available = metadata?.available === true && typeof metadata.capabilityToken === 'string' &&
    typeof nativeBindings?.__cossackDesktopInvoke === 'function';

  return {
    available,
    async invoke(name, ...args) {
      if (!available) throw new DesktopUnavailableError();
      try {
        return await nativeBindings!.__cossackDesktopInvoke(
          metadata!.capabilityToken!, String(name), args,
        ) as AwaitedReturn<Registry[typeof name]>;
      } catch (error) {
        throw normalizeNativeError(error);
      }
    },
  };
}
