/**
 * Framework transport endpoints. The values live in
 * `@cossackframework/core/transport-routes`, so the browser proxies and the
 * Node adapter use the same paths as the router; see that module.
 */
export {
  RESERVED_TRANSPORT_PATHS, TRANSPORT_ACTION, TRANSPORT_GUARD_PATH, TRANSPORT_ROUTES, TRANSPORT_TARGET_PATH, findReservedTransportPath, isTransportPath, transportAction, transportGuardPath, transportPath, transportTargetPath,
  type ReservedTransportPath, type TransportRouteName,
} from '@cossackframework/core/transport-routes';
