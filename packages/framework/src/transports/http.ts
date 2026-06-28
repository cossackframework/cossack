// src/transports/http.ts
import { Cossack, createInstance, isRpcCallableAction, sanitizeClientState } from '@cossackframework/core';
import type { Context } from 'hono';

export interface RouterContext {
    routeIdMap: Map<string, string>;
    routePathToIdMap: Map<string, string>;
    routePathToFilePathMap: Map<string, string>;
    pages: Record<string, any>;
    layouts: Record<string, any>;
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
        await componentInstance.bootstrap({ context: c, user, env: c.env, skipInit: true });

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

        // Apply the received state to the target component, restricted to @State
        // keys only — prevents overwriting internal/security-sensitive props.
        const safeState = sanitizeClientState(targetInstance.constructor, state);
        for (const key in safeState) {
            (targetInstance as any)[key] = safeState[key];
        }

        // Authorisation gate: only @Server-registered methods are RPC-callable.
        if (!isRpcCallableAction(targetInstance.constructor, action)) {
            return c.json({ error: `Action '${action}' is not a callable server method` }, 403);
        }

        if (typeof targetInstance[action] !== 'function') return c.json({ error: `Action '${action}' not found` }, 404);

        const actionResult = await targetInstance[action](...args);

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
