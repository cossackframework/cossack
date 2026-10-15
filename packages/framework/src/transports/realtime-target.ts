import type { Cossack, PageOptions } from '@cossackframework/core';
import type { MiddlewareHandler } from 'hono';
import { resolveLayoutPaths, type RouterContext } from '../route-ids.js';
import { getModuleDefault } from '../module-default.js';
import { isRealtimeOwner, type RealtimeOwner } from '../realtime-scope.js';
import { checkPageRouteParams, isPage } from './rpc-target.js';

/*
 * A WebSocket upgrade names the realtime owner it connects to and the page the
 * browser is on. All of it is client input. This resolver accepts only owners
 * that are realtime, pages the router can render, and params the router can
 * produce for that page, and it decides whose guards run. The caller then
 * recomputes the instance from the owner and its scope; the client never
 * chooses it.
 *
 * Upgrade query, by owner:
 *
 * - page:      `routePath` (the page's route path), `params`
 * - layout:    `layout` (the layout's route id), `page` (route id), `params`
 * - component: `component` (registry id), `page` (route id), `params`
 *
 * `params` are always the route params of the page the browser is on.
 */

export type RealtimeTargetContext = Pick<RouterContext, 'routeIdMap' | 'routePathToFilePathMap' | 'pages' | 'layouts' | 'realtimeComponents'>;

export interface RealtimeConnectionTarget {
    owner: RealtimeOwner;
    Component: new () => Cossack;
    /**
     * Whose guard stack runs (for the upgrade and again for each action): the
     * page for a page or a component, the layout itself for a layout.
     */
    guardPath: string;
    /** The page the browser is on. */
    pagePath: string;
    /** Route params of that page, checked against its route. */
    params: Record<string, string>;
}

export type RealtimeTargetResult =
    | { target: RealtimeConnectionTarget }
    | { error: 'owner' | 'params' | 'transport'; status: 400 | 404; message: string };

const ownerError = (message: string): RealtimeTargetResult => ({ error: 'owner', status: 404, message });
const paramsError: RealtimeTargetResult = { error: 'params', status: 400, message: 'Invalid WebSocket route params' };
const transportError: RealtimeTargetResult = { error: 'transport', status: 400, message: 'The WebSocket target is not a realtime owner' };

function componentClass(module: unknown): (new () => Cossack) | undefined {
    const Component = module && getModuleDefault(module as object);
    return typeof Component === 'function' ? Component as new () => Cossack : undefined;
}

function optionsOf(Component: Function): PageOptions | undefined {
    return Reflect.getMetadata('page:options', Component) as PageOptions | undefined;
}

function parseParams(encoded: string | undefined): unknown {
    if (encoded === undefined) return {};
    try { return JSON.parse(encoded); } catch { return undefined; }
}

/** The realtime component registered under `id`, if the build registered it. */
export function realtimeComponentClass(ctx: Pick<RouterContext, 'realtimeComponents'>, id: string): (new () => Cossack) | undefined {
    const registry = ctx.realtimeComponents;
    if (!registry || !Object.hasOwn(registry, id)) return undefined;
    const Component = registry[id];
    return typeof Component === 'function' ? Component : undefined;
}

/** Resolve and check the owner, page and params of a WebSocket upgrade. */
export function resolveRealtimeConnection(ctx: RealtimeTargetContext, query: (name: string) => string | undefined): RealtimeTargetResult {
    const layoutRouteId = query('layout');
    const componentId = query('component');
    if (layoutRouteId !== undefined && componentId !== undefined) return ownerError('A WebSocket upgrade names one realtime owner');

    if (layoutRouteId === undefined && componentId === undefined) {
        const routePath = query('routePath') || query('componentPath');
        if (!routePath) return { error: 'owner', status: 400, message: 'routePath query parameter is required' };
        const pagePath = ctx.routePathToFilePathMap.get(routePath) ?? routePath;
        // Only pages are page owners: a layout file path or a route path that
        // falls back to a layout never addresses a layout without its page.
        if (!isPage(ctx, pagePath)) return ownerError('Component not found');
        const Component = componentClass(ctx.pages[pagePath])!;
        const options = optionsOf(Component);
        if (!isRealtimeOwner('page', options)) return transportError;
        const params = checkPageRouteParams(ctx, pagePath, parseParams(query('params')));
        if (!params) return paramsError;
        return { target: { owner: { kind: 'page', id: pagePath, options }, Component, guardPath: pagePath, pagePath, params } };
    }

    const pageRouteId = query('page');
    const pagePath = pageRouteId === undefined ? undefined : ctx.routeIdMap.get(pageRouteId);
    if (!pagePath || !isPage(ctx, pagePath)) return paramsError;
    const params = checkPageRouteParams(ctx, pagePath, parseParams(query('params')));
    if (!params) return paramsError;

    if (layoutRouteId !== undefined) {
        const layoutPath = ctx.routeIdMap.get(layoutRouteId);
        if (!layoutPath || !Object.hasOwn(ctx.layouts, layoutPath)) return ownerError('Layout not found');
        // The page must be below the layout: its params are the layout's too.
        if (!resolveLayoutPaths(pagePath, Object.keys(ctx.layouts)).includes(layoutPath)) return paramsError;
        const Component = componentClass(ctx.layouts[layoutPath]);
        if (!Component) return ownerError('Layout not found');
        const options = optionsOf(Component);
        if (!isRealtimeOwner('layout', options)) return transportError;
        return { target: { owner: { kind: 'layout', id: layoutPath, options }, Component, guardPath: layoutPath, pagePath, params } };
    }

    const Component = realtimeComponentClass(ctx, componentId!);
    if (!Component) return ownerError('Realtime component not found');
    const options = optionsOf(Component);
    if (!isRealtimeOwner('component', options)) return transportError;
    return { target: { owner: { kind: 'component', id: componentId!, options }, Component, guardPath: pagePath, pagePath, params } };
}

/** A realtime component's own guards, which run after its page's guards. */
export function realtimeOwnerMiddlewares(owner: RealtimeOwner): MiddlewareHandler[] {
    if (owner.kind !== 'component') return [];
    const declared = owner.options?.middlewares;
    return Array.isArray(declared) ? declared : [];
}
