// src/shared/container.ts
import 'reflect-metadata';

export interface ServiceMetadata {
    scope: 'singleton' | 'transient';
}

/**
 * Check if a class is decorated with @Service().
 */
export function isService(target: any): boolean {
    return Reflect.hasMetadata('cossack:service', target);
}

/**
 * Get the service metadata for a class.
 */
export function getServiceMetadata(target: any): ServiceMetadata | undefined {
    return Reflect.getMetadata('cossack:service', target);
}

/**
 * Dependency Injection Container.
 * Manages service instantiation, lifecycle (singleton/transient), and dependency resolution.
 */
export class DIContainer {
    private singletons = new Map<Function, any>();
    private resolving = new Set<Function>();

    /**
     * Resolve a service from the container.
     * Recursively resolves constructor dependencies.
     */
    resolve<T>(target: new (...args: any[]) => T): T {
        const serviceMeta = getServiceMetadata(target);
        if (!serviceMeta) {
            throw new Error(`[Cossack] ${target.name} is not decorated with @Service()`);
        }

        // Return singleton if exists
        if (serviceMeta.scope === 'singleton' && this.singletons.has(target)) {
            return this.singletons.get(target);
        }

        // Circular dependency check
        if (this.resolving.has(target)) {
            const chain = Array.from(this.resolving).map(t => t.name).join(' -> ');
            throw new Error(`[Cossack] Circular dependency detected: ${chain} -> ${target.name}`);
        }

        // Resolve constructor parameters via reflect-metadata
        this.resolving.add(target);
        try {
            const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', target) || [];
            const deps = paramTypes.map((dep: any) => {
                if (isService(dep)) {
                    return this.resolve(dep);
                }
                return undefined;
            });
            const instance = new target(...deps);

            if (serviceMeta.scope === 'singleton') {
                this.singletons.set(target, instance);
            }

            return instance;
        } finally {
            this.resolving.delete(target);
        }
    }

    /**
     * Clear all singleton instances.
     */
    clear(): void {
        this.singletons.clear();
    }
}

/** Global container instance (shared per environment) */
let globalContainer: DIContainer | null = null;

/**
 * Get or create the global DI container.
 */
export function getContainer(): DIContainer {
    if (!globalContainer) {
        globalContainer = new DIContainer();
    }
    return globalContainer;
}

/**
 * Reset the global container (useful for testing).
 */
export function resetContainer(): void {
    if (globalContainer) {
        globalContainer.clear();
    }
    globalContainer = null;
}

/**
 * Create an instance of a component class, resolving any @Service dependencies
 * from the DI container. If the class has no service dependencies, behaves like `new`.
 */
export function createInstance<T>(ComponentClass: new (...args: any[]) => T): T {
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', ComponentClass) || [];

    if (paramTypes.length === 0) {
        return new ComponentClass();
    }

    const container = getContainer();
    const deps = paramTypes.map((dep: any) => {
        if (isService(dep)) {
            return container.resolve(dep);
        }
        return undefined;
    });

    return new ComponentClass(...deps);
}
