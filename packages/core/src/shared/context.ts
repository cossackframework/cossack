// src/shared/context.ts
import type { Context } from 'hono';
import { createContext } from '@cossackframework/renderer';
import { parseFormData } from './forms';
import { StoreRuleMap, validateObject } from './validation';

export const EnvContext = createContext<any>(undefined);
export const UserContext = createContext<any>(undefined);
export const RequestContext = createContext<Context | undefined>(undefined);

export type HydratedContext = {
    req: {
        param: (key?: string) => any;
        path: string;
        query: (key?: string) => any;
    }
}

/**
 * Options for `getFormData<T>()`.
 *
 * Provide `rules` (typically built with `storeRules<T>()`) to run Cossack's
 * built-in validation over the parsed data. Omit it for a simple typed DTO
 * (parse + compile-time cast, no runtime validation).
 */
export type GetFormDataOptions<T> = {
    rules?: StoreRuleMap<T>;
};

/**
 * `getFormData<T>()` with NO rules returns the parsed data typed as `T`.
 */
export interface CossackContext {
    getFormData<T>(): Promise<T>;
    /**
     * `getFormData<T>({ rules })` parses AND validates. Returns the typed data
     * plus a map of dot-path → error message and an aggregate `valid` flag.
     */
    getFormData<T>(opts: GetFormDataOptions<T>): Promise<{
        data: T;
        errors: Partial<Record<string, string>>;
        valid: boolean;
    }>;
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
                    if (!opts?.rules) return data;
                    return validateObject(data, opts.rules);
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
