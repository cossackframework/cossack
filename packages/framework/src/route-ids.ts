/**
 * Deterministic component-route ID derivation — the single source of truth.
 *
 * Both the SSR router (`router.ts`) and the SSG build derive component IDs
 * from {@link computeRouteIds}, and the Vite plugin emits a manifest from it
 * (`cossack-routes.json`) so the SSG CLI no longer needs to re-scan the
 * filesystem or re-derive IDs. Keeping this logic in one place guarantees the
 * IDs the client hydrates with match the IDs the server uses for RPC.
 *
 * This module is intentionally pure (no `fs`, no environment-specific APIs)
 * so it can be imported by both the edge/worker runtime and the Node build.
 */

/** Route ID reserved for the global `App` component. */
export const APP_ROUTE_ID = 'cossack_app';
/** File path the global `App` component is expected at. */
export const APP_FILE_PATH = '/src/App';

/**
 * Convert a file path to a simplified route path.
 * `/src/pages/hello/[name]/index.ts` -> `/hello/[name]`
 */
export function filePathToRoutePath(filePath: string): string {
  const route = filePath
    .replace('/src/pages/', '/')
    .replace('/index.ts', '')
    .replace('/index.md', '')
    .replace('/index.mdx', '')
    .replace(/\.(ts|tsx|md|mdx)$/, '');

  // Normalize root: /index (from pages/index/index.ts) or empty (from pages/index.ts) -> /
  if (route === '/index' || route === '') {
    return '/';
  }
  return route;
}

/**
 * Convert a file path to an HTTP route pattern (the shape Hono registers).
 * Translates dynamic segments and catch-alls:
 *   `/src/pages/docs/[...slug]/index.ts` -> `/docs/:slug*`
 *   `/src/pages/hello/[name]/index.ts`   -> `/hello/:name`
 * Route groups `(group)` are removed, and `/index` collapses to `/`.
 *
 * Catch-all handling MUST run before single-segment handling so `[...slug]`
 * becomes `:slug*` (valid Hono) rather than `:...slug` (invalid).
 */
export function filePathToHttpRoute(filePath: string): string {
  const route = filePath
    .replace('/src/pages', '')
    .replace(/\.(ts|tsx|js|jsx|md|mdx)$/, '')
    .replace(/\/index$/, '')
    .replace(/\/\([^)]+\)/g, '') // route groups, e.g. /(auth)/login -> /login
    .replace(/\[\.\.\.([^\]]+)\]/g, ':$1*') // catch-all [...slug] -> :slug*
    .replace(/\[([^\]]+)\]/g, ':$1'); // dynamic [name] -> :name
  if (route === '/index') return '/';
  return route || '/';
}

export interface RouteIdMaps {
  /** component route id (cmp_N) -> filePath */
  routeIdMap: Map<string, string>;
  /** filePath -> component route id (cmp_N) */
  routePathToIdMap: Map<string, string>;
  /** routePath -> filePath */
  routePathToFilePathMap: Map<string, string>;
}

/**
 * Shared context passed to the transport handlers (WebSocket, SSE, upload) and
 * the SSR router. Declared once here so the three transport modules and the
 * router agree on its shape (previously each transport redeclared its own
 * copy, and two of them were unused shadows).
 */
export interface RouterContext {
  routeIdMap: Map<string, string>;
  routePathToIdMap: Map<string, string>;
  routePathToFilePathMap: Map<string, string>;
  pages: Record<string, any>;
  layouts: Record<string, any>;
  /** Allowed Origin values for WS/SSE upgrades. Defaults to same-origin. */
  allowedOrigins?: string[];
}

/**
 * Compute deterministic component route IDs from the sorted set of page +
 * layout file paths. Keys are sorted lexicographically and assigned
 * `cmp_${index.toString(36)}`. The global App component receives the reserved
 * {@link APP_ROUTE_ID} (it is NOT a `cmp_N` id).
 */
export function computeRouteIds(pageKeys: string[], layoutKeys: string[]): RouteIdMaps {
  const routeIdMap = new Map<string, string>();
  const routePathToIdMap = new Map<string, string>();
  const routePathToFilePathMap = new Map<string, string>();

  // Register the App component (global component) with a special ID.
  routeIdMap.set(APP_ROUTE_ID, APP_FILE_PATH);

  [...pageKeys, ...layoutKeys].sort().forEach((path, index) => {
    const id = `cmp_${index.toString(36)}`;
    routeIdMap.set(id, path);
    routePathToIdMap.set(path, id);
    const routePath = filePathToRoutePath(path);
    routePathToFilePathMap.set(routePath, path);
  });

  return { routeIdMap, routePathToIdMap, routePathToFilePathMap };
}

/** Shape of the `cossack-routes.json` manifest emitted by the Vite plugin. */
export interface RoutesManifest {
  /** Reserved App route id. */
  appRouteId: string;
  /** All page file paths (sorted). */
  pageKeys: string[];
  /** All layout file paths (sorted). */
  layoutKeys: string[];
  /** filePath -> component route id (cmp_N). */
  filePathToId: Record<string, string>;
}

/**
 * Build a serializable {@link RoutesManifest} from computed maps, suitable for
 * writing to disk by the Vite plugin and consuming by the SSG CLI.
 */
export function buildRoutesManifest(pageKeys: string[], layoutKeys: string[], maps: RouteIdMaps): RoutesManifest {
  const filePathToId: Record<string, string> = {};
  for (const [path, id] of maps.routePathToIdMap.entries()) {
    filePathToId[path] = id;
  }
  return {
    appRouteId: APP_ROUTE_ID,
    pageKeys: [...pageKeys].sort(),
    layoutKeys: [...layoutKeys].sort(),
    filePathToId,
  };
}
