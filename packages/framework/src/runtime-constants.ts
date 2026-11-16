/** Public client asset path for the SSR runtime's Vite manifest lookup. */
export const SSR_MANIFEST_ASSET_PATH = '/cossack-manifest.json';

/**
 * Build metadata in the client output directory: the server and the build read it, visitors
 * never do. It names source files by their path on the build machine, so the asset pipeline
 * answers these paths as missing on every runtime.
 */
export function isBuildMetadataPath(pathname: string): boolean {
  return pathname === SSR_MANIFEST_ASSET_PATH || pathname === '/cossack-routes.json' || pathname === '/cossack-ssg-report.json' || pathname === '/.vite' || pathname.startsWith('/.vite/');
}
