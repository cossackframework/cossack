import { getModuleDefault } from './module-default.js';
// src/DurableObject.ts
import { CossackDurableObject, Cossack, type DurableObjectComponentRequest, type PageOptions } from '@cossackframework/core';
import type { Context, MiddlewareHandler } from 'hono';
import applicationRegistry from 'virtual:cossack-pages';
import realtimeRegistry from 'virtual:cossack-realtime-components';
import { computeRouteIds, resolveLayoutPaths, type RouteIdMaps } from './route-ids.js';
import { createChainedComponent } from './service-scope-chain.js';
import { realtimeConnectionScopeKey, type RealtimeOwner } from './realtime-scope.js';
import { realtimeOwnerMiddlewares } from './transports/realtime-target.js';
import { withRealtimeAuthorization, type RealtimeIdentity, type RealtimeRequestSnapshot } from './realtime-context.js';
import { ensureRequestContextAlsWired } from './request-context-als.js';
import type { SocketPeerAttachment } from '@cossackframework/core';

let routeIds: RouteIdMaps | undefined;

const realtimeComponents = (): Record<string, unknown> => realtimeRegistry?.components ?? {};

function componentOf(module: unknown): (new () => Cossack) | undefined {
    const Component = module && getModuleDefault(module as object);
    return typeof Component === 'function' && Component.prototype instanceof Cossack ? Component as new () => Cossack : undefined;
}

export class AppDurableObject extends CossackDurableObject {
    constructor(state: DurableObjectState, env: any) {
        super(state, env);
        // A Durable Object isolate may serve socket actions before any HTTP
        // request runs the request-context middleware.
        ensureRequestContextAlsWired();
    }

    async getComponentRegistry(): Promise<Map<string, new () => Cossack>> {
        const registry = new Map<string, new () => Cossack>();
        // Share the router's compiler-owned application paths, including layouts.
        // A package-relative glob would register the framework's bundled demos.
        for (const [path, module] of Object.entries({ ...applicationRegistry.pages, ...applicationRegistry.layouts })) {
            const Component = componentOf(module);
            if (Component) registry.set(path, Component);
        }
        // Realtime child components, by build-time registry id. Ids never
        // look like source paths, so they cannot shadow a page or layout.
        for (const [id, Component] of Object.entries(realtimeComponents())) {
            if (typeof Component === 'function' && Component.prototype instanceof Cossack) registry.set(id, Component as new () => Cossack);
        }
        return registry;
    }

    /** Build the page or layout inside its root and layout service scopes, with the route params SSR saw. */
    protected override async createComponent(Component: new () => Cossack, request: DurableObjectComponentRequest): Promise<Cossack> {
        // The router derives the same ids from the same registry, so service
        // owners match the ids the browser received during SSR.
        routeIds ??= computeRouteIds(Object.keys(applicationRegistry.pages), Object.keys(applicationRegistry.layouts));
        const { context, user } = request;
        // A realtime component is shared by every page that embeds it, so it
        // gets a root service scope of its own rather than one page's layouts.
        const component = Object.hasOwn(realtimeComponents(), request.componentPath);
        return createChainedComponent({
            component: Component, componentPath: request.componentPath, scopeKey: request.scopeKey,
            layouts: component ? {} : applicationRegistry.layouts, routePathToIdMap: routeIds.routePathToIdMap,
            facilities: { context, user, env: this.env },
            bootstrap: { context, user, env: this.env, page: request.page, skipInit: true, initialState: request.initialState },
        });
    }

    /** The owner this peer joined and the guard stack each of its operations runs again. */
    private peerAuthorization(peer: SocketPeerAttachment): { owner: RealtimeOwner; middlewares: MiddlewareHandler[] } | undefined {
        const componentPath = peer.componentPath!;
        const pages = applicationRegistry.pages as Record<string, unknown>;
        const layouts = applicationRegistry.layouts as Record<string, unknown>;
        let kind: RealtimeOwner['kind'];
        let Component: (new () => Cossack) | undefined;
        if (Object.hasOwn(realtimeComponents(), componentPath)) {
            kind = 'component';
            const registered = realtimeComponents()[componentPath];
            Component = typeof registered === 'function' ? registered as new () => Cossack : undefined;
        } else if (Object.hasOwn(layouts, componentPath)) {
            kind = 'layout';
            Component = componentOf(layouts[componentPath]);
        } else if (Object.hasOwn(pages, componentPath)) {
            kind = 'page';
            Component = componentOf(pages[componentPath]);
        } else return undefined;
        if (!Component || (peer.owner ?? 'page') !== kind) return undefined;
        // A page or a component runs the guards of the page the connection
        // opened on; a layout runs its own. The proxy chose and checked it.
        const guardPath = kind === 'layout' ? componentPath : peer.guardPath ?? componentPath;
        if (!Object.hasOwn(pages, guardPath) && !Object.hasOwn(layouts, guardPath)) return undefined;
        const owner: RealtimeOwner = { kind, id: componentPath, options: Reflect.getMetadata('page:options', Component) as PageOptions | undefined };
        const paths = new Set([...resolveLayoutPaths(guardPath, Object.keys(layouts)), guardPath]);
        const middlewares: MiddlewareHandler[] = [...paths].flatMap(path => {
            const GuardComponent = componentOf(pages[path] ?? layouts[path]);
            const declared = GuardComponent ? Reflect.getMetadata('page:options', GuardComponent)?.middlewares ?? [] : [];
            return Array.isArray(declared) ? declared : [];
        });
        return { owner, middlewares: [...middlewares, ...realtimeOwnerMiddlewares(owner)] };
    }

    protected override async authorizeWebSocketPeer(
        _client: WebSocket,
        peer: SocketPeerAttachment,
        operation: (context: Context) => Promise<void>,
    ): Promise<boolean> {
        if (!peer.request || !peer.componentPath || !peer.scopeKey) return false;
        const authorization = this.peerAuthorization(peer);
        if (!authorization) return false;
        const request = peer.request;
        const snapshot: RealtimeRequestSnapshot = {
            url: request.url,
            path: new URL(request.url).pathname,
            headers: request.headers,
            env: this.env,
            params: request.params,
            locale: request.locale ?? 'en',
        };
        const originalUserId = (peer.user as { id?: unknown } | undefined)?.id;
        // The same user, and a scope that still resolves to this connection's
        // key. A component scope that throws or returns no key denies.
        const result = await withRealtimeAuthorization(snapshot, (peer.identity as RealtimeIdentity | null | undefined) ?? null,
            authorization.middlewares, async fresh => fresh.get('user')?.id === originalUserId &&
                await realtimeConnectionScopeKey(fresh, authorization.owner) === peer.scopeKey, operation);
        return result !== null;
    }
}
