/**
 * Node-only checks for paths that application routes cannot use: the `/assets/`
 * namespace (see `static-asset-routing.ts`) and the framework transport
 * endpoints (see `transport-routes.ts`). Builds and deploy preflight call
 * {@link checkReservedPaths}, so both report the same diagnostics. The checks
 * read the filesystem only; they never import application modules.
 */
import path from 'node:path';
import {
  checkStaticAssetNamespace, discoverRouteFacts,
  type StaticAssetNamespaceDiagnostic, type StaticAssetNamespaceOptions, type StaticAssetRouteFact,
} from './static-asset-routing.js';
import { findReservedTransportPath } from './transport-routes.js';

export interface TransportRouteDiagnostic {
  code: 'COSSACK_TRANSPORT_ROUTE_RESERVED';
  message: string;
  /** Absolute path of the route source. */
  file: string;
  /** The reserved path or namespace, such as `/crpc` or `/ws/`. */
  reservedPath: string;
}

export type ReservedPathDiagnostic = StaticAssetNamespaceDiagnostic | TransportRouteDiagnostic;

export interface TransportRouteNamespaceOptions {
  /** Routes already discovered by the caller. Otherwise `src/pages` is scanned. */
  routes?: readonly StaticAssetRouteFact[];
  /** Treat Markdown pages as routes when scanning. Defaults to true. */
  includeMarkdown?: boolean;
}

/** Report addressable routes at a transport endpoint path. */
export function checkTransportRouteNamespace(root: string, options: TransportRouteNamespaceOptions = {}): TransportRouteDiagnostic[] {
  const diagnostics: TransportRouteDiagnostic[] = [];
  for (const route of options.routes ?? discoverRouteFacts(root, options.includeMarkdown ?? true)) {
    if (route.addressable === false) continue;
    const reserved = findReservedTransportPath(route.pattern);
    if (!reserved) continue;
    const source = route.filePath.replace(/^\/+/, '');
    const reservedPath = reserved.match === 'exact' ? reserved.path : `${reserved.path}/`;
    const location = reserved.match === 'exact'
      ? `${reservedPath}, which is reserved for framework ${reserved.purpose}`
      : `${route.pattern}, inside the ${reservedPath} namespace reserved for framework ${reserved.purpose}`;
    diagnostics.push({ code: 'COSSACK_TRANSPORT_ROUTE_RESERVED', file: path.join(root, source), reservedPath,
      message: `${source} resolves to ${location}. The router registers ${reserved.route} before application routes, ` +
        'so requests there reach the transport and this route never runs. Rename the route.' });
  }
  return diagnostics;
}

/** Every reserved-path diagnostic, from one route discovery. */
export function checkReservedPaths(root: string, options: StaticAssetNamespaceOptions = {}): ReservedPathDiagnostic[] {
  const routes = options.routes ?? discoverRouteFacts(root, options.includeMarkdown ?? true);
  return [...checkStaticAssetNamespace(root, { ...options, routes }), ...checkTransportRouteNamespace(root, { routes })];
}
