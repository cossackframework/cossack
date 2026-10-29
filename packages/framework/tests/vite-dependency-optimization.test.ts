// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { clientOptimizedDependencies, isInstalledPackage, linkedDependencies } from '../src/vite-dependency-optimization';
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

    it('tells linked packages from installed ones by their real path', () => {
        // In this workspace core is a linked package of the framework; vitest is installed.
        expect(linkedDependencies(packageRoot, ['@cossackframework/core/devtools', 'vitest', 'not-a-package'])).toEqual(['@cossackframework/core']);
    });

    // Vite's pre-bundle cache does not follow a linked package's sources: without this, a
    // changed export is missing in the browser until node_modules/.vite is deleted.
    it('re-bundles linked packages on every dev start', () => {
        const config = configure({ root: packageRoot }, 'serve');
        expect(config.environments.client.optimizeDeps.force).toBe(true);
        expect(config.environments.ssr.optimizeDeps.force).toBeUndefined();
        const ssr = configure({ root: packageRoot, environments: { ssr: { optimizeDeps: { include: ['@cossackframework/core'] } } } }, 'serve');
        expect(ssr.environments.ssr.optimizeDeps.force).toBe(true);
        expect(configure({ root: packageRoot }, 'build').environments.client.optimizeDeps.force).toBeUndefined();
    });
});
