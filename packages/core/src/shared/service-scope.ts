import 'reflect-metadata';
import type { Context } from 'hono';
import type { User } from './user';
import { getContainer, isService, type ServiceClass } from './container';
import {
    bootstrapService,
    getServiceState,
    hydrateServiceState,
    subscribeToService,
} from './service-bootstrap';
import { isSharedMethod } from './shared-method';

export interface ServiceScopeRequestContext {
    context?: Context;
    user?: User;
    env?: unknown;
}

export interface ServiceScopeOptions {
    ownerRouteId?: string;
    ownerRoutePath?: string;
    initialState?: Record<string, Record<string, unknown>>;
    scopeKey?: string;
}

type Subscriber = {
    consumer: any;
    unsubscribe: () => void;
};

type OwnedService = {
    serviceClass: ServiceClass;
    slot: string;
    instance: any;
};

/**
 * A request/navigation-local DI scope. Explicit declarations are owned by the
 * scope; resolution walks toward the root so a nested declaration shadows its
 * ancestors. Undeclared constructor dependencies retain the legacy container
 * semantics (singleton/transient).
 */
export class ServiceScope {
    private readonly owned = new Map<ServiceClass, OwnedService>();
    private readonly ownedBySlot = new Map<string, OwnedService>();
    private readonly children = new Set<ServiceScope>();
    private readonly subscribers = new Set<Subscriber>();
    private readonly resolving = new Set<ServiceClass>();
    private requestContext: ServiceScopeRequestContext = {};
    private disposed = false;
    private clientProxyInstalled = new WeakSet<object>();

    public readonly ownerRouteId?: string;
    public readonly ownerRoutePath?: string;
    public readonly scopeKey?: string;

    constructor(
        public readonly parent?: ServiceScope,
        declarations: readonly ServiceClass[] = [],
        options: ServiceScopeOptions = {},
    ) {
        this.ownerRouteId = options.ownerRouteId;
        this.ownerRoutePath = options.ownerRoutePath;
        this.scopeKey = options.scopeKey;
        parent?.children.add(this);

        const seen = new Set<ServiceClass>();
        declarations.forEach((serviceClass, index) => {
            if (seen.has(serviceClass)) {
                throw new Error(
                    `[Cossack] Duplicate service ${serviceClass.name || '<anonymous>'} in services for ` +
                    `${this.ownerRoutePath || this.ownerRouteId || 'layout'}.`,
                );
            }
            seen.add(serviceClass);
            if (!isService(serviceClass)) {
                throw new Error(
                    `[Cossack] ${serviceClass.name || '<anonymous>'} in services for ` +
                    `${this.ownerRoutePath || this.ownerRouteId || 'layout'} is not decorated with @Service().`,
                );
            }
            // Declaration index is stable across separately minified server
            // and client bundles; class names are not.
            const slot = String(index);
            // Reserve the declaration before instantiation so constructor
            // cycles produce a useful scope-level error.
            this.owned.set(serviceClass, { serviceClass, slot, instance: undefined });
        });

        for (const serviceClass of declarations) {
            const entry = this.owned.get(serviceClass)!;
            if (entry.instance === undefined) {
                entry.instance = this.instantiateOwned(serviceClass);
                bootstrapService(entry.instance);
            }
            const hydrated = options.initialState?.[entry.slot];
            if (hydrated) hydrateServiceState(entry.instance, hydrated);
            this.ownedBySlot.set(entry.slot, entry);
            this.installClientProxy(entry);
        }
    }

    bindRequest(requestContext: ServiceScopeRequestContext): void {
        this.requestContext = requestContext;
        for (const entry of this.owned.values()) {
            if (typeof entry.instance?.__cossackBindServiceScope === 'function') {
                entry.instance.__cossackBindServiceScope(this);
            }
        }
    }

    getRequestContext(): ServiceScopeRequestContext {
        if (this.requestContext.context || this.requestContext.user || this.requestContext.env) {
            return this.requestContext;
        }
        return this.parent?.getRequestContext() || {};
    }

    /** Resolve an explicit declaration, searching the innermost scope first. */
    resolveDeclared<T>(serviceClass: ServiceClass<T>): T {
        const entry = this.findDeclaration(serviceClass);
        if (!entry) {
            throw new Error(
                `[Cossack] Cannot inject ${serviceClass.name || '<anonymous>'}: no active layout declares it. ` +
                `Add it to @Page({ services: [${serviceClass.name || 'Service'}] }) on a parent layout.`,
            );
        }
        return entry.instance as T;
    }

    /** Constructor DI: prefer an explicit declaration, otherwise use legacy DI. */
    resolve<T>(serviceClass: ServiceClass<T>): T {
        const entry = this.findDeclaration(serviceClass);
        return entry ? entry.instance as T : getContainer().resolve(serviceClass);
    }

    getOwnedService(slot: string): { serviceClass: ServiceClass; instance: any } | undefined {
        const entry = this.ownedBySlot.get(slot);
        return entry ? { serviceClass: entry.serviceClass, instance: entry.instance } : undefined;
    }

    getSlot(serviceClass: ServiceClass): string | undefined {
        return this.findDeclaration(serviceClass)?.slot;
    }

    getOwnerScope(serviceClass: ServiceClass): ServiceScope | undefined {
        if (this.owned.has(serviceClass)) return this;
        return this.parent?.getOwnerScope(serviceClass);
    }

    subscribe(serviceClass: ServiceClass, consumer: any): () => void {
        const owner = this.getOwnerScope(serviceClass);
        if (!owner) {
            // Resolve here solely to produce the canonical missing-declaration error.
            this.resolveDeclared(serviceClass);
            return () => {};
        }
        const instance = owner.resolveDeclared(serviceClass);
        const unsubscribeState = subscribeToService(instance, (key) => {
            if (typeof consumer.requestUpdate === 'function') {
                void consumer.requestUpdate(`service:${owner.getSlot(serviceClass)}:${key}`);
            }
        });
        const subscription: Subscriber = { consumer, unsubscribe: unsubscribeState };
        owner.subscribers.add(subscription);
        return () => {
            unsubscribeState();
            owner.subscribers.delete(subscription);
        };
    }

    serializeOwnedState(): Record<string, Record<string, unknown>> | undefined {
        if (this.ownedBySlot.size === 0) return undefined;
        return Object.fromEntries(
            [...this.ownedBySlot].map(([slot, entry]) => [slot, getServiceState(entry.instance)]),
        );
    }

    hydrateOwnedService(slot: string, state: unknown): void {
        const entry = this.ownedBySlot.get(slot);
        if (!entry) {
            throw new Error(`[Cossack] Unknown service slot '${slot}' for ${this.ownerRoutePath || 'layout'}.`);
        }
        hydrateServiceState(entry.instance, state);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const child of [...this.children]) child.dispose();
        this.children.clear();
        for (const subscription of [...this.subscribers]) subscription.unsubscribe();
        this.subscribers.clear();
        for (const entry of this.owned.values()) {
            const hook = entry.instance?.onDispose;
            if (typeof hook === 'function') {
                try {
                    const result = hook.call(entry.instance);
                    if (result && typeof result.then === 'function') {
                        void result.catch((error: unknown) => {
                            console.error(`[Cossack] Error disposing service ${entry.serviceClass.name}:`, error);
                        });
                    }
                } catch (error) {
                    console.error(`[Cossack] Error disposing service ${entry.serviceClass.name}:`, error);
                }
            }
        }
        this.owned.clear();
        this.ownedBySlot.clear();
        this.parent?.children.delete(this);
    }

    private findDeclaration(serviceClass: ServiceClass): OwnedService | undefined {
        return this.owned.get(serviceClass) || this.parent?.findDeclaration(serviceClass);
    }

    private instantiateOwned<T>(serviceClass: ServiceClass<T>): T {
        if (this.resolving.has(serviceClass)) {
            const chain = [...this.resolving, serviceClass].map(item => item.name).join(' -> ');
            throw new Error(`[Cossack] Circular dependency detected in layout service scope: ${chain}`);
        }
        this.resolving.add(serviceClass);
        try {
            const paramTypes: ServiceClass[] = Reflect.getMetadata('design:paramtypes', serviceClass) || [];
            const dependencies = paramTypes.map(dep => {
                if (!isService(dep)) return undefined;
                const declaration = this.findDeclaration(dep);
                if (declaration) {
                    if (declaration.instance !== undefined) return declaration.instance;
                    const owner = this.getOwnerScope(dep)!;
                    declaration.instance = owner.instantiateOwned(dep);
                    bootstrapService(declaration.instance);
                    return declaration.instance;
                }
                return getContainer().resolve(dep);
            });
            const instance = new serviceClass(...dependencies);
            if (typeof (instance as any).__cossackBindServiceScope === 'function') {
                (instance as any).__cossackBindServiceScope(this);
            }
            return instance;
        } finally {
            this.resolving.delete(serviceClass);
        }
    }

    private installClientProxy(entry: OwnedService): void {
        if (typeof window === 'undefined' || this.clientProxyInstalled.has(entry.instance)) return;
        if (!this.ownerRouteId) return;
        const serverMethods = Reflect.getMetadata('cossack:server-methods', entry.serviceClass) || {};
        const clientMethods = Reflect.getMetadata('cossack:client-methods', entry.serviceClass) || {};
        for (const action of Object.keys(serverMethods)) {
            if (clientMethods[action] || isSharedMethod(entry.serviceClass, action)) continue;
            entry.instance[action] = async (...payload: unknown[]) => {
                this.setLoading(action, 1);
                try {
                    const response = await fetch('/crpc', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            service: { ownerRouteId: this.ownerRouteId, slot: entry.slot },
                            action,
                            payload,
                            state: getServiceState(entry.instance),
                            scopeKey: this.scopeKey,
                        }),
                    });
                    const data = await response.json() as Record<string, any>;
                    if (!response.ok) throw new Error(data?.error || `HTTP error! status: ${response.status}`);
                    if (data._cossack_redirect) {
                        window.location.href = data._cossack_redirect;
                        return undefined;
                    }
                    hydrateServiceState(entry.instance, data._cossack_service_state || {});
                    return data._cossack_return;
                } finally {
                    this.setLoading(action, -1);
                }
            };
        }
        this.clientProxyInstalled.add(entry.instance);
    }

    private setLoading(action: string, delta: number): void {
        for (const { consumer } of this.subscribers) {
            if (!consumer.loading) continue;
            const next = (consumer.loading[action] || 0) + delta;
            if (next > 0) consumer.loading[action] = next;
            else delete consumer.loading[action];
            if (typeof consumer.requestUpdate === 'function') void consumer.requestUpdate();
        }
    }
}

export function createRootServiceScope(): ServiceScope {
    return new ServiceScope();
}

export function createLayoutServiceScope(
    parent: ServiceScope,
    componentClass: Function,
    options: ServiceScopeOptions = {},
): ServiceScope {
    const pageOptions = Reflect.getMetadata('page:options', componentClass) || {};
    return new ServiceScope(parent, pageOptions.services || [], options);
}

/** A service's stable, JSON-visible state is limited to @State/@Store fields. */
export function sanitizeServiceState(serviceClass: ServiceClass, state: unknown): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    if (!state || typeof state !== 'object') return clean;
    const allowed = new Set<string>();
    for (const metadataKey of ['cossack:state', 'cossack:store']) {
        const metadata = Reflect.getMetadata(metadataKey, serviceClass) || {};
        for (const key of Object.keys(metadata)) allowed.add(key);
    }
    for (const key of allowed) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
        if (Object.prototype.hasOwnProperty.call(state, key)) clean[key] = (state as any)[key];
    }
    return clean;
}
