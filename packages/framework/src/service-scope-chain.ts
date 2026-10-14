import {
    createLayoutServiceScope,
    createRootServiceScope,
    type Cossack,
    type ServiceScope,
    type ServiceScopeRequestContext,
} from '@cossackframework/core';
import { getModuleDefault } from './module-default.js';
import { resolveLayoutPaths } from './route-ids.js';

export interface ServiceScopeChainLayout {
    path: string;
    component: new () => Cossack;
    scope: ServiceScope;
}

export interface ServiceScopeChainOptions {
    /** Page or layout file path whose enclosing layouts declare services. */
    componentPath: string;
    layouts: Record<string, unknown>;
    routePathToIdMap: Map<string, string>;
    scopeKey?: string;
    /** Request facilities bound to the root and every layout scope. */
    facilities: ServiceScopeRequestContext;
    /**
     * Existing root scope (for example one already used by the App component).
     * When omitted a root scope is created, bound, and disposed again if the
     * chain cannot be built.
     */
    root?: ServiceScope;
    /**
     * Called after each layout scope is created, in outer-to-inner order, so
     * SSR can construct and bootstrap the layout before the next scope is built.
     */
    onLayout?: (layout: ServiceScopeChainLayout) => void | Promise<void>;
}

export interface ServiceScopeChain {
    root: ServiceScope;
    /** Innermost scope: the one a page (or the component itself) resolves from. */
    scope: ServiceScope;
    layouts: ServiceScopeChainLayout[];
}

/**
 * Build the root + enclosing-layout service scope chain for one component path.
 * SSR, `/crpc`, `/ws` and the SSE endpoint all construct components through
 * this chain, so a page that injects a layout-declared service resolves it the
 * same way on every transport.
 */
export async function createServiceScopeChain(options: ServiceScopeChainOptions): Promise<ServiceScopeChain> {
    const ownsRoot = options.root === undefined;
    const root = options.root ?? createRootServiceScope();
    if (ownsRoot) root.bindRequest(options.facilities);
    const layouts: ServiceScopeChainLayout[] = [];
    try {
        let scope = root;
        for (const path of resolveLayoutPaths(options.componentPath, Object.keys(options.layouts))) {
            const component = getModuleDefault(options.layouts[path] as object) as new () => Cossack;
            scope = createLayoutServiceScope(scope, component, {
                ownerRouteId: options.routePathToIdMap.get(path),
                ownerRoutePath: path,
                scopeKey: options.scopeKey,
            });
            scope.bindRequest(options.facilities);
            const layout = { path, component, scope };
            layouts.push(layout);
            await options.onLayout?.(layout);
        }
        return { root, scope, layouts };
    } catch (error) {
        if (ownsRoot) await root.disposeAsync().catch(() => {});
        throw error;
    }
}
