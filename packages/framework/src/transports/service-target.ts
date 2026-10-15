import { Cossack } from '@cossackframework/core';
import { classifyRoute, filePathToHttpRoute, resolveLayoutPaths, routeParameters, type RouterContext } from '../route-ids.js';
import { getModuleDefault } from '../module-default.js';

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

const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const isDotSegment = (segment: string) => segment === '.' || segment === '..';

/**
 * Resolve the owner, page and route params of a layout-service call. All of
 * them come from the browser, so none is trusted: the page must be a page under
 * the owning layout, and the params must be ones the router can produce for
 * that page's route. The caller then runs the page's layout and page guards
 * with these params, as SSR does, before it builds the service.
 */
export function resolveServiceRpcTarget(ctx: Pick<RouterContext, 'routeIdMap' | 'pages' | 'layouts'>,
    body: Record<string, unknown>): ServiceRpcTarget | undefined {
    const service = body.service as { ownerRouteId?: unknown; slot?: unknown } | undefined;
    if (!service || typeof service !== 'object' || typeof service.ownerRouteId !== 'string' || typeof service.slot !== 'string') return undefined;
    const ownerPath = ctx.routeIdMap.get(service.ownerRouteId);
    if (!ownerPath || !Object.hasOwn(ctx.layouts, ownerPath)) return undefined;
    if (typeof body.componentRouteId !== 'string') return undefined;
    const pagePath = ctx.routeIdMap.get(body.componentRouteId);
    if (!pagePath || !Object.hasOwn(ctx.pages, pagePath)) return undefined;
    const Page = getModuleDefault(ctx.pages[pagePath]);
    if (typeof Page !== 'function' || !(Page.prototype instanceof Cossack)) return undefined;
    if (!resolveLayoutPaths(pagePath, Object.keys(ctx.layouts)).includes(ownerPath)) return undefined;
    const params = checkRouteParams(pagePath, body.pageParams);
    return params && { ownerPath, slot: service.slot, pagePath, params };
}

function checkRouteParams(pagePath: string, value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    let pattern: string;
    let declared: ReturnType<typeof routeParameters>;
    try {
        pattern = filePathToHttpRoute(pagePath);
        declared = routeParameters(pattern);
    } catch { return undefined; }
    const supplied = Reflect.ownKeys(value);
    const params: Record<string, string> = Object.create(null);
    for (const key of supplied) {
        if (typeof key !== 'string' || !PARAMETER_NAME.test(key)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !descriptor.value) return undefined;
        params[key] = descriptor.value;
    }
    // The router never produces a dot segment: URL parsing removes them.
    for (const { name, catchAll } of declared) {
        const param = params[name];
        if (param === undefined) return undefined;
        if (catchAll ? param.split('/').some(isDotSegment) : isDotSegment(param)) return undefined;
    }
    // A 404 or error boundary renders with the params of the route below it
    // that did not match or failed, so it can carry more params than its own
    // route. Every other page carries exactly the params of its route.
    const kind = classifyRoute(pattern);
    if (kind === 'api') return undefined;
    if (kind === 'page' && supplied.length !== declared.length) return undefined;
    return { ...params };
}
