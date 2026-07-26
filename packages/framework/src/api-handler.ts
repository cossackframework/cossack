// src/api-handler.ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Cossack, enforceMethodRateLimit, createCossackContext } from '@cossackframework/core';

/**
 * Create an API handler for a Cossack class method.
 * This allows page components to expose HTTP method handlers (get, post, etc.)
 * while still being regular page components that render HTML.
 *
 * @param methodNames One or more candidate method names. The first name that is
 *   actually defined on the class prototype is invoked. This lets a single route
 *   support a canonical name with a fallback (e.g. `get` with `init` as an alias).
 */
export function createApiHandler(ComponentClass: new () => Cossack, methodNames: string | string[]) {
    const names = Array.isArray(methodNames) ? methodNames : [methodNames];
    return async (c: Context) => {
        // The candidate method actually invoked on this request (first defined
        // on the prototype). Hoisted out of `try` so the catch block can log it.
        let methodName: string | undefined;
        try {
            // Pick the first candidate method actually defined on this class
            // (own property only — base Cossack defines get()/init(), so `in`
            // would always match inherited methods and skip the user override).
            for (const name of names) {
                if (Object.prototype.hasOwnProperty.call(ComponentClass.prototype, name)) {
                    methodName = name;
                    break;
                }
            }
            if (!methodName) {
                return c.json({ error: 'Method Not Allowed' }, 405);
            }

            // Rate-limit gate: enforce any @RateLimit declared on the handler method.
            const rateLimited = await enforceMethodRateLimit(
                c,
                ComponentClass,
                methodName,
                `api:${c.req.method}:${c.req.path}`,
            );
            if (rateLimited) return rateLimited;

            const instance = new ComponentClass();
            // Wrap the raw Hono context with the Cossack proxy so API handlers
            // get the same augmented context as pages (e.g. `getFormData<T>()`).
            (instance as any).c = createCossackContext(c, true);

            // Call the designated API method (get, post, etc.)
            const result = await (instance as any)[methodName]();

            // If the method returns a Response object, return it directly
            if (result instanceof Response) {
                return result;
            }

            // Otherwise, automatically serialize the public state and return as JSON
            const state = instance.getPublicState();
            return c.json(state);

        } catch (error) {
            // If the error is a controlled HTTP exception, re-throw it for Hono to handle.
            if (error instanceof HTTPException) {
                throw error;
            }
            // For all other errors, return a generic 500.
            console.error(`Error in API handler for ${ComponentClass.name}.${methodName ?? names.join('/')}:`, error);
            return c.json({ error: 'Internal Server Error' }, 500);
        }
    };
}
