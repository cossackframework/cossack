/**
 * Origin validation for WebSocket / SSE upgrade requests.
 *
 * Browsers always send an `Origin` header on WebSocket and EventSource
 * connections. A cross-origin page can otherwise open a WS to the victim app
 * using the victim's cookies (cross-site WebSocket hijacking / CSWSH), then
 * invoke server methods. Validating Origin is the standard defence.
 */

/**
 * Determine whether a connection's `Origin` header is permitted.
 *
 * Resolution order:
 *  1. If `allowedOrigins` is a non-empty list, the Origin must be in it.
 *  2. Otherwise the default is **same-origin**: the Origin must equal the
 *     origin of the request itself (derived from `requestUrl`). This is the
 *     correct default for single-origin browser apps without extra config.
 *
 * A missing Origin (non-browser client) is rejected. Apps that need
 * server-to-server clients must pass an explicit `allowedOrigins` list and
 * have those clients send a matching `Origin` header.
 */
export function isOriginAllowed(
    originHeader: string | null | undefined,
    requestUrl: string,
    allowedOrigins?: readonly string[],
): boolean {
    let allowed: string[];
    if (allowedOrigins && allowedOrigins.length > 0) {
        allowed = Array.from(allowedOrigins);
    } else {
        let origin: string;
        try {
            origin = new URL(requestUrl).origin;
        } catch {
            // Malformed request URL — deny rather than guess.
            return false;
        }
        allowed = [origin];
    }

    if (!originHeader) return false;
    return allowed.includes(originHeader);
}
