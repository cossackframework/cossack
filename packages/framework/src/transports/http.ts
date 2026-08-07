// src/transports/http.ts
import { Cossack, createInstance, isRpcCallableAction, sanitizeClientState, enforceMethodRateLimit, isClientVisibleError } from '@cossackframework/core';
import type { Context } from 'hono';
import type { RouterContext } from '../route-ids.js';

/** RPC allowlist including @Server methods on injected @Service deps (see router.ts). */
function isRpcCallableActionOrService(constructor: unknown, action: unknown): boolean {
    if (isRpcCallableAction(constructor, action)) return true;
    if (typeof action !== 'string' || typeof constructor !== 'function') return false;
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', constructor) || [];
    for (const t of paramTypes) {
        if (t && typeof t === 'function' && Reflect.getMetadata('cossack:service', t)) {
            const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', t) || {};
            if (Object.prototype.hasOwnProperty.call(serverMethods, action)) return true;
        }
    }
    return false;
}

/** Upload handler — processes file uploads via multipart form data. */
export function handleUpload(ctx: RouterContext) {
    return async (c: Context) => {
        const body = await c.req.parseBody({ all: true });
        const componentRouteId = body.componentRouteId as string;
        const action = body.action as string;
        const target = body.target as string;
        const stateStr = body.state as string;
        const payloadStr = body.payload as string;

        if (!componentRouteId || !action) return c.json({ error: 'Missing componentRouteId or action' }, 400);

        const componentPath = ctx.routeIdMap.get(componentRouteId);
        if (!componentPath) return c.json({ error: 'Invalid component ID' }, 400);

        const state = stateStr ? JSON.parse(stateStr) : {};
        const payload = payloadStr ? JSON.parse(payloadStr) : [];

        // Reconstruct arguments with files
        const args = payload.map((arg: any) => {
            if (arg && typeof arg === 'object' && arg._cossack_file_id) {
                const fileId = arg._cossack_file_id;
                const file = body[fileId];
                return file;
            }
            return arg;
        });

        const user = c.get('user');
        const module = ctx.pages[componentPath] || ctx.layouts[componentPath];
        if (!module) return c.json({ error: 'Component not found' }, 404);
        const PageComponent = Object.values(module as object)[0] as new () => Cossack;
        if (!PageComponent || typeof PageComponent !== 'function') return c.json({ error: 'Invalid component' }, 500);

        const componentInstance = createInstance(PageComponent) as any;
        await componentInstance.bootstrap({
            context: c,
            user,
            env: c.env,
            runtime: await ctx.runtimeInfo?.(),
            skipInit: true,
        });

        // Rebuild component tree to find target
        componentInstance._render();

        let targetInstance = componentInstance;
        if (target && target !== targetInstance._id) {
            if (targetInstance.activeComponents.has(target)) {
                targetInstance = targetInstance.activeComponents.get(target);
            } else {
                return c.json({ error: `Target component '${target}' not found` }, 404);
            }
        }

        // Apply received state: own @State keys plus keys in the instance's
        // public state (covers @Service state). Blocks internal/security props.
        const safeState = sanitizeClientState(targetInstance.constructor, state);
        for (const key in safeState) {
            (targetInstance as any)[key] = safeState[key];
        }
        const publicStateKeys = new Set(Object.keys(targetInstance.getPublicState()));
        if (state && typeof state === 'object') {
            for (const key of Object.keys(state)) {
                if (key in safeState) continue;
                if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
                if (publicStateKeys.has(key)) (targetInstance as any)[key] = (state as Record<string, unknown>)[key];
            }
        }

        // Authorisation gate: only @Server-registered methods are RPC-callable
        // (including @Server methods on injected @Service dependencies).
        if (!isRpcCallableActionOrService(targetInstance.constructor, action)) {
            return c.json({ error: `Action '${action}' is not a callable server method` }, 403);
        }

        // Rate-limit gate: enforce any @RateLimit declared on the action.
        // If this is a forwarded @Service method, the metadata lives on the service class.
        let rateLimitConstructor: unknown = targetInstance.constructor;
        if (!isRpcCallableAction(rateLimitConstructor, action)) {
            const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', targetInstance.constructor) || [];
            for (const t of paramTypes) {
                if (t && typeof t === 'function' && Reflect.getMetadata('cossack:service', t)) {
                    const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', t) || {};
                    if (Object.prototype.hasOwnProperty.call(serverMethods, action)) {
                        rateLimitConstructor = t;
                        break;
                    }
                }
            }
        }

        const rateLimited = await enforceMethodRateLimit(c, rateLimitConstructor, action, `upload:${componentRouteId}`);
        if (rateLimited) return rateLimited;

        if (typeof targetInstance[action] !== 'function') return c.json({ error: `Action '${action}' not found` }, 404);

        let actionResult: unknown;
        try {
            actionResult = await targetInstance[action](...args);
        } catch (e: any) {
            // `ClientVisibleError` (caller's fault, message is user-facing) →
            // 400 with the message forwarded so form handlers can display it
            // (e.g. "email already exists"). Anything else is an internal
            // failure → 500, logged server-side, generic message to the client
            // so internals / file paths / stack details never leak.
            if (isClientVisibleError(e)) {
                return c.json({ error: e.message }, 400);
            }
            console.error('[/upload] internal error:', e);
            const isDev = (import.meta as any).env?.DEV;
            return c.json({ error: isDev ? (e?.stack || String(e)) : 'Internal Server Error' }, 500);
        }

        const location = c.res.headers.get('Location');
        if (location) return c.json({ _cossack_redirect: location });
        if (actionResult instanceof Response) return actionResult;

        // Get the state of the component that was actually modified
        const responseData = targetInstance.getPublicState();
        if (actionResult !== undefined) {
            (responseData as any)._cossack_return = actionResult;
        }

        return c.json(responseData);
    };
}
