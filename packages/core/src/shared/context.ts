// src/shared/context.ts
import type { Context } from 'hono';

export type HydratedContext = {
    req: {
        param: (key?: string) => any;
    }
}

/**
 * Creates a proxy around the Hono context to provide a unified API
 * on both server and client, with runtime safety checks.
 */
export function createCossackContext(
    context: Context | HydratedContext,
    isServer: boolean
): Context {
    return new Proxy(context, {
        get(target, prop, receiver) {
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
