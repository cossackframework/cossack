import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/desktop-counter');
const text = async (relative: string) => readFile(path.join(root, relative), 'utf8');

describe('Desktop counter example', () => {
  it('uses Node for web, Electron for Desktop, and native-host Forge makers', async () => {
    const pkg = JSON.parse(await text('package.json'));
    expect(pkg.name).toBe('@cossackframework/example-desktop-counter');
    expect(pkg.dependencies['@cossackframework/node-adapter']).toBeDefined();
    expect(pkg.dependencies['@cossackframework/desktop']).toBeDefined();
    expect(pkg.dependencies['@cossackframework/deno-adapter']).toBeUndefined();
    expect(pkg.scripts['desktop:make']).toContain('electron-forge make');
    const forge = await text('forge.config.ts');
    expect(forge).toContain("appBundleId: 'dev.cossack.counter'");
    expect(forge).toContain('MakerDeb');
    expect(forge).toContain('MakerWix');
    expect(forge).toContain('MakerDMG');
  });

  it('shares menu actions, selects close behavior by OS, and persists atomically', async () => {
    const main = await text('src/desktop/index.ts');
    const page = await text('src/pages/index.ts');
    expect(main).toContain("invokeCounterAction('increment')");
    expect(main).toContain("invokeCounterAction('decrement')");
    expect(main).toContain("window.webContents.on('context-menu'");
    expect(main).not.toContain('Inspect');
    expect(main).toContain('let tray: Tray | undefined');
    expect(main).toContain('switch (process.platform)');
    expect(main).toContain("closeBehavior = 'confirm-quit'");
    expect(main).toContain("closeBehavior = tray ? 'hide-to-tray' : 'quit'");
    expect(main).toContain('configureDesktopClose({');
    expect(main).toContain("process.platform === 'darwin' || process.platform === 'win32'");
    expect(page).toContain("app.getPath('userData')");
    expect(page).toContain('await rename(temporary, target)');
    expect(page).toContain('Notification.isSupported()');
    expect(page).toContain('setOverlayIcon');
  });

  it('commits valid platform app and tray icon variants', async () => {
    for (const [name, width] of [
      ['icon-16.png', 16], ['icon-32.png', 32], ['icon-64.png', 64],
      ['icon-128.png', 128], ['icon-256.png', 256], ['icon-512.png', 512],
      ['tray-linux-22.png', 22], ['tray-linux-44.png', 44],
      ['tray-macosTemplate.png', 22], ['tray-macosTemplate@2x.png', 44],
      ['tray-windows-16.png', 16], ['tray-windows-32.png', 32],
    ] as const) {
      const png = await readFile(path.join(root, 'desktop-assets', name));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(width);
      expect(png.readUInt32BE(20)).toBe(width);
      if (name.startsWith('tray-')) {
        expect(png.readUInt8(24)).toBe(8);
        expect(png.readUInt8(25)).toBe(6);
      }
    }
    const ico = await readFile(path.join(root, 'desktop-assets/icon.ico'));
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(6);
    const icns = await readFile(path.join(root, 'desktop-assets/icon.icns'));
    expect(icns.subarray(0, 4).toString()).toBe('icns');
  });
});
