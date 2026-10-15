import { Cossack } from '@cossackframework/core';
import { TrieRouter } from 'hono/router/trie-router';
import { APP_FILE_PATH, classifyRoute, compareHttpRoutes, filePathToHttpRoute, resolveLayoutPaths, resolvePageRouteFiles, routeParameters, type RouterContext } from '../route-ids.js';
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

/** A page file whose default export is a Cossack component. */
export const isPage = (ctx: TargetContext, path: string) => {
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
    const params = checkPageRouteParams(ctx, pagePath, body.pageParams);
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
    const params = checkPageRouteParams(ctx, pagePath, body.pageParams ?? {});
    return params ? { target: { componentPath, guardPath: pagePath, params } } : { error: 'params' };
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

const pageMatchers = new WeakMap<object, TrieRouter<string>>();

/**
 * The router's page table: every routable page, added in the order the router
 * registers pages (most specific first), so the first match is the page the
 * router dispatches a URL to. Built once per page registry; it holds only file
 * paths and patterns.
 */
function pageMatcher(pages: Record<string, unknown>): TrieRouter<string> {
    let matcher = pageMatchers.get(pages);
    if (!matcher) {
        matcher = new TrieRouter<string>();
        const routes = resolvePageRouteFiles(Object.keys(pages))
            .map(path => ({ path, pattern: filePathToHttpRoute(path) }))
            .filter(({ pattern }) => classifyRoute(pattern) === 'page')
            .sort((a, b) => compareHttpRoutes(a.pattern, b.pattern));
        for (const { path, pattern } of routes) matcher.add('GET', pattern, path);
        pageMatchers.set(pages, matcher);
    }
    return matcher;
}

/**
 * The request path that produces `params` for `pattern`, normalized the way the
 * router sees it: each value is percent-encoded, then decoded with `decodeURI`,
 * which keeps reserved characters such as `/` encoded. A catch-all keeps its
 * slashes as segment separators. Undefined when a value cannot be encoded.
 */
function routePathFor(pattern: string, params: Record<string, string>): string | undefined {
    const encode = (value: string) => decodeURI(encodeURIComponent(value));
    try {
        return pattern.split('/').map(segment => {
            const match = /^:([^{}]+)(\{\.\+\})?$/.exec(segment);
            if (!match) return segment;
            const value = params[match[1]];
            return match[2] ? value.split('/').map(encode).join('/') : encode(value);
        }).join('/');
    } catch { return undefined; }
}

/**
 * Route params of a page, checked as client input: they must fit the page's
 * route (see `checkRouteParams`), and the URL they produce must be one the
 * router dispatches to that page. Params that a more specific sibling route
 * would match (`team: 'new'` next to a literal `/teams/new` page) are rejected,
 * so a request never runs one page's guards for another page's URL. 404 and
 * error pages render under other routes, so they skip the dispatch check.
 */
export function checkPageRouteParams(ctx: Pick<TargetContext, 'pages'>, pagePath: string, value: unknown): Record<string, string> | undefined {
    const params = checkRouteParams(pagePath, value);
    if (!params) return undefined;
    const pattern = filePathToHttpRoute(pagePath);
    if (classifyRoute(pattern) !== 'page') return params;
    const path = routePathFor(pattern, params);
    if (path === undefined) return undefined;
    const winner = pageMatcher(ctx.pages).match('GET', path)[0][0]?.[0];
    return winner === pagePath ? params : undefined;
}
