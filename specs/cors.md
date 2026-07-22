# Built-in API CORS

## Scope and lifecycle

The framework registers CORS after request context and configuration are
initialized, and before project middleware. It applies only to `/api` and
`/api/*`. Valid API preflights terminate with `204`, avoiding project
authentication and database work. Ordinary downstream API responses, including
handled errors, retain the applicable CORS response headers.

Pages and internal transports (`/crpc`, uploads, SSE, and WebSocket endpoints)
are outside its scope.

## Configuration

`src/config/cors.ts` implements `CorsConfig`: `enabled`, `origins`, `methods`,
`headers`, `exposeHeaders`, `credentials`, and `maxAge`. If the file is absent,
the framework uses secure built-in defaults: enabled with an empty origin list.

Origin entries support exact HTTP(S) origins, global `*`, scheme-specific
subdomain wildcards (`https://*.example.com`), and scheme-less subdomain
wildcards (`*.example.com`). Subdomain patterns exclude the apex. Invalid
entries are non-matching. Exact-origin trailing slashes are normalized.

Global `*` with credentials is a configuration error. Empty allowed headers
delegate to Hono's requested-header reflection.

## Security model

CORS is a browser response-visibility policy. It is not access control and does
not replace authentication or authorization. Empty origins deny cross-origin
browser visibility without changing same-origin or non-browser API access.
