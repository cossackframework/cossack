// src/session-als.ts
//
// Per-request session scoping. The framework's session middleware resolves the
// session ID (from the auth cookie or the anonymous `cossack_sid` cookie),
// loads/creates the row, and wraps the request in this scope so the global
// `session()` helper resolves it.
//
// Mirrors the db() ALS pattern (see `als.ts` + `store.ts`).

import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionStore } from './session-store';

/** The per-request session scope: the store + the active session ID. */
export interface SessionScope {
    /** The active session ID for this request (auth's, or an anonymous one). */
    sessionId: string;
    /** The SessionStore (backed by the scoped `db()` client). */
    store: SessionStore;
}

const sessionAls = new AsyncLocalStorage<SessionScope>();

/**
 * One-time wiring hook (kept for symmetry with db/i18n; the `session()` helper
 * reads `sessionAls` directly since it lives in the same package). Idempotent.
 */
let wired = false;
export function ensureSessionAlsWired(): void {
    wired = true;
}
export function _isSessionAlsWired(): boolean {
    return wired;
}

/** Runs `fn` inside a session scope. `session()` inside `fn` resolves the scope. */
export function runWithSession<T>(
    scope: SessionScope,
    fn: () => T | Promise<T>,
): T | Promise<T> {
    return sessionAls.run(scope, fn as () => T);
}

/** @internal Returns the active session scope, if any. Used by `session()`. */
export function getSessionScope(): SessionScope | undefined {
    return sessionAls.getStore();
}
