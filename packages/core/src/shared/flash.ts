// src/shared/flash.ts
//
// Flash data: values that survive exactly one redirect (POST → GET), then are
// consumed. The ergonomic shape mirrors i18n's `__()`: a module-level API that
// reads request-scoped state without an explicit context argument.
//
// Transport across the redirect is a signed cookie (the framework's flash
// middleware owns reading/writing it). This module only owns the per-request
// store: writes go to `outgoing` (the middleware signs into a cookie after the
// handler returns), reads come from `incoming` (seeded from the cookie at the
// start of the request). On the client there is no ALS, so readers return
// `undefined` (flash is a server-side concern).
//
// `flashInput` / `old` repopulate form fields after a validation failure using
// a reserved namespace, so input never collides with your flash messages
// (e.g. `flash('name', 'Saved!')` vs the submitted `name` field).

import { isServer } from './environment';

/**
 * Per-request flash store. Owned by the framework's AsyncLocalStorage.
 *
 * - `outgoing`: values written this request via `flash()` / `flashInput()`.
 *   The flash middleware serializes + signs this into the cookie after the
 *   handler returns (on a redirect response).
 * - `incoming`: values carried over from the previous request's cookie. Read
 *   via `flashed()` / `old()` during this request.
 */
export interface FlashStore {
    outgoing: Record<string, unknown>;
    incoming: Record<string, unknown>;
}

/** Reserved sub-key under which `flashInput` stores old form input. */
const INPUT_NAMESPACE = '__input';

/**
 * Injected by the framework: returns the active per-request flash store, if any.
 * @internal
 */
let flashStoreGetter: (() => FlashStore | undefined) | null = null;

/** Returns the active per-request store on the server, otherwise undefined. */
function requestStore(): FlashStore | undefined {
    if (isServer && flashStoreGetter) return flashStoreGetter();
    return undefined;
}

/**
 * Wire the per-request flash store getter (backed by AsyncLocalStorage in the
 * framework). Idempotent — the framework calls this once at startup.
 * @internal
 */
export function setFlashStoreGetter(
    getter: (() => FlashStore | undefined) | null,
): void {
    flashStoreGetter = getter;
}

/** @internal Reset module state for tests. */
export function __resetFlashForTests(): void {
    flashStoreGetter = null;
}

// ---------------------------------------------------------------------------
// Writers (act on `outgoing`)
// ---------------------------------------------------------------------------

/**
 * Flash a single value to be available on the next request. Call during a POST
 * handler before redirecting; the flash middleware signs `outgoing` into the
 * cookie on the response.
 *
 *   flash('success', 'Saved!');
 */
export function flash(key: string, value: unknown): void;
/**
 * Flash multiple values at once (object form).
 *
 *   flash({ success: 'Saved!', errors: { name: 'required' } });
 */
export function flash(values: Record<string, unknown>): void;
export function flash(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    const store = requestStore();
    if (!store) {
        // No flash scope (e.g. client, or middleware not registered). Silently
        // no-op rather than throw — flash is best-effort UI glue.
        return;
    }
    if (typeof keyOrValues === 'string') {
        store.outgoing[keyOrValues] = value;
    } else {
        Object.assign(store.outgoing, keyOrValues);
    }
}

/**
 * Stash submitted form input for repopulation after a validation-failure
 * redirect. Stored under a reserved namespace so it never collides with
 * message-style flash keys.
 *
 *   const { data } = await this.c.getFormData<MyForm>({ rules });
 *   if (!valid) { flashInput(data); return this.c.redirect('/forms'); }
 *
 * Read it back with `old('fieldName')`.
 */
export function flashInput(data: Record<string, unknown>): void {
    const store = requestStore();
    if (!store) return;
    store.outgoing[INPUT_NAMESPACE] = data;
}

// ---------------------------------------------------------------------------
// Readers (act on `incoming`)
// ---------------------------------------------------------------------------

/**
 * Read a previously-flashed value from the incoming cookie. Call during the
 * GET that follows the redirect (typically in `render()`). Returns `undefined`
 * if the key wasn't flashed or there's no flash scope.
 *
 *   const msg = flashed<string>('success');
 */
export function flashed<T = unknown>(key: string): T | undefined {
    const store = requestStore();
    if (!store) return undefined;
    return store.incoming[key] as T | undefined;
}

/**
 * Read all flashed values (excluding the reserved old-input namespace).
 */
export function flashedAll(): Record<string, unknown> {
    const store = requestStore();
    if (!store) return {};
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(store.incoming)) {
        if (k !== INPUT_NAMESPACE) result[k] = v;
    }
    return result;
}

/** Whether a flash key is present in the incoming data. */
export function hasFlashed(key: string): boolean {
    const store = requestStore();
    if (!store) return false;
    return key in store.incoming;
}

/**
 * Read an old-input field (from `flashInput`) for repopulating a form after a
 * validation-failure redirect. Supports dot-paths into nested data (matching
 * the validation rules vocabulary): `old('name')` or `old('address.street')`.
 * Returns `undefined` if not present.
 *
 *   <input name="name" value="${old<string>('name') ?? ''}" />
 *   <input name="address[street]" value="${old<string>('address.street') ?? ''}" />
 */
export function old<T = unknown>(key: string): T | undefined {
    const store = requestStore();
    if (!store) return undefined;
    const input = store.incoming[INPUT_NAMESPACE] as Record<string, unknown> | undefined;
    if (!input) return undefined;
    // Dot-path resolution so nested form data (e.g. from getFormData<T>)
    // repopulates naturally. Plain keys (no dot) take the fast path.
    if (!key.includes('.')) {
        return input[key] as T | undefined;
    }
    let current: unknown = input;
    for (const part of key.split('.')) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current as T | undefined;
}
