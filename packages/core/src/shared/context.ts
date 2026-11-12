// src/shared/context.ts
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { createContext } from '@cossackframework/renderer';
import { parseFormData } from './forms';
import { flash, flashInput } from './flash';
import { StoreRuleMap, validateObject, type ObjectValidationResult } from './validation';
import type { CossackRuntimeInfo } from './component-types';

export const EnvContext = createContext<any>(undefined);
export const UserContext = createContext<any>(undefined);
export const RequestContext = createContext<Context | undefined>(undefined);
export const RuntimeContext = createContext<CossackRuntimeInfo>({ platform: 'web' });

export type HydratedContext = {
    req: {
        param: (key?: string) => any;
        path: string;
        query: (key?: string) => any;
        url?: string;
    }
}

/**
 * Controls automatic flash-scoping of submitted input and validation errors.
 *
 * - `true` (default): flash validation errors only when non-empty.
 * - `false`: flash nothing — you call `flashInput`/`flash` yourself.
 * - object form: select public old-input dot paths and toggle errors. Input is
 *   off unless an explicit field list is provided. Errors default to `true`.
 *
 *   getFormData({ rules, flash: { input: ['name'], errors: false } })
 */
export type FlashOptions = boolean | { input?: readonly string[] | false; errors?: boolean };

/** Resolves the explicit public-field selection and error policy. */
function resolveFlashOptions(flash: FlashOptions | undefined): { input: readonly string[] | false; errors: boolean } {
    if (flash === false) return { input: false, errors: false };
    if (flash === true || flash === undefined) return { input: false, errors: true };
    return {
        input: Array.isArray(flash.input) ? flash.input : false,
        errors: flash.errors !== false,
    };
}

/**
 * Options for `getFormData<T>()`.
 *
 * Provide `rules` (typically built with `storeRules<T>()`) to run Cossack's
 * built-in validation over the parsed data. Omit it for a simple typed DTO
 * (parse + compile-time cast, no runtime validation).
 *
 * `flash` defaults to validation errors only. Use `{ input: ['name'] }` to
 * retain selected public fields for `old()`. No submitted values enter old input
 * by default. The original parsed/validated data is unchanged.
 * Flashing is a no-op when no flash store is wired (e.g. on the client).
 */
export type GetFormDataOptions<T> = {
    rules?: StoreRuleMap<T>;
    flash?: FlashOptions;
    /**
     * Largest body read, files included; a larger one answers 413. Default: 8 MiB
     * (`FORM_DATA_MAX_BYTES`). Raise it for forms that post larger files, up to
     * what the runtime's memory allows: the body is held in memory while parsed.
     */
    maxBytes?: number;
};

/** Default `getFormData` body limit. Larger files belong on `/upload` (32 MiB) or direct storage uploads. */
export const FORM_DATA_MAX_BYTES = 8 * 1024 * 1024;

/** Hono's per-request body cache (`HonoRequest.bodyCache`), which holds promises. */
type BodyCache = Record<string, Promise<unknown> | undefined>;

/**
 * The request's form data, read into memory up to `limit` bytes. A body that
 * says or turns out to be larger answers 413 before it is buffered whole.
 *
 * Shares Hono's body cache both ways: a body already read through Hono
 * (`parseBody()`, `req.text()`, a validator) is taken from the cache, and the
 * form read here is cached for later `parseBody()` / `req.formData()` calls.
 * An oversized body is released partly read; the framework drains it before
 * the response leaves (`discardRequestBody`), as Workers needs. Cancelling it
 * here races the runtime's own body pump on Node.
 */
async function boundedFormData(req: Context['req'], limit: number): Promise<FormData> {
    const cache = (req as unknown as { bodyCache?: BodyCache }).bodyCache;
    if (cache && Object.keys(cache).length > 0) return req.formData();
    const raw = req.raw;
    const tooLarge = () => new HTTPException(413, { message: 'The form is too large.' });
    const declaredHeader = raw.headers.get('content-length')?.trim();
    const declared = declaredHeader && /^\d+$/.test(declaredHeader) ? Number(declaredHeader) : undefined;
    if (declared !== undefined && declared > limit) throw tooLarge();
    if (!raw.body) return raw.formData();
    const reader = raw.body.getReader();
    // A declared length gets one buffer up front; otherwise chunks are kept and
    // copied once at the end, dropping each as it is copied.
    let exact: Uint8Array<ArrayBuffer> | null = declared !== undefined ? new Uint8Array(declared) : null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            const end = size + next.value.byteLength;
            if (end > limit) throw tooLarge();
            if (exact && end <= exact.length) exact.set(next.value, size);
            else {
                // The body ran past its declared length: keep what came so far as one chunk.
                if (exact) { chunks.push(exact.subarray(0, size)); exact = null; }
                chunks.push(next.value);
            }
            size = end;
        }
    } finally {
        reader.releaseLock();
    }
    let body: Uint8Array<ArrayBuffer>;
    if (exact) body = exact.subarray(0, size);
    else {
        body = new Uint8Array(size);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            body.set(chunks[i]!, offset);
            offset += chunks[i]!.byteLength;
            chunks[i] = EMPTY;
        }
    }
    const headers = new Headers();
    const type = raw.headers.get('content-type');
    if (type) headers.set('content-type', type);
    const form = new Request('http://form.invalid/', { method: 'POST', headers, body }).formData();
    if (cache) cache.formData = form;
    return form;
}

const EMPTY = new Uint8Array(0);

/**
 * `getFormData<T>()` with NO rules returns the parsed data typed as `T`.
 */
export interface CossackContext {
    getFormData<T>(opts?: GetFormDataOptions<T> & { rules?: undefined }): Promise<T>;
    /**
     * `getFormData<T>({ rules })` parses AND validates. Returns the typed data,
     * a nested `errors` object mirroring the form shape, a flat dot-path-keyed
     * `flatErrors` map, and an aggregate `valid` flag (see ObjectValidationResult).
     */
    getFormData<T>(opts: GetFormDataOptions<T> & { rules: StoreRuleMap<T> }): Promise<ObjectValidationResult<T>>;
    getFormData<T>(opts: GetFormDataOptions<T>): Promise<T | ObjectValidationResult<T>>;
}

/**
 * Creates a proxy around the Hono context to provide a unified API
 * on both server and client, with runtime safety checks.
 *
 * On the server the proxy additionally exposes `getFormData<T>()`, which reads
 * `req.formData()`, parses PHP-style bracket keys into a nested object via
 * `parseFormData`, and optionally validates it with `validateObject`.
 */
export function createCossackContext(
    context: Context | HydratedContext,
    isServer: boolean
): Context {
    return new Proxy(context, {
        get(target, prop) {
            // `getFormData<T>()` — server-only convenience for nested + typed
            // (optionally validated) form data. Client access throws below.
            if (prop === 'getFormData') {
                if (!isServer) {
                    throw new Error('[Cossack] context.getFormData is only available on the server.');
                }
                return async <T = Record<string, unknown>>(opts?: GetFormDataOptions<T>) => {
                    // `target` is `Context | HydratedContext`; only the server
                    // Context has a real `req.formData()`. Cast narrowly.
                    const req = (target as Context).req;
                    const data = parseFormData(await boundedFormData(req, opts?.maxBytes ?? FORM_DATA_MAX_BYTES)) as T;
                    const { input: flashInputOn, errors: flashErrorsOn } = resolveFlashOptions(opts?.flash);
                    if (!opts?.rules) {
                        // No validation: flash the parsed input only (if enabled).
                        if (flashInputOn) {
                            flashInput(data as unknown as Record<string, unknown>, { fields: flashInputOn });
                        }
                        return data;
                    }
                    const result = await validateObject(data, opts.rules);
                    if (flashInputOn) {
                        flashInput(result.data as unknown as Record<string, unknown>, { fields: flashInputOn });
                    }
                    // Only flash errors when there are any — flashing `{}` would
                    // make truthy-empty-object error banners render on success.
                    if (flashErrorsOn && Object.keys(result.flatErrors).length > 0) {
                        flash('errors', result.errors);
                    }
                    return result;
                };
            }

            // Allow access to `req` on both client and server
            if (prop === 'req') {
                return target.req;
            }

            // On the server, delegate everything to the real Hono context
            if (isServer) {
                // Hono getters/methods use private fields. Their receiver must
                // be the original Context, including through nested proxies.
                const value = Reflect.get(target, prop, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }

            // On the client, throw an error for any other property access
            throw new Error(`[Cossack] context.${String(prop)} is only available on the server.`);
        },
        set(target, prop, value) {
            if (!isServer) throw new Error(`[Cossack] context.${String(prop)} is only available on the server.`);
            return Reflect.set(target, prop, value, target);
        },
    }) as Context; // We cast to Context to ensure type compatibility for the developer
}
