import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const exampleRoot = path.resolve(import.meta.dirname, '../../../examples/deno-desktop-counter');
const expectedSizes = [16, 32, 48, 64, 128, 256, 512];

async function pngSize(file: string): Promise<[number, number]> {
  const bytes = await fs.readFile(file);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('Deno Desktop counter assets', () => {
  it('commits the shared SVG and every configured platform icon', async () => {
    await expect(fs.readFile(path.join(exampleRoot, 'public/logo.svg'), 'utf8'))
      .resolves.toContain('<svg');
    const config = JSON.parse(await fs.readFile(path.join(exampleRoot, 'deno.json'), 'utf8'));
    expect(config.desktop.app.identifier).toBe('dev.cossack.counter');
    expect(config.desktop.app.icons.macos).toEqual(
      expectedSizes.map((size) => ({ path: `./icons/icon-${size}.png`, size })),
    );
    expect(config.desktop.app.icons.windows).toBe('./icons/icon.ico');
    expect(config.desktop.app.icons.linux).toBe('./icons/icon-512.png');
    expect(config.desktop.output.linux).toBe('./dist/cossack-counter.deb');

    const configured = [
      ...config.desktop.app.icons.macos.map((icon: { path: string }) => icon.path),
      config.desktop.app.icons.windows,
      config.desktop.app.icons.linux,
    ];
    for (const relative of configured) {
      await expect(fs.access(path.resolve(exampleRoot, relative))).resolves.toBeUndefined();
    }
  });

  it('has exact PNG dimensions, contrasting transparent tray icons, and all ICO frames', async () => {
    for (const size of expectedSizes) {
      await expect(pngSize(path.join(exampleRoot, `icons/icon-${size}.png`)))
        .resolves.toEqual([size, size]);
    }
    await expect(pngSize(path.join(exampleRoot, 'icons/tray.png'))).resolves.toEqual([22, 22]);
    await expect(pngSize(path.join(exampleRoot, 'icons/tray-dark.png'))).resolves.toEqual([22, 22]);
    const tray = await fs.readFile(path.join(exampleRoot, 'icons/tray.png'));
    const trayDark = await fs.readFile(path.join(exampleRoot, 'icons/tray-dark.png'));
    expect(tray[25] & 4).toBe(4); // PNG color type contains an alpha channel.
    expect(trayDark[25] & 4).toBe(4);
    expect(trayDark).not.toEqual(tray);

    const ico = await fs.readFile(path.join(exampleRoot, 'icons/icon.ico'));
    const count = ico.readUInt16LE(4);
    expect(count).toBe(6);
    const frames = Array.from({ length: count }, (_, index) => {
      const width = ico[6 + index * 16];
      const height = ico[7 + index * 16];
      return [width || 256, height || 256];
    });
    expect(frames).toEqual([16, 32, 48, 64, 128, 256].map((size) => [size, size]));
  });

  it('wires increment and decrement through native and in-page context menus', async () => {
    const desktop = await fs.readFile(path.join(exampleRoot, 'src/desktop/index.ts'), 'utf8');
    const page = await fs.readFile(path.join(exampleRoot, 'src/pages/index.ts'), 'utf8');
    const root = await fs.readFile(path.join(exampleRoot, 'src/root.ts'), 'utf8');

    expect(desktop).toContain("id: 'increment'");
    expect(desktop).toContain("id: 'decrement'");
    expect(desktop).toContain('tray.setIconDark(trayDarkIcon)');
    expect(desktop).toContain('createDenoAdapter({ env, assetsRoot })');
    expect(desktop).toContain("window.setTitle('Cossack Counter')");
    expect(page).toContain("'data-counter-action': 'increment'");
    expect(page).toContain("'data-counter-action': 'decrement'");
    expect(page).toContain('component(ContextMenu');
    expect(page).toContain("{ label: 'Increment count', onClick: this.increment }");
    expect(page).toContain("{ label: 'Decrement count', onClick: this.decrement }");
    expect(root).toContain('<title>Cossack Counter</title>');
  });
});
