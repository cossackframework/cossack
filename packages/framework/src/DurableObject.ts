import { getModuleDefault } from './module-default.js';
// src/DurableObject.ts
import { CossackDurableObject, Cossack } from '@cossackframework/core';
import applicationRegistry from 'virtual:cossack-pages';

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
}
