// src/shared/request-context.ts
//
// Per-request Hono `Context` scoping, exposed context-free via `cookie()` and
// `session()`. Mirrors the i18n/db/flash pattern: core declares the getter
// slot + public helpers; the framework owns the AsyncLocalStorage instance and
// wires it once at startup via `setRequestContextGetter`.
//
// Why this lives in core (not framework): `cookie()` is a public API exported
// from `@cossackframework/core`, and the Hono `Context` type is already a core
// dependency (`packages/core/src/shared/context.ts` imports it). The framework
// supplies the ALS; core supplies the ergonomic surface.
//
// Why we don't reuse the renderer's `RequestContext`: that is a synchronous
// component-tree context (`provide`/`consume`), reachable only with a component
// instance. A global `cookie()` called from a service or plain function has no
// component handle, so it needs AsyncLocalStorage.

import type { Context } from 'hono';

/**
 * Injected by the framework: returns the active request's Hono `Context`, or
 * `undefined` when called outside a request scope (e.g. on the client, in
 * scripts, or before the middleware is registered).
 * @internal
 */
let requestContextGetter: (() => Context | undefined) | null = null;

/** @internal Framework wires the per-request Context getter here (once). */
export function setRequestContextGetter(
    getter: (() => Context | undefined) | null,
): void {
    requestContextGetter = getter;
}

/**
 * Returns the active request's Hono `Context`, or `undefined` when none is in
 * scope. Public so `cookie()` / `session()` (and power users) can reach it.
 *
 * Prefer the typed helpers (`cookie()`, `session()`) over calling this
 * directly — they surface clear errors when misused.
 */
export function getRequestContext(): Context | undefined {
    if (requestContextGetter) return requestContextGetter();
    return undefined;
}

/** @internal Reset module state for tests. */
export function __resetRequestContextForTests(): void {
    requestContextGetter = null;
}
