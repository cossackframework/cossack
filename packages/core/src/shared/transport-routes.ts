// shared/transport-routes.ts
/**
 * Framework transport endpoints, the single source for the router, the browser
 * proxies, the Node WebSocket upgrade, request middleware and the reserved-path
 * check. The router registers these patterns before application routes, so a
 * page or API route at one of these paths never runs. Builds, `cossack check`
 * and deploy preflight reject such routes with `COSSACK_TRANSPORT_ROUTE_RESERVED`,
 * using reservations derived from the same patterns. Pure module: safe in
 * browsers, Workers, Node and the build. Applications import it from
 * `@cossackframework/core/transport-routes`.
 */

export const TRANSPORT_ROUTES = Object.freeze({
  /** JSON RPC calls (`POST`). */
  rpc: '/crpc',
  /** RPC calls that carry files (`POST`, multipart). */
  upload: '/upload',
  /** Server-sent events for one component. */
  sse: '/sse/:componentRouteId',
  /** The WebSocket connection of one component. Deeper paths answer 404. */
  websocket: '/ws/:id',
} as const);

export type TransportRouteName = keyof typeof TRANSPORT_ROUTES;

const PURPOSES: Readonly<Record<TransportRouteName, string>> = {
  rpc: 'RPC calls',
  upload: 'RPC calls with file uploads',
  sse: 'server-sent event streams',
  websocket: 'component WebSocket connections',
};

export interface ReservedTransportPath {
  /** The literal path, such as `/crpc`, or the namespace root, such as `/ws`. */
  path: string;
  /**
   * `exact` reserves only `path` (Hono matches a trailing slash too).
   * `namespace` reserves every path below `path/`, at any depth, but not `path` itself.
   */
  match: 'exact' | 'namespace';
  /** The router pattern that owns the reservation. */
  route: string;
  purpose: string;
}

/**
 * A literal pattern reserves exactly that path. A pattern with a parameter
 * reserves the namespace of its literal prefix: `/ws/:id` reserves `/ws/`.
 * Hono matches `/crpc` and `/upload` exactly, so `/crpc/x` reaches pages.
 */
function reservation(name: TransportRouteName): ReservedTransportPath {
  const route = TRANSPORT_ROUTES[name];
  const segments = route.split('/');
  const dynamic = segments.findIndex(segment => segment.startsWith(':') || segment.includes('*'));
  return dynamic === -1
    ? { path: route, match: 'exact', route, purpose: PURPOSES[name] }
    : { path: segments.slice(0, dynamic).join('/'), match: 'namespace', route, purpose: PURPOSES[name] };
}

export const RESERVED_TRANSPORT_PATHS: readonly ReservedTransportPath[] = Object.freeze(
  (Object.keys(TRANSPORT_ROUTES) as TransportRouteName[]).map(name => Object.freeze(reservation(name))),
);

/**
 * The reservation that a route pattern or request path falls under, if any.
 * A route parameter never matches a literal reservation, so `/:slug` is allowed
 * even though the transport answers `/crpc` first.
 */
export function findReservedTransportPath(pattern: string): ReservedTransportPath | undefined {
  const path = pattern.length > 1 ? pattern.replace(/\/+$/, '') : pattern;
  return RESERVED_TRANSPORT_PATHS.find(reserved =>
    reserved.match === 'exact' ? path === reserved.path : path.startsWith(`${reserved.path}/`));
}

/**
 * Whether a request path is one of the transport endpoints `names` (all of
 * them when none are given): exactly `/crpc` or `/upload`, or below `/sse/` or
 * `/ws/`. Middleware uses it to answer transports with coded JSON, not pages.
 */
export function isTransportPath(pathname: string, ...names: TransportRouteName[]): boolean {
  const reservations = names.length
    ? RESERVED_TRANSPORT_PATHS.filter(reserved => names.some(name => TRANSPORT_ROUTES[name] === reserved.route))
    : RESERVED_TRANSPORT_PATHS;
  return reservations.some(reserved =>
    reserved.match === 'exact' ? pathname === reserved.path : pathname.startsWith(`${reserved.path}/`));
}

/**
 * The URL path of a transport endpoint. A parameterized endpoint takes its
 * value as one encoded path segment: `transportPath('websocket', 'team:a')` is
 * `/ws/team%3Aa`.
 */
export function transportPath(name: TransportRouteName, param?: string): string {
  const route: string = TRANSPORT_ROUTES[name];
  const index = route.indexOf('/:');
  if (index === -1) return route;
  if (param === undefined) throw new TypeError(`[Cossack] The ${name} transport path needs a parameter.`);
  return `${route.slice(0, index)}/${encodeURIComponent(param)}`;
}

/** Context variable where a transport request records the page or layout file whose guards it runs. */
export const TRANSPORT_GUARD_PATH = 'cossack.transportGuardPath';

/**
 * The page or layout file (`/src/pages/dashboard/index.ts`) whose guards a transport request
 * (an RPC call, an upload, a stream or a WebSocket) runs, from the request's checked target;
 * undefined for other requests. A layout guard learns from it which page an action belongs to.
 */
export function transportGuardPath(c: { get: (key: any) => unknown }): string | undefined {
  const value = c.get(TRANSPORT_GUARD_PATH);
  return typeof value === 'string' ? value : undefined;
}

/** Context variable where a transport request records the file whose code it runs. */
export const TRANSPORT_TARGET_PATH = 'cossack.transportTargetPath';

/**
 * What a transport request runs: the file of the component an RPC call names, a service's layout,
 * the stream's page or layout, or the realtime owner's id (a page's or layout's file, and for a
 * realtime component its registry id, never the page the client names, so it matches no page
 * file). It differs from {@link transportGuardPath} for a layout's actions, which run under the
 * client's page, and for a realtime component: a guard that exempts one page's own actions checks
 * both, and a guard that matches a page file on this path does not cover component sockets.
 */
export function transportTargetPath(c: { get: (key: any) => unknown }): string | undefined {
  const value = c.get(TRANSPORT_TARGET_PATH);
  return typeof value === 'string' ? value : undefined;
}

/** Context variable where an RPC call records the action it calls. */
export const TRANSPORT_ACTION = 'cossack.transportAction';

/**
 * The action an RPC call names on its {@link transportTargetPath} (a component's method, or a
 * service's), as the client sent it; undefined for other requests. A guard may exempt one
 * named action of one file, such as a layout's sign-out.
 */
export function transportAction(c: { get: (key: any) => unknown }): string | undefined {
  const value = c.get(TRANSPORT_ACTION);
  return typeof value === 'string' ? value : undefined;
}
