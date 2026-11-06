import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watch, type Dirent, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DepOptimizationConfig } from 'vite';

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

/** A linked package Vite pre-bundles, and the folder its bundle is built from. */
export interface LinkedDependency {
    readonly name: string;
    /** The package's `dist`, or its `src` when it has none. */
    readonly folder: string;
}

/**
 * The listed packages whose real path is outside node_modules (workspace or `pnpm link`
 * packages, which resolve to their sources), and the linked packages those depend on: a
 * bundle inlines every package of its graph that is not bundled on its own, so a rebuilt
 * dependency changes it too. Subpath and nested (`a > b`) entries count by the package they
 * name. The folders are what the plugin fingerprints and a running dev server watches.
 */
export function linkedDependencyFolders(root: string, specifiers: readonly string[]): LinkedDependency[] {
    const linked = new Map<string, string>();
    const seen = new Set<string>();
    const visit = (from: string, name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        const directory = packageDirectory(from, name);
        if (!directory || directory.split(/[\\/]/).includes('node_modules')) return;
        linked.set(name, directory);
        for (const dependency of packageDependencies(directory)) visit(directory, dependency);
    };
    for (const specifier of specifiers) visit(root, packageName(specifier));
    return [...linked].flatMap(([name, directory]) => {
        const folder = [join(directory, 'dist'), join(directory, 'src')].find(candidate => existsSync(candidate));
        return folder ? [{ name, folder }] : [];
    });
}

/**
 * A fingerprint of the linked packages' files: their paths, sizes and modification times.
 * Vite keys its pre-bundle cache on the lockfile and the config, never on a linked package's
 * files, and the browser keeps a bundle for good under the hash of that key. A bundle
 * rewritten under the same key (as `optimizeDeps.force` does) is never fetched again, so a
 * changed export was missing until the browser's cache was cleared. With the fingerprint in
 * the config, a changed package is bundled again under a new hash, which the browser fetches,
 * and an unchanged one keeps its bundle.
 */
export function linkedDependencyFingerprint(folders: readonly LinkedDependency[]): string {
    const hash = createHash('sha1');
    for (const { name, folder } of [...folders].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        hash.update(`${name}\n`);
        for (const file of listFiles(folder)) {
            const stat = statSync(join(folder, file), { throwIfNoEntry: false });
            if (stat) hash.update(`${file}:${stat.size}:${stat.mtimeMs}\n`);
        }
    }
    return hash.digest('hex').slice(0, 16);
}

/** The identifier the fingerprint is defined as; no dependency mentions it, so the bundles do not change. */
export const LINKED_PACKAGES_DEFINE = '__COSSACK_LINKED_PACKAGES__';

/**
 * The pre-bundle config of an environment that bundles linked packages: their fingerprint as
 * a define in rolldown's transform options, which Vite hashes into its cache key.
 */
export function linkedDependenciesConfig(folders: readonly LinkedDependency[]): Pick<DepOptimizationConfig, 'rolldownOptions'> {
    if (!folders.length) return {};
    return { rolldownOptions: { transform: { define: { [LINKED_PACKAGES_DEFINE]: JSON.stringify(linkedDependencyFingerprint(folders)) } } } };
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
export function restartOnLinkedRebuilds(server: RestartableServer, folders: readonly LinkedDependency[], quietMs = 1000): () => void {
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

/** The package a specifier names: without its subpath, and the last of a nested `a > b` entry. */
function packageName(specifier: string): string {
    const bare = specifier.split(' > ').pop()!.trim();
    const segments = bare.split('/');
    return bare.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
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

/** The packages a package's manifest depends on. */
function packageDependencies(directory: string): string[] {
    try {
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Record<'dependencies' | 'peerDependencies' | 'optionalDependencies', Record<string, string> | undefined>;
        return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})];
    } catch { return []; }
}

/** Every file under the folder, in a fixed order, as paths relative to it; hidden entries and nested node_modules are left out. */
function listFiles(folder: string, prefix = ''): string[] {
    let entries: Dirent[];
    try { entries = readdirSync(folder, { withFileTypes: true }); } catch { return []; }
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).flatMap(entry => {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
        const path = prefix + entry.name;
        return entry.isDirectory() ? listFiles(join(folder, entry.name), `${path}/`) : [path];
    });
}
