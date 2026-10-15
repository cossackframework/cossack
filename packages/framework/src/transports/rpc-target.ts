import { Cossack } from '@cossackframework/core';
import { APP_FILE_PATH, classifyRoute, filePathToHttpRoute, resolveLayoutPaths, routeParameters, type RouterContext } from '../route-ids.js';
import { getModuleDefault } from '../module-default.js';

/*
 * Transport requests name a page, layout or service and carry the route params
 * of the page the browser is on. All of that is client input. These resolvers
 * accept only params the router can produce for that page, so that transport
 * guards run with the params SSR of that URL would give them.
 */

type TargetContext = Pick<RouterContext, 'routeIdMap' | 'pages' | 'layouts'>;

/** A layout-service call, checked against the page the browser is on. */
export interface ServiceRpcTarget {
    /** Layout that declares the service. */
    ownerPath: string;
    /** Stable declaration slot of the service in that layout. */
    slot: string;
    /** Page the browser is on. Its layout and page guards run before the service. */
    pagePath: string;
    /** Route params of that page, in the shape the router produces for it. */
    params: Record<string, string>;
}

/** A component RPC call, checked against the page the browser is on. */
export interface ComponentRpcTarget {
    /** The page, layout or App component whose action runs. */
    componentPath: string;
    /**
     * Whose guards run: the page the browser is on for a page or layout
     * component (every layout and page guard, as SSR runs them), or the App.
     */
    guardPath: string;
    /** Route params of that page. The App component receives none. */
    params: Record<string, string>;
}

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const isDotSegment = (segment: string) => segment === '.' || segment === '..';

const isPage = (ctx: TargetContext, path: string) => {
    if (!Object.hasOwn(ctx.pages, path)) return false;
    const Page = getModuleDefault(ctx.pages[path]);
    return typeof Page === 'function' && Page.prototype instanceof Cossack;
};

/**
 * Resolve the owner, page and route params of a layout-service call. All of
 * them come from the browser, so none is trusted: the page must be a page under
 * the owning layout, and the params must be ones the router can produce for
 * that page's route. The caller then runs the page's layout and page guards
 * with these params, as SSR does, before it builds the service.
 */
export function resolveServiceRpcTarget(ctx: TargetContext, body: Record<string, unknown>): ServiceRpcTarget | undefined {
    const service = body.service as { ownerRouteId?: unknown; slot?: unknown } | undefined;
    if (!service || typeof service !== 'object' || typeof service.ownerRouteId !== 'string' || typeof service.slot !== 'string') return undefined;
    const ownerPath = ctx.routeIdMap.get(service.ownerRouteId);
    if (!ownerPath || !Object.hasOwn(ctx.layouts, ownerPath)) return undefined;
    if (typeof body.componentRouteId !== 'string') return undefined;
    const pagePath = ctx.routeIdMap.get(body.componentRouteId);
    if (!pagePath || !isPage(ctx, pagePath)) return undefined;
    if (!resolveLayoutPaths(pagePath, Object.keys(ctx.layouts)).includes(ownerPath)) return undefined;
    const params = checkRouteParams(pagePath, body.pageParams);
    return params && { ownerPath, slot: service.slot, pagePath, params };
}

/**
 * Resolve a component RPC call. `component` is undefined for an unknown
 * component id, and `params` for params or a page that do not fit.
 *
 * - A page component runs under itself, with `pageParams` checked against its
 *   route. Missing `pageParams` means none.
 * - A layout component runs under the page the browser is on (`pageRouteId`),
 *   which the layout must enclose, with that page's checked params.
 * - The App component keeps its own guards and receives no params.
 */
export function resolveComponentRpcTarget(ctx: TargetContext, body: Record<string, unknown>):
    { target: ComponentRpcTarget } | { error: 'component' | 'params' } {
    const componentPath = typeof body.componentRouteId === 'string' ? ctx.routeIdMap.get(body.componentRouteId) : undefined;
    if (!componentPath) return { error: 'component' };
    if (componentPath === APP_FILE_PATH) return { target: { componentPath, guardPath: componentPath, params: {} } };
    let pagePath = componentPath;
    if (Object.hasOwn(ctx.layouts, componentPath)) {
        const page = typeof body.pageRouteId === 'string' ? ctx.routeIdMap.get(body.pageRouteId) : undefined;
        if (!page || !isPage(ctx, page) || !resolveLayoutPaths(page, Object.keys(ctx.layouts)).includes(componentPath)) {
            return { error: 'params' };
        }
        pagePath = page;
    } else if (!Object.hasOwn(ctx.pages, componentPath)) {
        return { error: 'component' };
    }
    const params = checkRouteParams(pagePath, body.pageParams ?? {});
    return params ? { target: { componentPath, guardPath: pagePath, params } } : { error: 'params' };
}

/**
 * The params of a WebSocket upgrade for a page (exact route params) or a
 * layout (its own params, plus any of the page below it).
 */
export function checkSocketRouteParams(ctx: TargetContext, componentPath: string, value: unknown): Record<string, string> | undefined {
    if (Object.hasOwn(ctx.layouts, componentPath) && !Object.hasOwn(ctx.pages, componentPath)) {
        return checkRouteParams(componentPath, value, true);
    }
    return checkRouteParams(componentPath, value);
}

/**
 * Params that the router can produce for the route of `componentPath`: the
 * same names, non-empty string values and no dot segments. A layout, a 404 or
 * an error boundary renders with the params of a route below it, so it may
 * carry more params than its own route. API routes are never addressed here.
 */
export function checkRouteParams(componentPath: string, value: unknown, layout = false): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    let pattern: string;
    let declared: ReturnType<typeof routeParameters>;
    try {
        pattern = filePathToHttpRoute(layout ? componentPath.replace(/\/layout\.ts$/, '/index.ts') : componentPath);
        declared = routeParameters(pattern);
    } catch { return undefined; }
    const supplied = Reflect.ownKeys(value);
    const params: Record<string, string> = Object.create(null);
    for (const key of supplied) {
        if (typeof key !== 'string' || !PARAMETER_NAME.test(key)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !descriptor.value) return undefined;
        if (isDotSegment(descriptor.value)) return undefined;
        params[key] = descriptor.value;
    }
    // The router never produces a dot segment: URL parsing removes them.
    for (const { name, catchAll } of declared) {
        const param = params[name];
        if (param === undefined) return undefined;
        if (catchAll && param.split('/').some(isDotSegment)) return undefined;
    }
    const kind = classifyRoute(pattern);
    if (kind === 'api') return undefined;
    if (kind === 'page' && !layout && supplied.length !== declared.length) return undefined;
    return { ...params };
}
