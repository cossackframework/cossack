import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Client entries Vite pre-bundles in development before the first request.
 *
 * Vite treats linked packages as application source, so the library barrels
 * are listed to bundle them instead of loading every re-export as a separate
 * browser request. Devtools shares the component inspector registry with core;
 * optimizing both entries keeps a single copy of that state.
 *
 * Pages load through the generated page registry, which Vite's dependency
 * scanner cannot follow. A dependency first seen while a page is loading makes
 * Vite re-bundle, and when the new bundle replaces chunks the page already
 * uses, Vite answers the page's remaining requests with 504 and asks for a full
 * reload. A page whose Vite client has not started yet never receives that
 * reload and stays broken. The development trace bridge loads with every page
 * and imports the public devtools entry, so that entry must be in the first
 * bundle. An installed framework's client app already bundles the same module,
 * so listing the public entry keeps one shared copy. A linked framework stays
 * source: listing the entry there would add a second copy beside the client
 * app's own relative import.
 */
export function clientOptimizedDependencies(frameworkModuleUrl: string): string[] {
    const include = ['@cossackframework/core', '@cossackframework/core/devtools', '@cossackframework/renderer'];
    if (isInstalledPackage(frameworkModuleUrl)) include.push('@cossackframework/framework/client/devtools');
    return include;
}

/** Vite pre-bundles a bare import only when its real path is inside node_modules. */
export function isInstalledPackage(moduleUrl: string): boolean {
    return fileURLToPath(moduleUrl).split(/[\\/]/).includes('node_modules');
}

/**
 * The listed packages whose real path is outside node_modules: workspace or `pnpm link`
 * packages that resolve to their sources. Vite keys its pre-bundle cache on the lockfile
 * and the config, never on a linked package's files, so a bundle of one is stale after
 * its sources change, and the browser reports a missing export until the cache is deleted.
 * The plugin sets `optimizeDeps.force` for an environment that lists one, so every dev
 * start re-bundles it. Subpath entries count by their package.
 */
export function linkedDependencies(root: string, specifiers: readonly string[]): string[] {
    const linked: string[] = [];
    for (const name of new Set(specifiers.map(packageName))) {
        const directory = packageDirectory(root, name);
        if (directory && !directory.split(/[\\/]/).includes('node_modules')) linked.push(name);
    }
    return linked;
}

function packageName(specifier: string): string {
    const segments = specifier.split('/');
    return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
}

/** The real directory of the package as Node would find it from the root, walking up. */
function packageDirectory(root: string, name: string): string | undefined {
    for (let directory = root; ; directory = dirname(directory)) {
        const candidate = join(directory, 'node_modules', name);
        if (existsSync(candidate)) {
            try { return realpathSync(candidate); } catch { return undefined; }
        }
        if (dirname(directory) === directory) return undefined;
    }
}
