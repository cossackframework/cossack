import { isOriginAllowed, RpcError } from '@cossackframework/core';
import type { Context, MiddlewareHandler } from 'hono';
import type { RouterContext } from '../route-ids.js';
import { readRpcRequest, RPC_JSON_REQUEST_MAX_BYTES } from './http.js';
import { discardRequestBody } from '../request-body.js';
import { withRuntimeRouteParams } from '../runtime-websocket.js';
import { isTransportPath, TRANSPORT_ACTION, TRANSPORT_GUARD_PATH, TRANSPORT_TARGET_PATH } from '../transport-routes.js';
import { checkPageRouteParams, checkRouteParams, resolveComponentRpcTarget, resolveServiceRpcTarget } from './rpc-target.js';
import { realtimeOwnerMiddlewares, resolveRealtimeConnection } from './realtime-target.js';

/**
 * The route params of an SSE subscription (its `params` query: the page's
 * params as SSR saw them), checked as client input with the rule of a
 * WebSocket upgrade. Undefined when they are not JSON or do not fit the route.
 * The guards, the scope key, the cold start and every revalidation of the
 * subscription use these params.
 */
export function checkSseRouteParams(
    ctx: Pick<RouterContext, 'routeIdMap' | 'pages' | 'layouts'>,
    componentPath: string,
    encoded: string | undefined,
): Record<string, string> | undefined {
    // A layout renders with the params of the page below it, so it may carry
    // more params than its own route; a page must match its route exactly.
    const layout = Object.hasOwn(ctx.layouts, componentPath) && !Object.hasOwn(ctx.pages, componentPath);
    try {
        const value: unknown = JSON.parse(encoded ?? '{}');
        return layout ? checkRouteParams(componentPath, value, true) : checkPageRouteParams(ctx, componentPath, value);
    }
    catch { return undefined; }
}

/**
 * Apply the addressed page/layout guards before any transport can bootstrap it.
 * RPC calls, SSE subscriptions and WebSocket upgrades run the guards once, with
 * the page's route params checked as client input, exactly as SSR of that URL
 * runs them. Invalid params answer 400 before any guard runs. An open SSE
 * stream runs the guards again, with the same params, each time it revalidates.
 */
export function protectTransport(ctx: RouterContext): MiddlewareHandler {
    return async (c, next) => {
        let componentPath: string | undefined;
        let targetPath: string | undefined;
        let action: string | undefined;
        let ownerMiddlewares: MiddlewareHandler[] = [];
        let guarded: Context = c;
        if (c.req.method === 'POST') {
            // Multipart and text/plain requests can be sent without a CORS preflight.
            // CORS response headers alone cannot prevent their side effects.
            if (!isOriginAllowed(c.req.header('origin'), c.req.url, ctx.allowedOrigins)) {
                // Drain (bounded) before rejecting so the connection stays usable.
                await discardRequestBody(c.req.raw, ctx.rpcBodyLimits?.jsonBytes ?? RPC_JSON_REQUEST_MAX_BYTES);
                return c.text('Origin not allowed', 403);
            }
            const suppliedId = c.req.header('X-Cossack-Request-Id');
            // Correlation is public data, never an identity or authorization key.
            // Bound accepted IDs to UUID v4; arbitrary/oversized values get a fresh ID.
            const requestId = suppliedId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId)
                ? suppliedId : crypto.randomUUID();
            c.res.headers.set('X-Cossack-Request-Id', requestId);
            try {
                const body = await readRpcRequest(c, ctx.rpcBodyLimits);
                if (!body || typeof body !== 'object' || Array.isArray(body)) {
                    return c.json({ error: 'Invalid transport body' }, 400);
                }
                if (typeof body.action === 'string') action = body.action;
                if (body.service !== undefined) {
                    // A layout service runs under the page the browser is on.
                    // Guard it like SSR of that page: every layout and page
                    // guard, with the page's checked route params.
                    const target = resolveServiceRpcTarget(ctx, body);
                    if (!target) return c.json({ error: 'Invalid service target', code: 'COSSACK_RPC_REQUEST_INVALID', requestId }, 400);
                    componentPath = target.pagePath;
                    targetPath = target.ownerPath;
                    guarded = withRuntimeRouteParams(c, target.params);
                } else {
                    const resolved = resolveComponentRpcTarget(ctx, body);
                    if ('error' in resolved) {
                        if (resolved.error === 'params') return c.json({ error: 'Invalid route params', code: 'COSSACK_RPC_REQUEST_INVALID', requestId }, 400);
                    } else {
                        componentPath = resolved.target.guardPath;
                        targetPath = resolved.target.componentPath;
                        guarded = withRuntimeRouteParams(c, resolved.target.params);
                    }
                }
            } catch (error) {
                if (error instanceof RpcError && error.code === 'COSSACK_RPC_REQUEST_TOO_LARGE') {
                    return c.json({ error: error.message, code: error.code, requestId }, 413);
                }
                return c.json({ error: error instanceof RpcError ? error.message : 'Invalid transport body',
                    code: 'COSSACK_RPC_REQUEST_INVALID', requestId }, 400);
            }
        } else if (isTransportPath(c.req.path, 'sse')) {
            // A cross-site subscription is refused before any guard runs (an
            // EventSource from the same page may omit Origin).
            const origin = c.req.header('origin');
            if (origin && !isOriginAllowed(origin, c.req.url, ctx.allowedOrigins)) return c.text('Origin not allowed', 403);
            // A subscription names a page (or layout) and carries its route
            // params. The guards run once, here, before the stream opens, with
            // the params that the scope key and revalidations use.
            const path = ctx.routeIdMap.get(c.req.param('componentRouteId') ?? '');
            if (path && (Object.hasOwn(ctx.pages, path) || Object.hasOwn(ctx.layouts, path))) {
                const params = checkSseRouteParams(ctx, path, c.req.query('params'));
                if (!params) return c.json({ error: 'Invalid route params', code: 'COSSACK_RPC_REQUEST_INVALID' }, 400);
                componentPath = path;
                guarded = withRuntimeRouteParams(c, params);
            }
        } else {
            // A WebSocket upgrade names its realtime owner and the page the
            // browser is on. A page or a component runs that page's layout
            // and page guards; a layout runs its own guard stack. All of them
            // see the page's checked route params, which also name the
            // instance, so the guards decide on the same values.
            // A cross-site upgrade (a page opening a socket with the victim's
            // cookies) is refused before any guard runs, as a POST is.
            if (!isOriginAllowed(c.req.header('origin'), c.req.url, ctx.allowedOrigins)) return c.text('Origin not allowed', 403);
            const resolved = resolveRealtimeConnection(ctx, name => c.req.query(name));
            if ('error' in resolved) {
                if (resolved.error === 'owner' && resolved.status === 404) return c.json({ error: 'Invalid component ID' }, 400);
                return c.text(resolved.message, 400);
            }
            componentPath = resolved.target.guardPath;
            // The owner's own code runs: for a realtime component, its registry id, never the page the
            // browser names (client input, which only selects the guards).
            targetPath = resolved.target.owner.id;
            ownerMiddlewares = realtimeOwnerMiddlewares(resolved.target.owner);
            guarded = withRuntimeRouteParams(c, resolved.target.params);
        }
        if (!componentPath) return c.json({ error: 'Invalid component ID' }, 400);
        // Layout guards see /crpc as the path; this names the page whose guards run.
        guarded.set(TRANSPORT_GUARD_PATH, componentPath);
        // ...and this names the file whose code runs: a layout's action runs under the client's page.
        guarded.set(TRANSPORT_TARGET_PATH, targetPath ?? componentPath);
        // ...and, for an RPC call, the action it names there.
        if (action !== undefined) guarded.set(TRANSPORT_ACTION, action);
        // A realtime component's own guards run after its page's guards.
        const middlewares = [...ctx.getMiddlewares?.(componentPath) ?? [], ...ownerMiddlewares];
        // Preserve short-circuit responses and after-next headers without
        // replacing Hono's route index (which resolves transport params).
        let index = -1;
        const dispatch = async (position: number): Promise<void> => {
            if (position <= index) throw new Error('next() called multiple times');
            index = position;
            const middleware = middlewares[position];
            if (!middleware) return next();
            const response = await middleware(guarded, () => dispatch(position + 1));
            // `return next()` resolves to the Context, not a Response; only a Response replaces the reply.
            if (response instanceof Response) c.res = response;
        };
        await dispatch(0);
        const location = c.res.headers.get('Location');
        if (c.req.method === 'POST' && c.res.status >= 300 && c.res.status < 400 && location) {
            c.res.headers.delete('Location');
            c.res = c.json({ _cossack_redirect: location }, 200);
        }
        return c.res;
    };
}
