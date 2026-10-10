// src/api-handler.ts
import type { Context } from 'hono';
import { createServerFailureContext, logServerFailure, type ServerFailureStage } from './server-logging.js';
import { HTTPException } from 'hono/http-exception';
import { Cossack, enforceMethodRateLimit, createCossackContext, getAuthorizationFailure } from '@cossackframework/core';

/** @internal Find an authored member without treating framework defaults as handlers. */
export function getAuthoredRouteMember(ComponentClass: new () => Cossack, name: string): PropertyDescriptor | undefined {
    for (let prototype = ComponentClass.prototype;
        prototype && prototype !== Cossack.prototype;
        prototype = Object.getPrototypeOf(prototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (descriptor) return descriptor;
    }
    return undefined;
}

/**
 * Create an API handler for a Cossack class method.
 * This allows page components to expose HTTP method handlers (get, post, etc.)
 * while still being regular page components that render HTML.
 *
 * @param methodNames One or more candidate method names. The first name that is
 *   defined on the class or an authored ancestor is invoked. This lets a single route
 *   support a canonical name with a fallback (e.g. `get` with `init` as an alias).
 */
export function createApiHandler(ComponentClass: new () => Cossack, methodNames: string | string[]) {
    const names = Array.isArray(methodNames) ? methodNames : [methodNames];
    return async (c: Context) => {
        // The candidate method actually invoked on this request (first defined
        // on the prototype). Hoisted out of `try` so the catch block can log it.
        let methodName: string | undefined;
        const logContext = createServerFailureContext(c);
        let stage: ServerFailureStage = 'handler';
        try {
            // Prefer authored get() over init(), including inherited handlers.
            // Stop before the framework's default methods and do not invoke getters.
            for (const name of names) {
                if (typeof getAuthoredRouteMember(ComponentClass, name)?.value === 'function') {
                    methodName = name;
                    break;
                }
            }
            if (!methodName) {
                return c.json({ error: 'Method Not Allowed' }, 405);
            }

            logContext.action = methodName;
            stage = 'authorize';
            // Rate-limit gate: enforce any @RateLimit declared on the handler method.
            const rateLimited = await enforceMethodRateLimit(
                c,
                ComponentClass,
                methodName,
                `api:${c.req.method}:${c.req.path}`,
            );
            if (rateLimited) return rateLimited;

            stage = 'handler';
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

            stage = 'output';
            // Otherwise, automatically serialize the public state and return as JSON
            const state = instance.getPublicState();
            return c.json(state);

        } catch (error) {
            const denial = getAuthorizationFailure(error);
            if (denial) {
                const requestId = logContext.requestId;
                c.header('X-Cossack-Request-Id', requestId);
                return c.json({ error: denial.message, code: denial.code, requestId }, denial.status);
            }
            // If the error is a controlled HTTP exception, re-throw it for Hono to handle.
            if (error instanceof HTTPException) {
                throw error;
            }
            // For all other errors, return a generic 500.
            logServerFailure(logContext, 'api', stage, 'COSSACK_API_INTERNAL');
            c.header('X-Cossack-Request-Id', logContext.requestId);
            return c.json({ error: 'Internal Server Error', code: 'COSSACK_API_INTERNAL', requestId: logContext.requestId }, 500);
        }
    };
}
