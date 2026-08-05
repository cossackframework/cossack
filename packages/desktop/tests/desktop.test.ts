import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({
  execFile: vi.fn((
    _file: string,
    _args: readonly string[],
    _options: object,
    callback: (error: Error | null) => void,
  ) => callback(null)),
}));

const electron = vi.hoisted(() => {
  class Emitter {
    private listeners = new Map<string, Array<(...args: any[]) => void>>();
    on(name: string, listener: (...args: any[]) => void) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      return this;
    }
    once(name: string, listener: (...args: any[]) => void) { return this.on(name, listener); }
    removeListener(name: string, listener: (...args: any[]) => void) {
      this.listeners.set(name, (this.listeners.get(name) ?? []).filter((entry) => entry !== listener));
      return this;
    }
    emit(name: string, ...args: any[]) {
      for (const listener of this.listeners.get(name) ?? []) listener(...args);
      return true;
    }
  }
  const events: string[] = [];
  let protocolHandler: ((request: Request) => Promise<Response>) | undefined;
  const windows: FakeBrowserWindow[] = [];
  const trays: FakeTray[] = [];

  class FakeWebContents extends Emitter {
    openHandler?: (details: { url: string }) => { action: string };
    reloadIgnoringCache = vi.fn();
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
      this.openHandler = handler;
    }
  }

  class FakeBrowserWindow extends Emitter {
    static getFocusedWindow = vi.fn(() => windows[0]);
    static getAllWindows = vi.fn(() => windows);
    static fromId = vi.fn((id: number) => windows.find((window) => window.id === id));
    readonly id = windows.length + 1;
    readonly webContents = new FakeWebContents();
    readonly options: Record<string, unknown>;
    loadURL = vi.fn(async () => {});
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    setOverlayIcon = vi.fn();
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      windows.push(this);
    }
  }

  class FakeTray extends Emitter {
    destroyed = false;
    readonly image: unknown;
    readonly guid: string | undefined;
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    isDestroyed = vi.fn(() => this.destroyed);
    destroy = vi.fn(() => { this.destroyed = true; });
    constructor(image: unknown, guid?: string) {
      super();
      this.image = image;
      this.guid = guid;
      trays.push(this);
    }
  }

  const app = Object.assign(new Emitter(), {
    dock: undefined,
    commandLine: {
      appendSwitch: vi.fn(),
      getSwitchValue: vi.fn(() => ''),
      hasSwitch: vi.fn(() => false),
      removeSwitch: vi.fn(),
    },
    setName: vi.fn(),
    getName: vi.fn(() => 'Test Desktop'),
    setAppUserModelId: vi.fn(),
    setBadgeCount: vi.fn(() => true),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(async () => { events.push('ready'); }),
    quit: vi.fn(),
  });

  const api = {
    events,
    windows,
    trays,
    app,
    BrowserWindow: FakeBrowserWindow,
    dialog: { showMessageBox: vi.fn() },
    Menu: class {},
    nativeImage: {},
    Notification: class {},
    protocol: {
      registerSchemesAsPrivileged: vi.fn(() => events.push('register')),
      handle: vi.fn(async (_scheme: string, handler: (request: Request) => Promise<Response>) => {
        protocolHandler = handler;
      }),
      invoke(request: Request) {
        if (!protocolHandler) throw new Error('protocol not initialized');
        return protocolHandler(request);
      },
    },
    shell: { openExternal: vi.fn(async () => {}) },
    Tray: FakeTray,
  };
  return { ...api, default: api };
});

vi.mock('electron', () => electron);
vi.mock('node:child_process', () => childProcess);

let desktop: typeof import('../src/index');
let assetsRoot: string;

beforeAll(async () => {
  Object.defineProperty(process.versions, 'electron', { value: '43.3.0', configurable: true });
  assetsRoot = await mkdtemp(path.join(tmpdir(), 'cossack-desktop-'));
  await writeFile(path.join(assetsRoot, 'app.js'), 'console.log("desktop")');
  desktop = await import('../src/index');
});

afterAll(async () => {
  delete (process.versions as Record<string, string | undefined>).electron;
  await rm(assetsRoot, { recursive: true, force: true });
});

describe('Electron Desktop runtime', () => {
  it('reports the Electron Desktop runtime and its HTTP-only transport', () => {
    expect(desktop.electronRuntimeAdapter.getClientMetadata()).toEqual({
      platform: 'desktop',
      adapter: 'electron',
    });
    expect(desktop.electronRuntimeAdapter.supportedTransports).toEqual(['http']);
  });

  it('creates a native tray and repairs Ubuntu StatusNotifier registration', async () => {
    vi.useFakeTimers();
    try {
      const menu = {} as import('electron').Menu;
      const tray = desktop.createDesktopTray({
        image: '/tmp/tray.png',
        menu,
        toolTip: 'Test tray',
      });
      expect(electron.trays).toContain(tray);
      expect(tray.setToolTip).toHaveBeenCalledWith('Test tray');
      expect(tray.setContextMenu).toHaveBeenCalledWith(menu);

      await vi.advanceTimersByTimeAsync(4_000);
      if (process.platform === 'linux') {
        expect(childProcess.execFile).toHaveBeenCalledWith(
          'dbus-send',
          expect.arrayContaining([
            '--print-reply',
            '--dest=org.kde.StatusNotifierWatcher',
            expect.stringMatching(/^string:org\.freedesktop\.StatusNotifierItem-\d+-1$/),
          ]),
          { timeout: 2_000 },
          expect.any(Function),
        );
      } else {
        expect(childProcess.execFile).not.toHaveBeenCalled();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('configures quit, hide-to-tray, and confirm-quit close policies', async () => {
    const quitWindow = new electron.BrowserWindow({});
    const quit = vi.fn();
    const quitController = desktop.configureDesktopClose({
      window: quitWindow,
      behavior: 'quit',
      onQuit: quit,
    });
    const quitEvent = { preventDefault: vi.fn() };
    quitWindow.emit('close', quitEvent);
    expect(quitEvent.preventDefault).toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
    quitController.dispose();

    const trayWindow = new electron.BrowserWindow({});
    const tray = new electron.Tray('/tmp/tray.png');
    const trayFallbackQuit = vi.fn();
    desktop.configureDesktopClose({
      window: trayWindow,
      behavior: 'hide-to-tray',
      tray,
      onQuit: trayFallbackQuit,
    });
    trayWindow.emit('close', { preventDefault: vi.fn() });
    expect(trayWindow.hide).toHaveBeenCalled();
    expect(trayFallbackQuit).not.toHaveBeenCalled();
    tray.destroy();
    trayWindow.emit('close', { preventDefault: vi.fn() });
    expect(trayFallbackQuit).toHaveBeenCalledOnce();
    expect(() => desktop.configureDesktopClose({
      window: new electron.BrowserWindow({}),
      behavior: 'hide-to-tray',
    })).toThrow('requires a tray');

    const confirmWindow = new electron.BrowserWindow({});
    const confirmedQuit = vi.fn();
    electron.dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 0 });
    desktop.configureDesktopClose({
      window: confirmWindow,
      behavior: 'confirm-quit',
      confirmation: { message: 'Close this test?' },
      onQuit: confirmedQuit,
    });
    confirmWindow.emit('close', { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmedQuit).not.toHaveBeenCalled();
    confirmWindow.emit('close', { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(confirmedQuit).toHaveBeenCalledOnce());
    expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(
      confirmWindow,
      expect.objectContaining({ message: 'Close this test?', buttons: ['Quit', 'Cancel'] }),
    );
  });

  it('registers its secure standard scheme before Electron becomes ready', () => {
    expect(electron.protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      expect.objectContaining({
        scheme: 'cossack',
        privileges: expect.objectContaining({ standard: true, secure: true, supportFetchAPI: true }),
      }),
    ]);
    expect(electron.events[0]).toBe('register');
  });

  it('serves assets and routes SSR/RPC with reserved Desktop bindings', async () => {
    const fetch = vi.fn(async (_request: Request, env?: Record<string, unknown>) =>
      Response.json({ desktop: Boolean(env?.COSSACK_DESKTOP), assets: Boolean(env?.ASSETS) }));
    await desktop.createDesktopApp({
      identifier: 'dev.cossack.test',
      productName: 'Test Desktop',
      assetsRoot,
      fetch,
      env: { TEST: true, COSSACK_DESKTOP: 'cannot override' },
    });

    const asset = await electron.protocol.invoke(new Request('cossack://app/app.js'));
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await asset.text()).toContain('desktop');

    const response = await electron.protocol.invoke(new Request('cossack://app/counter', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }));
    expect(await response.json()).toEqual({ desktop: true, assets: true });
    expect(fetch.mock.calls[0]?.[0].url).toBe('https://app/counter');
  });

  it('rejects foreign authorities and unsafe paths', async () => {
    expect((await electron.protocol.invoke(new Request('cossack://other/app.js'))).status).toBe(403);
    expect((await electron.protocol.invoke(new Request('cossack://app/%5Coutside'))).status).toBe(400);
  });

  it('forces secure BrowserWindow defaults and denies untrusted navigation', () => {
    const window = electron.windows.find((entry) => 'webPreferences' in entry.options);
    expect(window).toBeDefined();
    if (!window) return;
    expect(window.options).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        webviewTag: false,
        preload: undefined,
      },
    });

    const preventDefault = vi.fn();
    window.webContents.emit('will-navigate', { preventDefault }, 'cossack://app/settings');
    expect(preventDefault).not.toHaveBeenCalled();
    window.webContents.emit('will-navigate', { preventDefault }, 'https://example.com');
    expect(preventDefault).toHaveBeenCalled();
    expect(window.webContents.openHandler?.({ url: 'https://example.com' })).toEqual({ action: 'deny' });
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.com/');
    expect(window.webContents.openHandler?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
  });

  it('creates window-scoped shells and additional secure windows', async () => {
    const application = await desktop.createDesktopApp({
      identifier: 'dev.cossack.windows',
      productName: 'Windows',
      assetsRoot,
      fetch: async () => new Response('ok'),
    });
    const sameApplication = await desktop.createDesktopApp({
      identifier: 'ignored.after.singleton',
      productName: 'Ignored',
      assetsRoot,
      fetch: async () => new Response('ignored'),
    });
    expect(sameApplication).toBe(application);
    const additional = application.createWindow({ path: '/settings', width: 640 });
    expect(application.shell.window).toBe(application.mainWindow);
    expect(desktop.createDesktopShell({ window: additional }).window).toBe(additional);
    const shell = desktop.createDesktopShell({ window: additional });
    expect(shell.dialog).toBe(electron.dialog);
    expect(shell.Notification).toBe(electron.Notification);
    expect(shell.setBadge('7')).toBe(true);
    expect(electron.app.setBadgeCount).toHaveBeenCalledWith(7);
    shell.setOverlayIcon(null, 'cleared');
    expect(additional.setOverlayIcon).toHaveBeenCalledWith(null, 'cleared');
    expect(additional.options).toMatchObject({ width: 640, webPreferences: { sandbox: true } });
    expect(() => application.createWindow({ path: 'https://example.com' }))
      .toThrow('must stay within cossack://app');
    application.quit();
    expect(application.quitting).toBe(true);
    expect(electron.app.quit).toHaveBeenCalled();
  });
});
