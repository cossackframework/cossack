// src/shared/errors.ts

/**
 * Marker error for `@Server` methods whose message is safe and intended to be
 * surfaced to the end user (e.g. "An account with this email already exists.").
 *
 * The framework's RPC handlers (`/crpc`, `/upload`, and the HTTP transport)
 * treat this specially: a `ClientVisibleError` becomes an HTTP 400 response
 * carrying `{ error: message }`, which the client proxy re-throws so form
 * handlers can display it. Any *other* thrown error is treated as an internal
 * failure (HTTP 500) — its message is logged server-side and NOT forwarded to
 * the client, so library internals / file paths / stack details never leak.
 *
 * Throw this from your `@Server` methods when the failure is the caller's
 * fault and the message is user-facing:
 *
 * ```ts
 * if (existing) throw new ClientVisibleError('An account with this email already exists.');
 * ```
 */
export class ClientVisibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientVisibleError';
    // Restore the prototype chain across transpilation targets that don't
    // preserve it for built-in subclasses (e.g. older TS targeting ES5).
    Object.setPrototypeOf(this, ClientVisibleError.prototype);
  }
}

/**
 * True when `value` is a `ClientVisibleError` (or carries the marker name set
 * by a subclass with the same intent). Used by RPC error handlers to decide
 * whether to forward the message (400) or treat it as an internal error (500).
 *
 * The name-match branch handles errors that cross a module/instance boundary
 * (where `instanceof ClientVisibleError` fails because the throwing module has
 * its own copy of the class) but carry the `ClientVisibleError` name marker.
 */
export function isClientVisibleError(value: unknown): value is ClientVisibleError {
  if (value instanceof ClientVisibleError) return true;
  // Cross-instance fallback: an Error whose `name` was set to the marker. Cast
  // to satisfy the `value is ClientVisibleError` return type — by contract the
  // only such errors behave as ClientVisibleError (they expose `.message`).
  if (value instanceof Error && (value as { name?: string }).name === 'ClientVisibleError') {
    return true;
  }
  return false;
}
