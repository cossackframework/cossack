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
    /** Framework checks response timing before a write changes this store. */
    assertWritable?: () => void;
}

/** Reserved sub-key under which `flashInput` stores old form input. */
const INPUT_NAMESPACE = '__input';

/** Only application-selected public fields may enter the readable flash cookie. */
export interface FlashInputOptions {
    /** Dot paths to scalar values or scalar arrays. Select nested leaves individually. */
    fields: readonly string[];
}

function allowedInputPath(path: string): boolean {
    return path.length > 0 && path.split('.').every(part => {
        if (!part || part === '__proto__' || part === 'prototype' || part === 'constructor') return false;
        const name = part.replace(/[^a-z0-9]/gi, '').toLowerCase();
        return !/(password|passwd|passphrase|secret|token|credential|authorization|cookie|apikey|privatekey|sessionid|csrf)/.test(name)
            && !['pin', 'otp', 'cvv', 'cvc'].includes(name);
    });
}

function ownValue(object: unknown, key: string): unknown {
    if (object === null || typeof object !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function inputScalar(value: unknown): boolean {
    return value === null || typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value));
}

function selectInput(data: Record<string, unknown>, options: FlashInputOptions): Record<string, unknown> {
    const selected: Record<string, unknown> = Object.create(null);
    // A JavaScript caller without the new policy retains no submitted values.
    if (!Array.isArray(options?.fields)) return selected;
    for (const path of options.fields) {
        if (typeof path !== 'string' || !allowedInputPath(path)) continue;
        const parts = path.split('.');
        const parents: unknown[] = [];
        let value: unknown = data;
        for (const part of parts) {
            parents.push(value);
            if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(part)) { value = undefined; break; }
            value = ownValue(value, part);
        }
        if (Array.isArray(value)) {
            const copy: unknown[] = [];
            for (let i = 0; i < value.length; i++) {
                const item = ownValue(value, String(i));
                if (!inputScalar(item)) { value = undefined; break; }
                copy.push(item);
            }
            if (value !== undefined) value = copy;
        } else if (!inputScalar(value)) continue;
        if (value === undefined) continue;
        let target = selected;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            if (ownValue(target, key) === undefined) {
                target[key] = Array.isArray(parents[i + 1]) ? [] : Object.create(null);
            }
            target = target[key] as Record<string, unknown>;
        }
        target[parts[parts.length - 1]] = value;
    }
    return selected;
}

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
    store.assertWritable?.();
    if (keyOrValues === INPUT_NAMESPACE || (typeof keyOrValues === 'object'
        && Object.prototype.hasOwnProperty.call(keyOrValues, INPUT_NAMESPACE))) {
        throw new TypeError('[Cossack] Old input requires flashInput(data, { fields }).');
    }
    if (typeof keyOrValues === 'string') {
        store.outgoing[keyOrValues] = value;
    } else {
        Object.assign(store.outgoing, keyOrValues);
    }
}

/**
 * Stash selected public fields after a validation-failure redirect. The cookie
 * is signed, not encrypted. Common credential names are always excluded; custom
 * credentials must stay out of `fields`. Objects, files and accessors are omitted.
 * Scalar arrays are copied, and nested objects are rebuilt from selected leaves.
 *
 *   const { data, valid } = await this.c.getFormData<MyForm>({ rules });
 *   if (!valid) { flashInput(data, { fields: ['name', 'address.city'] }); return this.c.redirect('/forms'); }
 *
 * Read it back with `old('fieldName')`.
 */
export function flashInput(data: Record<string, unknown>, options: FlashInputOptions): void {
    const store = requestStore();
    if (!store) return;
    store.assertWritable?.();
    store.outgoing[INPUT_NAMESPACE] = selectInput(data, options);
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
    if (!allowedInputPath(key)) return undefined;
    let current: unknown = input;
    for (const part of key.split('.')) {
        current = ownValue(current, part);
    }
    return current as T | undefined;
}
