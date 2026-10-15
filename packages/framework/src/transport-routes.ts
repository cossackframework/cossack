/**
 * Framework transport endpoints, the single source for the router and the
 * reserved-path check. The router registers these patterns before application
 * routes, so a page or API route at one of these paths never runs. Builds,
 * `cossack check cloudflare` and deploy preflight reject such routes with
 * `COSSACK_TRANSPORT_ROUTE_RESERVED`, using reservations derived from the same
 * patterns. Pure module: safe in Workers, Node and the build.
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
