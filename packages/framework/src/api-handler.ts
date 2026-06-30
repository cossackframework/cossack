// src/api-handler.ts
import 'reflect-metadata';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Cossack, enforceMethodRateLimit } from '@cossackframework/core';

/**
 * Create an API handler for a Cossack class method.
 * This allows page components to expose HTTP method handlers (post, put, etc.)
 * while still being regular page components that render HTML.
 */
export function createApiHandler(ComponentClass: new () => Cossack, methodName: string) {
    return async (c: Context) => {
        try {
            // Rate-limit gate: enforce any @RateLimit declared on the handler method.
            const rateLimited = await enforceMethodRateLimit(
                c,
                ComponentClass,
                methodName,
                `api:${c.req.method}:${c.req.path}`,
            );
            if (rateLimited) return rateLimited;

            const instance = new ComponentClass();
            // Manually set the context for the instance
            (instance as any).c = c;

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
            console.error(`Error in API handler for ${ComponentClass.name}.${methodName}:`, error);
            return c.json({ error: 'Internal Server Error' }, 500);
        }
    };
}
