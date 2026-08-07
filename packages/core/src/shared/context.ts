// src/shared/context.ts
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
    }
}

/**
 * Controls automatic flash-scoping of submitted input and validation errors.
 *
 * - `true` (default): flash both the parsed input (for `old()` repopulation) and
 *   the validation `errors` (only when non-empty) to the next request.
 * - `false`: flash nothing — you call `flashInput`/`flash` yourself.
 * - object form: toggle each category independently. Unspecified keys default
 *   to `true`.
 *
 *   getFormData(opts, { flash: { errors: false } })  // input only
 */
export type FlashOptions = boolean | { input?: boolean; errors?: boolean };

/** Resolves `FlashOptions` to explicit `{ input, errors }` booleans. */
function resolveFlashOptions(flash: FlashOptions | undefined): { input: boolean; errors: boolean } {
    if (flash === false) return { input: false, errors: false };
    if (flash === true || flash === undefined) return { input: true, errors: true };
    return {
        input: flash.input !== false,
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
 * `flash` (default `true`) automatically flashes the submitted input and any
 * validation errors to the next request, so you can skip the manual
 * `flashInput(data)` / `flash('errors', errors)` calls before `return this.back()`.
 * Flashing is a no-op when no flash store is wired (e.g. on the client).
 */
export type GetFormDataOptions<T> = {
    rules?: StoreRuleMap<T>;
    flash?: FlashOptions;
};

/**
 * `getFormData<T>()` with NO rules returns the parsed data typed as `T`.
 */
export interface CossackContext {
    getFormData<T>(): Promise<T>;
    /**
     * `getFormData<T>({ rules })` parses AND validates. Returns the typed data,
     * a nested `errors` object mirroring the form shape, a flat dot-path-keyed
     * `flatErrors` map, and an aggregate `valid` flag (see ObjectValidationResult).
     */
    getFormData<T>(opts: GetFormDataOptions<T>): Promise<ObjectValidationResult<T>>;
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
        get(target, prop, receiver) {
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
                    const data = parseFormData(await req.formData()) as T;
                    const { input: flashInputOn, errors: flashErrorsOn } = resolveFlashOptions(opts?.flash);
                    if (!opts?.rules) {
                        // No validation: flash the parsed input only (if enabled).
                        if (flashInputOn) {
                            flashInput(data as unknown as Record<string, unknown>);
                        }
                        return data;
                    }
                    const result = await validateObject(data, opts.rules);
                    if (flashInputOn) {
                        flashInput(result.data as unknown as Record<string, unknown>);
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
                return Reflect.get(target, prop, receiver);
            }

            // On the client, throw an error for any other property access
            throw new Error(`[Cossack] context.${String(prop)} is only available on the server.`);
        }
    }) as Context; // We cast to Context to ensure type compatibility for the developer
}
