// shared/static-assets.ts
//
// Vite writes hashed client build output to `assets/`. Every visitor downloads
// these files, and the security plugin strips server code from them, so they
// skip page and global policies: Cloudflare serves `/assets/*` without running
// the Worker, and the generated Node server serves it before the framework.
// Every other request, including files from `public/`, stays behind the
// request pipeline. Scaffold, build checks and deploy preflight share these
// values so the generated configuration and its checks cannot drift.

/** Client build output directory and its URL namespace, without slashes. */
export const STATIC_ASSET_DIRECTORY = 'assets';

/**
 * Generated `assets.run_worker_first`. Every request runs the Worker first,
 * except hashed build output under `/assets/`, which Cloudflare serves directly.
 */
export const ASSETS_RUN_WORKER_FIRST: readonly string[] = Object.freeze(['/*', `!/${STATIC_ASSET_DIRECTORY}/*`]);

/** True for exactly {@link ASSETS_RUN_WORKER_FIRST}, in order. */
export function isFrameworkAssetPattern(value: unknown): boolean {
    return Array.isArray(value) && value.length === ASSETS_RUN_WORKER_FIRST.length &&
        value.every((rule, index) => rule === ASSETS_RUN_WORKER_FIRST[index]);
}

/**
 * The accepted `assets.run_worker_first` values: `true` (every request) or
 * {@link ASSETS_RUN_WORKER_FIRST}. Any other value lets Cloudflare serve
 * `public/` files before authentication and route policies run.
 */
export function isPolicyPreservingRunWorkerFirst(value: unknown): boolean {
    return value === true || isFrameworkAssetPattern(value);
}

/** True when a client output file, relative to the output root, is under `assets/`. */
export function isStaticAssetFile(fileName: string): boolean {
    return fileName.replaceAll('\\', '/').replace(/^\/+/, '').startsWith(`${STATIC_ASSET_DIRECTORY}/`);
}
