import { CossackDurableObject, Cossack } from '@cossackframework/core';

export class AppDurableObject extends CossackDurableObject {
    constructor(state: DurableObjectState, env: any) {
        super(state, env);
    }

    async getComponentRegistry(): Promise<Map<string, new () => Cossack>> {
        const registry = new Map<string, new () => Cossack>();
        const eagerPages = import.meta.glob('./pages/**/index.ts', { eager: true });
        for (const path in eagerPages) {
            const module = eagerPages[path] as any;
            const PageComponent = Object.values(module as object)[0] as new () => Cossack;
            if (PageComponent) {
                const registryKey = path.replace('./', '/src/');
                registry.set(registryKey, PageComponent);
            }
        }
        return registry;
    }
}
