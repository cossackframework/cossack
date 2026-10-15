/**
 * Framework transport endpoints. The values live in
 * `@cossackframework/core/transport-routes`, so the browser proxies and the
 * Node adapter use the same paths as the router; see that module.
 */
export {
  RESERVED_TRANSPORT_PATHS, TRANSPORT_ROUTES, findReservedTransportPath, isTransportPath, transportPath,
  type ReservedTransportPath, type TransportRouteName,
} from '@cossackframework/core/transport-routes';
