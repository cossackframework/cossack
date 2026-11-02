import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs';
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

/**
 * Server-side dependencies that must be pre-bundled whatever imports them. Vite's dependency
 * scan crawls source files, never node_modules, so a CommonJS package reached only through an
 * installed framework package is found at run time. The Cloudflare plugin evaluates the Worker
 * entry before that discovery can rebundle, and a bare `require` then stops the dev server
 * ("require is not defined" in the runner Worker). `css-tree` (the renderer's scoped styles)
 * reaches `source-map-js`, which is CommonJS.
 */
export function ssrOptimizedDependencies(): string[] {
    // The nested form: css-tree is the renderer's dependency, not the application's, so an
    // application under pnpm's strict layout cannot resolve it from its root.
    return ['@cossackframework/renderer > css-tree/parser', '@cossackframework/renderer > css-tree/generator', '@cossackframework/renderer > css-tree/walker'];
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

/**
 * What a running dev server watches of its linked pre-bundled packages: each one's `dist`, or
 * its `src` when it has none. Forcing a re-bundle only helps at start: a package rebuilt while
 * the server runs keeps its old bundle, and the browser reports a missing export.
 */
export function linkedDependencyFolders(root: string, specifiers: readonly string[]): { name: string; folder: string }[] {
    return linkedDependencies(root, specifiers).flatMap(name => {
        const directory = packageDirectory(root, name);
        const folder = directory && [join(directory, 'dist'), join(directory, 'src')].find(candidate => existsSync(candidate));
        return folder ? [{ name, folder }] : [];
    });
}

/** The part of a Vite dev server `restartOnLinkedRebuilds` uses. */
export interface RestartableServer {
    restart(forceOptimize?: boolean): Promise<void>;
    config: { logger: { info(message: string, options?: { timestamp?: boolean }): void; error(message: string, options?: { timestamp?: boolean }): void } };
}

/**
 * Restart the dev server, which bundles its linked packages again, once the watched folders
 * have been quiet for `quietMs` after a change: a package build writes many files. Returns a
 * function that stops watching; the watchers never keep the process alive.
 */
export function restartOnLinkedRebuilds(server: RestartableServer, folders: readonly { name: string; folder: string }[], quietMs = 1000): () => void {
    const changed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const restart = () => {
        if (stopped) return;
        server.config.logger.info(`[cossack] ${[...changed].join(', ')} changed: restarting to bundle ${changed.size === 1 ? 'it' : 'them'} again.`, { timestamp: true });
        changed.clear();
        server.restart(true).catch(error => server.config.logger.error(`[cossack] The dev server could not restart: ${error instanceof Error ? error.message : String(error)}`, { timestamp: true }));
    };
    const watchers = folders.flatMap(({ name, folder }): FSWatcher[] => {
        try {
            const watcher = watch(folder, { recursive: true }, () => {
                changed.add(name);
                clearTimeout(timer);
                timer = setTimeout(restart, quietMs);
                timer.unref?.();
            });
            watcher.unref();
            return [watcher];
        } catch { return []; }
    });
    return () => {
        stopped = true;
        clearTimeout(timer);
        for (const watcher of watchers) watcher.close();
    };
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
