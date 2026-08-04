import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachDesktopBindings,
  createDesktopShell,
  defineDesktopBindings,
  getDesktopClientMetadata,
  isDesktopRuntime,
  type DesktopMenuItem,
} from '../src/desktop';
import { createDesktopClient, DesktopUnavailableError } from '../src/desktop-client';

class FakeWindow {
  windowId = 1;
  handlers = new Map<string, (...args: any[]) => unknown>();
  events = new EventTarget();
  applicationMenu: DesktopMenuItem[] | null = null;
  contextMenu: { x: number; y: number; menu: DesktopMenuItem[] } | undefined;
  visible = true;
  bind(name: string, handler: (...args: any[]) => unknown) { this.handlers.set(name, handler); }
  unbind(name: string) { this.handlers.delete(name); }
  setApplicationMenu(menu: DesktopMenuItem[] | null) { this.applicationMenu = menu; }
  showContextMenu(x: number, y: number, menu: DesktopMenuItem[]) { this.contextMenu = { x, y, menu }; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() {}
  close() { this.visible = false; }
  reload() {}
  isClosed() { return false; }
  isVisible() { return this.visible; }
  getSize(): [number, number] { return [800, 600]; }
  setSize() {}
  getPosition(): [number, number] { return [0, 0]; }
  setPosition() {}
  isResizable() { return true; }
  setResizable() {}
  isAlwaysOnTop() { return false; }
  setAlwaysOnTop() {}
  getOpacity() { return 1; }
  setOpacity() {}
  setTitle() {}
  navigate() {}
  async executeJs() { return undefined; }
  openDevtools() {}
  getNativeWindow() { return {}; }
  destroy() {}
  addEventListener(type: string, listener: EventListener) { this.events.addEventListener(type, listener); }
  removeEventListener(type: string, listener: EventListener) { this.events.removeEventListener(type, listener); }
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

describe('desktop shell', () => {
  it('adopts the startup window once and scopes explicit additional windows', () => {
    let constructions = 0;
    class BrowserWindow extends FakeWindow {
      constructor() {
        super();
        constructions += 1;
      }
    }
    vi.stubGlobal('Deno', { BrowserWindow, desktopVersion: '2.9.0' });

    const first = createDesktopShell();
    const second = createDesktopShell();
    expect(first.available).toBe(true);
    expect(first.window).toBe(second.window);
    expect(constructions).toBe(1);

    defineDesktopBindings({ ping: () => 'pong' });
    expect(constructions).toBe(1);
    expect((first.window as FakeWindow).handlers.has('__cossackDesktopInvoke')).toBe(true);

    const additional = new FakeWindow();
    const scoped = createDesktopShell({ window: additional as any });
    expect(scoped.window).toBe(additional);
    expect(constructions).toBe(1);
  });

  it('preserves native menu, context-menu, tray, panel, and unsupported tray behavior', () => {
    class FakePanel {
      window = new FakeWindow();
      visible = false;
      show() { this.visible = true; }
      hide() { this.visible = false; }
      toggle() { this.visible = !this.visible; }
      destroy = vi.fn();
    }
    class FakeTray extends EventTarget {
      static nextId = 7;
      trayId = FakeTray.nextId;
      icon?: Uint8Array;
      darkIcon?: Uint8Array | null;
      tooltip?: string | null;
      menu?: DesktopMenuItem[] | null;
      destroyed = false;
      panel = new FakePanel();
      setIcon(value: Uint8Array) { this.icon = value; }
      setIconDark(value: Uint8Array | null) { this.darkIcon = value; }
      setTooltip(value: string | null) { this.tooltip = value; }
      setMenu(value: DesktopMenuItem[] | null) { this.menu = value; }
      getBounds() { return { x: 1, y: 2, width: 22, height: 22 }; }
      attachPanel() { return this.panel; }
      destroy() { this.destroyed = true; }
    }
    vi.stubGlobal('Deno', {
      desktopVersion: '2.9.0',
      BrowserWindow: FakeWindow,
      Tray: FakeTray,
      dock: {},
    });
    const shell = createDesktopShell();
    const menu: DesktopMenuItem[] = [{ item: { label: 'Show', id: 'show', enabled: true } }];
    shell.window!.setApplicationMenu(menu);
    shell.window!.showContextMenu(4, 5, menu);
    expect((shell.window as FakeWindow).applicationMenu).toBe(menu);
    expect((shell.window as FakeWindow).contextMenu).toEqual({ x: 4, y: 5, menu });

    const tray = shell.createTray() as FakeTray;
    const icon = new Uint8Array([1, 2, 3]);
    const darkIcon = new Uint8Array([4, 5, 6]);
    tray.setIcon(icon);
    tray.setIconDark(darkIcon);
    tray.setTooltip('Counter');
    tray.setMenu(menu);
    expect(tray.trayId).toBe(7);
    expect(tray.icon).toBe(icon);
    expect(tray.darkIcon).toBe(darkIcon);
    expect(tray.tooltip).toBe('Counter');
    expect(tray.menu).toBe(menu);
    expect(tray.getBounds()).toEqual({ x: 1, y: 2, width: 22, height: 22 });
    const panel = tray.attachPanel({ url: '/panel', width: 360 });
    panel.show();
    expect(panel.visible).toBe(true);
    panel.toggle();
    expect(panel.visible).toBe(false);
    panel.destroy();
    expect((panel as FakePanel).destroy).toHaveBeenCalled();
    tray.destroy();
    expect(tray.destroyed).toBe(true);

    FakeTray.nextId = 0;
    expect(shell.createTray().trayId).toBe(0);
  });

  it('delegates Dock calls and reopen events without changing platform no-op semantics', () => {
    class FakeDock extends EventTarget {
      badge: string | null = null;
      visible = true;
      menu: DesktopMenuItem[] | null = null;
      bounces: boolean[] = [];
      setBadge(value: string | null) { this.badge = value; }
      bounce(critical = false) { this.bounces.push(critical); }
      setVisible(value: boolean) { this.visible = value; }
      setMenu(value: DesktopMenuItem[] | null) { this.menu = value; }
    }
    const dock = new FakeDock();
    vi.stubGlobal('Deno', { desktopVersion: '2.9.0', BrowserWindow: FakeWindow, dock });
    const shell = createDesktopShell();
    const menu: DesktopMenuItem[] = ['separator'];
    const reopen = vi.fn();
    const menuClick = vi.fn();
    shell.dock.setBadge('3');
    expect(dock.badge).toBe('3');
    shell.dock.setBadge(null);
    shell.dock.bounce(true);
    shell.dock.setVisible(false);
    shell.dock.setMenu(menu);
    shell.dock.addEventListener('menuclick', menuClick);
    shell.dock.addEventListener('reopen', reopen);
    dock.dispatchEvent(new CustomEvent('menuclick', { detail: { id: 'show' } }));
    dock.dispatchEvent(new Event('reopen'));
    expect(dock.badge).toBe('');
    expect(dock.bounces).toEqual([true]);
    expect(dock.visible).toBe(false);
    expect(dock.menu).toBe(menu);
    expect(menuClick).toHaveBeenCalledOnce();
    expect(reopen).toHaveBeenCalledOnce();
  });

  it('delegates native dialogs and explicit notification permission and lifecycle', async () => {
    class FakeNotification extends EventTarget {
      static permission = 'default';
      static requestPermission = vi.fn(async () => {
        FakeNotification.permission = 'granted';
        return 'granted';
      });
      closed = false;
      constructor(public title: string, public options: Record<string, unknown> = {}) { super(); }
      close() { this.closed = true; this.dispatchEvent(new Event('close')); }
    }
    const alert = vi.fn();
    const confirm = vi.fn(() => true);
    const prompt = vi.fn(() => 'Cossack');
    vi.stubGlobal('Deno', { desktopVersion: '2.9.0', BrowserWindow: FakeWindow, dock: {} });
    vi.stubGlobal('alert', alert);
    vi.stubGlobal('confirm', confirm);
    vi.stubGlobal('prompt', prompt);
    vi.stubGlobal('Notification', FakeNotification);

    const shell = createDesktopShell();
    shell.dialogs.alert('Saved');
    expect(shell.dialogs.confirm('Reset?')).toBe(true);
    expect(shell.dialogs.prompt('Name?', 'App')).toBe('Cossack');
    expect(alert).toHaveBeenCalledWith('Saved');
    expect(confirm).toHaveBeenCalledWith('Reset?');
    expect(prompt).toHaveBeenCalledWith('Name?', 'App');

    expect(shell.notifications.permission).toBe('default');
    await expect(shell.notifications.requestPermission()).resolves.toBe('granted');
    expect(shell.notifications.permission).toBe('granted');
    const notification = shell.notifications.show('Count', { body: '3' }) as FakeNotification;
    const clicked = vi.fn();
    const closed = vi.fn();
    notification.addEventListener('click', clicked);
    notification.addEventListener('close', closed);
    notification.dispatchEvent(new Event('click'));
    notification.close();
    expect(notification.title).toBe('Count');
    expect(notification.options).toEqual({ body: '3' });
    expect(clicked).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
    expect(notification.closed).toBe(true);
  });

  it('normalizes every native operation outside Deno Desktop', async () => {
    const shell = createDesktopShell();
    expect(shell.available).toBe(false);
    expect(shell.window).toBeUndefined();
    expect(() => shell.createTray()).toThrow(DesktopUnavailableError);
    expect(() => shell.dock.setBadge('1')).toThrow(DesktopUnavailableError);
    expect(() => shell.dialogs.alert('nope')).toThrow(DesktopUnavailableError);
    expect(() => shell.notifications.permission).toThrow(DesktopUnavailableError);
    await expect(shell.notifications.requestPermission()).rejects.toBeInstanceOf(DesktopUnavailableError);
    expect(() => shell.notifications.show('nope')).toThrow(DesktopUnavailableError);
  });
});
