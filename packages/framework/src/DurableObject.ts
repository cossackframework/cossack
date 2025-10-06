// src/DurableObject.ts
import { CossackDurableObject, Cossack } from '@cossackframework/core';

export class AppDurableObject extends CossackDurableObject {
    constructor(state: DurableObjectState, env: any) {
        super(state, env);
    }

    async getComponentRegistry(): Promise<Map<string, new () => Cossack>> {
        const registry = new Map<string, new () => Cossack>();
        // This glob path is correct because it's relative to this file's location
        // within the 'framework' package.
        const eagerPages = import.meta.glob('./pages/**/index.ts', { eager: true });
        for (const path in eagerPages) {
            const module = eagerPages[path] as any;
            const PageComponent = Object.values(module as object)[0] as new () => Cossack;
            if (PageComponent) {
                registry.set(PageComponent.name, PageComponent);
            }
        }
        return registry;
    }
}
