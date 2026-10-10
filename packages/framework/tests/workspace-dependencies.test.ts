// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import { workspaceDependencies } from '../dev/workspace-dependencies';

describe('optimized workspace dependency cache', () => {
  it('reuses identical builds and invalidates changed JavaScript, including nested files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cossack-workspace-key-'));
    try {
      mkdirSync(join(directory, 'nested'));
      const file = join(directory, 'nested', 'component.js');
      writeFileSync(file, 'export const value = 1;');
      const before = workspaceDependencies([directory]).name;
      writeFileSync(file, 'export const value = 1;');
      expect(workspaceDependencies([directory]).name).toBe(before);
      writeFileSync(file, 'export const value = 2;');
      expect(workspaceDependencies([directory]).name).not.toBe(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('serves rebuilt linked output with an existing Vite optimization cache', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cossack-workspace-cache-'));
    const app = join(directory, 'app');
    const library = join(directory, 'library');
    const dist = join(library, 'dist');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(app, 'package.json'), '{"type":"module"}');
    writeFileSync(join(library, 'package.json'),
      '{"name":"linked-demo","type":"module","exports":"./dist/index.js"}');
    symlinkSync(library, join(app, 'node_modules', 'linked-demo'), 'junction');
    writeFileSync(join(app, 'main.js'), 'import { marker } from "linked-demo"; console.log(marker);');
    const configFile = join(app, 'vite.config.js');
    const helper = fileURLToPath(new URL('../dev/workspace-dependencies.ts', import.meta.url));
    writeFileSync(configFile, `import { workspaceDependencies } from ${JSON.stringify(helper)};
      export default { plugins: [workspaceDependencies([${JSON.stringify(dist)}])],
        optimizeDeps: { include: ['linked-demo'] } };`);
    try {
      for (const marker of ['BEFORE_WORKSPACE_REBUILD', 'AFTER_WORKSPACE_REBUILD']) {
        writeFileSync(join(dist, 'index.js'), `export const marker = ${JSON.stringify(marker)};`);
        const server = await createServer({ root: app, configFile, logLevel: 'silent',
          cacheDir: join(app, 'cache'),
          server: { host: '127.0.0.1', port: 0 } });
        try {
          await server.listen();
          const address = server.httpServer!.address();
          if (!address || typeof address === 'string') throw new Error('Missing server port');
          const origin = `http://127.0.0.1:${address.port}`;
          const module = await (await fetch(`${origin}/main.js`)).text();
          const url = module.match(/from\s*["']([^"']+linked-demo[^"']+)["']/)?.[1];
          expect(url).toBeDefined();
          const dependency = await fetch(new URL(url!, origin));
          expect(dependency.status).toBe(200);
          expect(await dependency.text()).toContain(marker);
          expect(server.config.configFileDependencies).toContain(join(dist, 'index.js').replaceAll('\\', '/'));
          if (marker === 'AFTER_WORKSPACE_REBUILD') {
            const oldName = server.config.plugins.find(plugin => plugin.name.startsWith('cossack-workspace-dependencies:'))!.name;
            writeFileSync(join(dist, 'index.js'), 'export const marker = "LIVE_WORKSPACE_REBUILD";');
            await expect.poll(() => server.config.plugins.find(plugin =>
              plugin.name.startsWith('cossack-workspace-dependencies:'))?.name,
              { timeout: 10_000 }).not.toBe(oldName);
            await expect.poll(async () => {
              try {
                const refreshedModule = await (await fetch(`${origin}/main.js`)).text();
                const refreshedUrl = refreshedModule.match(/from\s*["']([^"']+linked-demo[^"']+)["']/)?.[1];
                if (!refreshedUrl) return '';
                const refreshedDependency = await fetch(new URL(refreshedUrl, origin));
                return refreshedDependency.status === 200 ? await refreshedDependency.text() : '';
              } catch { return ''; } // Restart may have resolved config before listening.
            }, { timeout: 10_000 }).toContain('LIVE_WORKSPACE_REBUILD');
          }
        } finally { await server.close(); }
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
});
