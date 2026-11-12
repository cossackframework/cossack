// src/api-handler.ts
import type { Context } from 'hono';
import { createServerFailureContext, logServerFailure, type ServerFailureStage } from './server-logging.js';
import { HTTPException } from 'hono/http-exception';
import { Cossack, createInstance, enforceActionAuthorization, enforceMethodRateLimit, getAuthorizationFailure, type CossackRuntimeInfo } from '@cossackframework/core';
import { createServiceScopeChain } from './service-scope-chain.js';
import { resolveRealtimeScopeKey } from './realtime-scope.js';

/** Where the handler class lives, so it is built with its layout service scopes. */
export interface ApiHandlerOptions {
    componentPath?: string;
    layouts?: Record<string, unknown>;
    owners?: Readonly<Record<string, string>>;
    routePathToIdMap?: Map<string, string>;
    runtimeInfo?: () => Promise<CossackRuntimeInfo>;
    /**
     * Largest request body a handler may read (`json()`, `text()`, `formData()`,
     * `parseBody()` and the raw stream alike). A class can raise or lower it with
     * a static `maxBodyBytes`. Default: the upload limit, 32 MiB.
     */
    maxBodyBytes?: number;
}

/** Default class-route body limit: the RPC upload limit. */
export const API_HANDLER_BODY_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Bound the request body every reader of `c.req` sees. A body that declares a
 * larger size is refused before the handler runs; one that streams past the
 * limit errors its readers, and the handler answers 413.
 */
function boundRequestBody(c: Context, limit: number): { refused: boolean; exceeded: () => boolean } {
    const raw = c.req.raw;
    let exceeded = false;
    if (!raw.body) return { refused: false, exceeded: () => false };
    const declared = raw.headers.get('content-length')?.trim();
    if (declared && /^\d+$/.test(declared) && Number(declared) > limit) return { refused: true, exceeded: () => true };
    let size = 0;
    const bounded = raw.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > limit) {
                exceeded = true;
                controller.error(new HTTPException(413, { message: 'Request body is too large.' }));
                return;
            }
            controller.enqueue(chunk);
        },
    }));
    c.req.raw = new Request(raw, { body: bounded, duplex: 'half' } as RequestInit);
    return { refused: false, exceeded: () => exceeded };
}

function tooLarge(c: Context) {
    return c.json({ error: 'Request body is too large.', code: 'COSSACK_API_INPUT_TOO_LARGE' }, 413);
}

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
export function createApiHandler(ComponentClass: new () => Cossack, methodNames: string | string[], options: ApiHandlerOptions = {}) {
    const names = Array.isArray(methodNames) ? methodNames : [methodNames];
    return async (c: Context) => {
        // The candidate method actually invoked on this request (first defined
        // on the prototype). Hoisted out of `try` so the catch block can log it.
        let methodName: string | undefined;
        const logContext = createServerFailureContext(c);
        let stage: ServerFailureStage = 'handler';
        const classLimit = (ComponentClass as unknown as { maxBodyBytes?: unknown }).maxBodyBytes;
        const limit = typeof classLimit === 'number' && Number.isSafeInteger(classLimit) && classLimit > 0
            ? classLimit : options.maxBodyBytes ?? API_HANDLER_BODY_MAX_BYTES;
        let body: { refused: boolean; exceeded: () => boolean } = { refused: false, exceeded: () => false };
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
            body = boundRequestBody(c, limit);
            if (body.refused) return tooLarge(c);

            logContext.action = methodName;
            stage = 'authorize';
            // Rate-limit gate: enforce any @RateLimit declared on the handler method.
            const rateLimited = await enforceMethodRateLimit(
                c,
                ComponentClass,
                methodName,
                // Key by the route template so `/items/1` and `/items/2` share one budget.
                `api:${c.req.method}:${(c.req as { routePath?: string }).routePath || c.req.path}`,
            );
            if (rateLimited) return rateLimited;
            // Honour @Server({ authorize }) on the handler before constructing it.
            await enforceActionAuthorization(ComponentClass, methodName, [], c, c.req.raw.signal);

            stage = 'handler';
            // Construct through DI with the same root + layout service scopes as
            // SSR and /crpc, so @Service/@Inject dependencies resolve.
            const user = c.get('user');
            const facilities = { context: c, user, env: c.env };
            const chain = await createServiceScopeChain({
                componentPath: options.componentPath ?? '',
                layouts: options.layouts ?? {},
                owners: options.owners,
                routePathToIdMap: options.routePathToIdMap ?? new Map(),
                scopeKey: await resolveRealtimeScopeKey(c, undefined),
                facilities,
            });
            let instance: Cossack | undefined;
            try {
                instance = createInstance(ComponentClass, { serviceScope: chain.scope });
                // Bootstrap provides `this.c` (the augmented Cossack context,
                // e.g. `getFormData<T>()`), `this.user` and `this.env`. The verb
                // method is the handler: `get()` must not run before `post()`
                // (it may deny or load data for a GET) nor twice for a GET.
                await instance.bootstrap({ ...facilities, runtime: await options.runtimeInfo?.(), skipInit: true, skipGet: true });

                // Call the designated API method (get, post, etc.)
                const result = await (instance as any)[methodName]();
                // The body ran past its limit: the handler worked on a cut-off body.
                if (body.exceeded()) return tooLarge(c);

                // If the method returns a Response object, return it directly
                if (result instanceof Response) {
                    return result;
                }

                stage = 'output';
                // Otherwise, automatically serialize the public state and return as JSON
                const state = instance.getPublicState();
                return c.json(state);
            } finally {
                try { await instance?.destroyAsync(); }
                finally { await chain.root.disposeAsync(); }
            }
        } catch (error) {
            // A handler that read past the body limit, whatever it made of the stream error.
            if (body.exceeded()) return tooLarge(c);
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
