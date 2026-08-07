import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const api = {
  app: {}, BrowserWindow: {}, dialog: {}, Menu: {}, nativeImage: {}, Notification: {},
  protocol: { registerSchemesAsPrivileged: vi.fn() }, shell: {}, Tray: {},
  };
  return { ...api, default: api };
});

describe('Desktop availability', () => {
  it('throws a named error outside the Electron main process', async () => {
    const {
      createDesktopApp,
      createDesktopShell,
      createDesktopTray,
      configureDesktopClose,
      DesktopUnavailableError,
    } = await import('../src/index');
    expect(() => createDesktopShell()).toThrow(DesktopUnavailableError);
    expect(() => createDesktopTray({ image: 'tray.png' })).toThrow(DesktopUnavailableError);
    expect(() => configureDesktopClose({ behavior: 'quit' })).toThrow(DesktopUnavailableError);
    expect(() => createDesktopApp({
      identifier: 'dev.cossack.test',
      productName: 'Test',
      assetsRoot: '.',
      fetch: async () => new Response(),
    })).toThrow(DesktopUnavailableError);
  });
});
