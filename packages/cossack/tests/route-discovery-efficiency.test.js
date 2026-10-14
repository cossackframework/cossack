import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/scan-routes.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, buildRouteModel: vi.fn(actual.buildRouteModel) };
});

const { buildRouteModel, buildEffectiveRouteModel } = await import('../src/scan-routes.js');
const { routesCommand } = await import('../src/commands/routes.js');

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-route-discovery-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app"}');
  fs.mkdirSync(path.join(root, 'src/pages/about'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/pages/about/index.ts'), '@Page() export default class About extends Cossack {}');
  fs.writeFileSync(path.join(root, 'src/pages/_layout.ts'), '@Page() export default class Layout extends Cossack {}');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('route discovery', () => {
  it('routes runs route discovery once', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(buildRouteModel).mockClear();
    await routesCommand([], { cwd: root, flags: {} });
    // buildEffectiveRouteModel discovers routes internally; the command must not repeat it.
    expect(buildRouteModel).not.toHaveBeenCalled();
  });

  it('reads page and layout sources asynchronously', async () => {
    const readFileSync = vi.spyOn(fs, 'readFileSync');
    await buildEffectiveRouteModel(root);
    const sources = readFileSync.mock.calls.map(([file]) => String(file)).filter(file => file.includes(`${path.sep}src${path.sep}pages${path.sep}`));
    expect(sources).toEqual([]);
  });
});

describe('published files', () => {
  it('ships no unreferenced assets in src/', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const sources = [];
    const assets = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.m?js$/.test(entry.name)) sources.push(fs.readFileSync(full, 'utf8'));
        else if (!entry.name.endsWith('.d.ts') && !entry.name.endsWith('.stub')) assets.push(path.relative(packageRoot, full));
      }
    };
    walk(path.join(packageRoot, 'src'));
    walk(path.join(packageRoot, 'bin'));
    const text = sources.join('\n');
    expect(assets.filter(asset => !text.includes(path.basename(asset)))).toEqual([]);
  });
});
