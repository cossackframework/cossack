// src/session.ts
//
// Context-free session access: `session()` returns a handle bound to the active
// request's session for key/value get/set. Mirrors `db()` — throws a clear
// `[Cossack]` error if called outside a request scope (register the session
// middleware via `cossack add database`).
//
//   await session().set('cart', { items: [...] });
//   const cart = await session().get('cart');
//   const sid = session().id();
//
// Sessions are DB-backed (the `sessions` table) and addressed by an opaque ID
// carried in a cookie. With auth installed, the ID is the auth session cookie;
// otherwise an anonymous `cossack_sid` cookie is used (see
// `createSessionMiddleware`).

import { getSessionScope } from './session-als';

/**
 * Returns a handle to the active request's session. The handle caches the
 * session ID and exposes async get/set over the scoped `SessionStore`.
 *
 * Throws if no session scope is active.
 */
export function session() {
    const scope = getSessionScope();
    if (!scope) {
        throw new Error(
            '[Cossack] No session in scope. `session()` must be called within a request ' +
                'handler with the session middleware registered (run `cossack add database`).',
        );
    }
    return {
        /** The active session ID for this request. */
        id(): string {
            return scope.sessionId;
        },
        /** Read a single key from the session data bag. */
        async get<T = unknown>(key: string): Promise<T | undefined> {
            return scope.store.get<T>(scope.sessionId, key);
        },
        /** Read the entire data bag. */
        async getAll(): Promise<Record<string, unknown>> {
            return scope.store.getAll(scope.sessionId);
        },
        /** Set a single key (merges into the bag; refreshes expiry). */
        async set(key: string, value: unknown): Promise<void> {
            return scope.store.set(scope.sessionId, key, value);
        },
        /** Remove a single key from the bag. */
        async unset(key: string): Promise<void> {
            return scope.store.unset(scope.sessionId, key);
        },
        /** Delete the session row entirely (e.g. on logout). */
        async destroy(): Promise<void> {
            return scope.store.destroy(scope.sessionId);
        },
    };
}
