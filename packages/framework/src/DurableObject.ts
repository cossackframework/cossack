import { getModuleDefault } from './module-default.js';
// src/DurableObject.ts
import { CossackDurableObject, Cossack } from '@cossackframework/core';
import type { Context, MiddlewareHandler } from 'hono';
import applicationRegistry from 'virtual:cossack-pages';
import { resolveLayoutPaths } from './route-ids.js';
import { resolveRealtimeScopeKey } from './realtime-scope.js';
import { withRealtimeAuthorization, type RealtimeIdentity, type RealtimeRequestSnapshot } from './realtime-context.js';
import type { SocketPeerAttachment } from '@cossackframework/core';

export class AppDurableObject extends CossackDurableObject {
    constructor(state: DurableObjectState, env: any) {
        super(state, env);
    }

    async getComponentRegistry(): Promise<Map<string, new () => Cossack>> {
        const registry = new Map<string, new () => Cossack>();
        // Share the router's compiler-owned application paths, including layouts.
        // A package-relative glob would register the framework's bundled demos.
        for (const [path, module] of Object.entries({ ...applicationRegistry.pages, ...applicationRegistry.layouts })) {
            const Component = getModuleDefault(module);
            if (typeof Component === 'function' && Component.prototype instanceof Cossack) {
                registry.set(path, Component as new () => Cossack);
            }
        }
        return registry;
    }

    protected override async authorizeWebSocketPeer(
        _client: WebSocket,
        peer: SocketPeerAttachment,
        operation: (context: Context) => Promise<void>,
    ): Promise<boolean> {
        if (!peer.request || !peer.componentPath || !peer.scopeKey) return false;
        const components = { ...applicationRegistry.pages, ...applicationRegistry.layouts };
        const pageModule = components[peer.componentPath];
        const PageComponent = pageModule && getModuleDefault(pageModule as object) as new () => Cossack;
        if (!PageComponent || typeof PageComponent !== 'function') return false;
        const pageOptions = Reflect.getMetadata('page:options', PageComponent);
        const paths = [...resolveLayoutPaths(peer.componentPath, Object.keys(applicationRegistry.layouts)), peer.componentPath];
        const middlewares: MiddlewareHandler[] = paths.flatMap(path => {
            const module = components[path];
            const Component = module && getModuleDefault(module as object);
            const declared = typeof Component === 'function'
                ? Reflect.getMetadata('page:options', Component)?.middlewares ?? [] : [];
            return Array.isArray(declared) ? declared : [];
        });
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
        const result = await withRealtimeAuthorization(snapshot, (peer.identity as RealtimeIdentity | null | undefined) ?? null,
            middlewares, async fresh => fresh.get('user')?.id === originalUserId &&
                await resolveRealtimeScopeKey(fresh, pageOptions) === peer.scopeKey, operation);
        return result !== null;
    }
}
