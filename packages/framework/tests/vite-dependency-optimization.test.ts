// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { LINKED_PACKAGES_DEFINE, clientOptimizedDependencies, isInstalledPackage, linkedDependenciesConfig, linkedDependencyFingerprint, linkedDependencyFolders, restartOnLinkedRebuilds } from '../src/vite-dependency-optimization';
import { cossackPages } from '../src/vite-plugin';

const installed = pathToFileURL('/app/node_modules/.pnpm/@cossackframework+framework@0.9.0/node_modules/@cossackframework/framework/dist/esm/vite-plugin.js').href;
const linked = pathToFileURL('/workspace/cossack/packages/framework/dist/esm/vite-plugin.js').href;

describe('client dependency pre-bundling', () => {
    it('treats only real paths inside node_modules as installed', () => {
        expect(isInstalledPackage(installed)).toBe(true);
        expect(isInstalledPackage(linked)).toBe(false);
        expect(isInstalledPackage(pathToFileURL('/srv/node_modules_backup/framework/vite-plugin.js').href)).toBe(false);
    });

    // The trace bridge loads with every page and imports this entry. Finding it
    // during the first page load re-bundles shared chunks and reloads the page.
    it('pre-bundles the devtools entry with an installed framework', () => {
        expect(clientOptimizedDependencies(installed)).toEqual([
            '@cossackframework/core', '@cossackframework/core/devtools', '@cossackframework/renderer',
            '@cossackframework/framework/client/devtools',
        ]);
    });

    it('leaves a linked framework devtools entry as source beside its client app', () => {
        expect(clientOptimizedDependencies(linked)).not.toContain('@cossackframework/framework/client/devtools');
    });

    const configure = (userConfig: object, command: 'serve' | 'build') =>
        (cossackPages().config as (config: object, env: object) => any)(userConfig, { command, mode: command === 'serve' ? 'development' : 'production' });
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));

    it('configures the client environment from the plugin location', () => {
        const config = configure({}, 'build');
        expect(config.environments.client.optimizeDeps.include).toEqual(clientOptimizedDependencies(new URL('../src/vite-plugin.ts', import.meta.url).href));
        expect(config.environments.client.optimizeDeps.force).toBeUndefined();
    });

    it('tells linked packages from installed ones by their real path, with the linked packages they depend on', () => {
        // In this workspace core is a linked package of the framework, and depends on linked renderer; vitest is installed.
        expect(linkedDependencyFolders(packageRoot, ['@cossackframework/core/devtools', 'vitest', 'not-a-package'])).toEqual([
            { name: '@cossackframework/core', folder: join(packageRoot, '../core/dist') },
            { name: '@cossackframework/renderer', folder: join(packageRoot, '../renderer/dist') },
        ]);
    });

    // A bundle inlines the packages of its graph that are not bundled on their own, so a
    // rebuilt linked dependency changes it too; an installed one is Vite's to key.
    it('follows a linked package to the linked packages it depends on, from its own folder', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'cossack-linked-')));
        try {
            mkdirSync(join(root, 'packages/a/src'), { recursive: true });
            writeFileSync(join(root, 'packages/a/package.json'), JSON.stringify({ name: 'a', dependencies: { b: 'workspace:*', c: '1.0.0' } }));
            mkdirSync(join(root, 'packages/b/dist'), { recursive: true });
            writeFileSync(join(root, 'packages/b/package.json'), JSON.stringify({ name: 'b', peerDependencies: { a: 'workspace:*' } }));
            mkdirSync(join(root, 'node_modules/c/dist'), { recursive: true });
            writeFileSync(join(root, 'node_modules/c/package.json'), JSON.stringify({ name: 'c' }));
            symlinkSync(join(root, 'packages/a'), join(root, 'node_modules/a'), 'dir');
            mkdirSync(join(root, 'packages/a/node_modules'));
            symlinkSync(join(root, 'packages/b'), join(root, 'packages/a/node_modules/b'), 'dir');
            expect(linkedDependencyFolders(root, ['a/sub', 'c'])).toEqual([
                { name: 'a', folder: join(root, 'packages/a/src') },
                { name: 'b', folder: join(root, 'packages/b/dist') },
            ]);
            // A nested entry names the package after the arrow.
            expect(linkedDependencyFolders(root, ['a > c/parser'])).toEqual([]);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });

    // Vite's pre-bundle cache key does not follow a linked package's files, and the browser keeps
    // a bundle for good under that key's hash: a rewritten bundle under the same hash is never
    // fetched, and the browser reports a missing export until its cache is cleared.
    it('keys the pre-bundle cache on the linked packages, through a define Vite hashes', () => {
        const config = configure({ root: packageRoot }, 'serve');
        expect(config.environments.client.optimizeDeps.force).toBeUndefined();
        const define = config.environments.client.optimizeDeps.rolldownOptions.transform.define[LINKED_PACKAGES_DEFINE];
        expect(define).toBe(JSON.stringify(linkedDependencyFingerprint(linkedDependencyFolders(packageRoot, ['@cossackframework/core', '@cossackframework/renderer']))));
        // css-tree reaches CommonJS source-map-js; an installed renderer is never scanned, so it is listed up front. It bundles no linked package.
        expect(config.environments.ssr.optimizeDeps).toEqual({ include: ['@cossackframework/renderer > css-tree/parser', '@cossackframework/renderer > css-tree/generator', '@cossackframework/renderer > css-tree/walker'] });
        const ssr = configure({ root: packageRoot, environments: { ssr: { optimizeDeps: { include: ['@cossackframework/core'] } } } }, 'serve');
        expect(ssr.environments.ssr.optimizeDeps.rolldownOptions.transform.define[LINKED_PACKAGES_DEFINE]).toBe(define);
        expect(configure({ root: packageRoot }, 'build').environments.client.optimizeDeps).toEqual({ include: clientOptimizedDependencies(new URL('../src/vite-plugin.ts', import.meta.url).href) });
        expect(linkedDependenciesConfig([])).toEqual({});
    });

    it('fingerprints the files of the linked packages, whatever their order', () => {
        const root = mkdtempSync(join(tmpdir(), 'cossack-linked-'));
        try {
            const a = join(root, 'a'); const b = join(root, 'b');
            mkdirSync(join(a, 'nested'), { recursive: true }); mkdirSync(b);
            writeFileSync(join(a, 'index.js'), 'export const a = 1;'); writeFileSync(join(a, 'nested/more.js'), 'export {};'); writeFileSync(join(b, 'index.js'), 'export const b = 1;');
            const folders = [{ name: 'a', folder: a }, { name: 'b', folder: b }];
            const first = linkedDependencyFingerprint(folders);
            expect(first).toMatch(/^[0-9a-f]{16}$/);
            expect(linkedDependencyFingerprint([...folders].reverse())).toBe(first);
            // A rewritten file, even of the same size, and a new one change it; a nested node_modules does not count.
            utimesSync(join(a, 'nested/more.js'), new Date(), new Date(Date.now() + 5000));
            const touched = linkedDependencyFingerprint(folders);
            expect(touched).not.toBe(first);
            writeFileSync(join(b, 'extra.js'), 'export {};');
            const added = linkedDependencyFingerprint(folders);
            expect(added).not.toBe(touched);
            mkdirSync(join(a, 'node_modules/dep'), { recursive: true }); writeFileSync(join(a, 'node_modules/dep/index.js'), 'export {};');
            expect(linkedDependencyFingerprint(folders)).toBe(added);
            expect(linkedDependencyFingerprint([{ name: 'gone', folder: join(root, 'missing') }])).toMatch(/^[0-9a-f]{16}$/);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });

    // A package rebuilt while the dev server runs keeps its old bundle until the server bundles it again.
    it('restarts a running dev server once after a linked package is rebuilt', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'cossack-linked-'));
        try {
            const server = { restart: vi.fn(async () => {}), config: { logger: { info: vi.fn(), error: vi.fn() } } };
            const stop = restartOnLinkedRebuilds(server, [{ name: '@cossackframework/core', folder }], 50);
            for (const file of ['index.js', 'index.d.ts', 'shared.js']) writeFileSync(join(folder, file), 'export {};');
            await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1), { timeout: 2000 });
            expect(server.restart).toHaveBeenCalledWith(true);
            expect(server.config.logger.info).toHaveBeenCalledWith(expect.stringContaining('@cossackframework/core changed'), { timestamp: true });
            stop();
            writeFileSync(join(folder, 'index.js'), 'export const later = 1;');
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(server.restart).toHaveBeenCalledTimes(1);
        } finally { rmSync(folder, { recursive: true, force: true }); }
    });
});
