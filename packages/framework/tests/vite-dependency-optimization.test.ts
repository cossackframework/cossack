// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { clientOptimizedDependencies, isInstalledPackage } from '../src/vite-dependency-optimization';
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

    it('configures the client environment from the plugin location', () => {
        const config = (cossackPages().config as () => any)();
        expect(config.environments.client.optimizeDeps.include).toEqual(clientOptimizedDependencies(new URL('../src/vite-plugin.ts', import.meta.url).href));
    });
});
