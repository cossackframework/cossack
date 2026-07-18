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
    // NOTE: /index.mdx MUST be stripped before /index.md, because '/index.md'
    // is a substring of '/index.mdx' and would otherwise leave a trailing 'x'.
    .replace('/index.mdx', '')
    .replace('/index.md', '')
    .replace(/\.(ts|md|mdx)$/, '');

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
    .replace(/\.(ts|js|md|mdx)$/, '')
    .replace(/\/index$/, '')
    .replace(/\/\([^)]+\)/g, '') // route groups, e.g. /(auth)/login -> /login
    .replace(/\[\.\.\.([^\]]+)\]/g, ':$1*') // catch-all [...slug] -> :slug*
    .replace(/\[([^\]]+)\]/g, ':$1'); // dynamic [name] -> :name
  if (route === '/index') return '/';
  return route || '/';
}

/**
 * Specificity rank of a single path segment, used to order route registration.
 * Lower = more specific (registered first so it wins during matching).
 *   - literal segment (e.g. `users`):  0
 *   - param segment    (e.g. `:id`):   1
 *   - catch-all        (e.g. `:x*`):   2
 *
 * Hono's RegExpRouter lets an earlier-registered param route shadow a later
 * static sibling at the same path position — so `/dashboard/users/:id`
 * registered before `/dashboard/users/new` captures `new` as `id`. Registering
 * more-specific (literal) routes first prevents that. Verified by repro:
 * glob order is lexicographic (`[id]` sorts before `new`), so without this
 * sort, every `[dir]/new` + `[dir]/[id]` pair is broken.
 */
function segmentSpecificity(segment: string): number {
  if (!segment) return 0;
  if (segment.endsWith('*')) return 2; // catch-all :slug*
  if (segment.startsWith(':')) return 1; // param :name
  return 0; // literal
}

/**
 * Compare two HTTP route patterns for registration order. Returns negative
 * when `a` is more specific and should be registered first.
 *
 * Comparison walks segments left to right. At the first diverging segment the
 * one with the lower specificity rank wins; ties fall back to lexicographic
 * order (stable, deterministic regardless of glob insertion order). Shorter
 * paths sort before longer ones when all shared segments are equal, so
 * `/dashboard/users` precedes `/dashboard/users/:id`.
 */
export function compareHttpRoutes(a: string, b: string): number {
  const sa = a.split('/');
  const sb = b.split('/');
  const len = Math.min(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    if (sa[i] === sb[i]) continue;
    const rankDiff = segmentSpecificity(sa[i]) - segmentSpecificity(sb[i]);
    if (rankDiff !== 0) return rankDiff;
    return sa[i] < sb[i] ? -1 : 1;
  }
  return sa.length - sb.length;
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
 * Compute the `<link rel="modulepreload">` hrefs for a page: the page chunk,
 * its transitive imports, and the entry-client's transitive imports (excluding
 * entry-client itself, which is already discovered via the `<script>` tag).
 *
 * Shared by the SSR router and the SSG renderer so their output matches.
 * Returns `[]` in dev (Vite serves modules directly) and for empty page paths.
 */
export function getModulePreloads(mfest: Record<string, any>, pagePath: string): string[] {
  if (!pagePath) return [];
  if (import.meta.env && import.meta.env.DEV) return [];

  const normalizedPath = pagePath.replace(/^\//, '');
  const collected = new Set<string>();

  const collect = (key: string) => {
    const entry = mfest[key];
    if (!entry) return;
    if (entry.file && !collected.has(entry.file)) {
      collected.add(entry.file);
    }
    if (entry.imports) {
      for (const imp of entry.imports) {
        if (!collected.has(imp)) collect(imp);
      }
    }
  };

  collect(normalizedPath);

  const entryClient = mfest['src/client/entry-client.ts'];
  if (entryClient?.imports) {
    for (const imp of entryClient.imports) collect(imp);
  }

  const entryClientFile = entryClient?.file;
  const hrefs: string[] = [];
  for (const key of collected) {
    const entry = mfest[key];
    if (entry?.file) {
      if (entry.file !== entryClientFile) hrefs.push(`/${entry.file}`);
    } else if (key.startsWith('assets/')) {
      if (key !== entryClientFile) hrefs.push(`/${key}`);
    }
  }
  return hrefs;
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
