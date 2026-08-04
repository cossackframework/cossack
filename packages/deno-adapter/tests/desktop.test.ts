import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachDesktopBindings, defineDesktopBindings, getDesktopClientMetadata, isDesktopRuntime } from '../src/desktop';
import { createDesktopClient, DesktopUnavailableError } from '../src/desktop-client';

class FakeWindow {
  handlers = new Map<string, (...args: any[]) => unknown>();
  bind(name: string, handler: (...args: any[]) => unknown) { this.handlers.set(name, handler); }
  unbind(name: string) { this.handlers.delete(name); }
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as any).bindings;
});

describe('desktop bindings', () => {
  it('registers an allowlist per window and rejects invalid capabilities', async () => {
    const registry = defineDesktopBindings({
      add: (a: number, b: number) => a + b,
      bytes: (value: Uint8Array) => value,
    });
    const window = new FakeWindow();
    attachDesktopBindings(window, registry);
    const dispatch = window.handlers.get('__cossackDesktopInvoke')!;
    await expect(dispatch('wrong', 'add', [1, 2])).rejects.toThrow('token rejected');
    vi.stubGlobal('Deno', { desktopVersion: '2.9.0' });
    const metadata = getDesktopClientMetadata() as any;
    await expect(dispatch(metadata.desktop.capabilityToken, 'add', [1, 2])).resolves.toBe(3);
    const bytes = new Uint8Array([1, 2]);
    await expect(dispatch(metadata.desktop.capabilityToken, 'bytes', [bytes])).resolves.toBe(bytes);
    await expect(dispatch(metadata.desktop.capabilityToken, 'missing', [])).rejects.toThrow('not registered');
  });

  it('is unavailable in a normal browser and normalizes native errors', async () => {
    vi.stubGlobal('window', { __INITIAL_STATE__: {} });
    const unavailable = createDesktopClient<{ fail(): never }>();
    expect(unavailable.available).toBe(false);
    await expect(unavailable.invoke('fail')).rejects.toBeInstanceOf(DesktopUnavailableError);

    (globalThis as any).window.__INITIAL_STATE__ = {
      runtime: { desktop: { available: true, capabilityToken: 'token' } },
    };
    (globalThis as any).bindings = {
      __cossackDesktopInvoke: async () => { throw { name: 'NativeFailure', message: 'boom' }; },
    };
    const available = createDesktopClient<{ fail(): never }>();
    expect(available.available).toBe(true);
    await expect(available.invoke('fail')).rejects.toMatchObject({ name: 'NativeFailure', message: 'boom' });
  });

  it('detects Deno Desktop from its window API or a configured desktop version', () => {
    expect(isDesktopRuntime()).toBe(false);
    vi.stubGlobal('Deno', { BrowserWindow: class {} });
    expect(isDesktopRuntime()).toBe(true);
    vi.stubGlobal('Deno', {});
    expect(isDesktopRuntime()).toBe(false);
    vi.stubGlobal('Deno', { desktopVersion: '2.9.0' });
    expect(isDesktopRuntime()).toBe(true);
  });
});
