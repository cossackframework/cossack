import './metadata';
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
import { createRpcCall, describeUnsupportedValue, readRpcStream, RPC_STREAM_CONTENT_TYPE, RpcError } from './rpc-stream';

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
    private disposal?: Promise<unknown[]>;
    private readonly childDisposals = new Set<Promise<unknown[]>>();
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

    /**
     * Resolve an explicit declaration, searching the innermost scope first.
     * The optional consumer names the requesting component in failure
     * diagnostics; it never affects resolution.
     */
    resolveDeclared<T>(serviceClass: ServiceClass<T>, consumer?: object): T {
        const entry = this.findDeclaration(serviceClass);
        if (!entry) {
            throw new Error(this.describeResolutionFailure(serviceClass, consumer));
        }
        return entry.instance as T;
    }

    /**
     * Actionable DI failure text: the requested service, the requesting
     * component, the active layout ancestry, and what each level declares.
     */
    describeResolutionFailure(serviceClass: ServiceClass, consumer?: object): string {
        const name = serviceClass.name || '<anonymous>';
        const consumerName = consumer?.constructor?.name;
        const target = consumerName && consumerName !== 'Object' ? ` into ${consumerName}` : '';
        return `[Cossack] Cannot inject ${name}${target}: no active layout declares it. ` +
            `Add it to @Page({ services: [${name}] }) on the layout that should own its lifetime.\n` +
            `Active scope chain (innermost first):\n${this.describeScopeChain().join('\n')}\n` +
            `Services that hold no layout state can stay global singletons through the container instead of a declaration.`;
    }

    /** Ancestry summary for diagnostics and inspection: innermost scope first. */
    describeScopeChain(): string[] {
        const lines: string[] = [];
        let scope: ServiceScope | undefined = this;
        while (scope) {
            const owner = scope.ownerRoutePath || scope.ownerRouteId;
            if (!owner) {
                lines.push('  - request root scope (no service declarations)');
            } else {
                const names = [...scope.owned.keys()].map(item => item.name || '<anonymous>');
                lines.push(`  - ${owner} ${names.length ? `declares [${names.join(', ')}]` : 'declares no services'}`);
            }
            scope = scope.parent;
        }
        return lines;
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
            this.resolveDeclared(serviceClass, consumer);
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
        void this.beginDisposal().then(errors => {
            for (const error of errors) console.error('[Cossack] Service disposal failed:', error);
        });
    }

    /** Wait for every owned hook, including child scopes disposed earlier. */
    async disposeAsync(): Promise<void> {
        const errors = await this.beginDisposal();
        if (errors.length) {
            throw new AggregateError(errors, `[Cossack] Failed to dispose service scope ${this.ownerRoutePath || this.ownerRouteId || 'root'}.`);
        }
    }

    private beginDisposal(): Promise<unknown[]> {
        if (this.disposal) return this.disposal;
        this.disposed = true;
        // Publish the completion before invoking user hooks, which can dispose
        // the same scope reentrantly. This promise always fulfills with errors;
        // synchronous navigation can observe them without unhandled rejection.
        let complete!: (errors: unknown[]) => void;
        this.disposal = new Promise(resolve => { complete = resolve; });
        this.parent?.childDisposals.add(this.disposal);
        const errors: unknown[] = [];
        const hooks: Promise<void>[] = [];
        for (const child of [...this.children]) child.beginDisposal();
        this.children.clear();
        for (const subscription of [...this.subscribers]) {
            try { subscription.unsubscribe(); } catch (error) { errors.push(error); }
        }
        this.subscribers.clear();
        for (const entry of this.owned.values()) {
            const hook = entry.instance?.onDispose;
            if (typeof hook === 'function') {
                const failed = (cause: unknown) => {
                    errors.push(new Error(`[Cossack] Error disposing service ${entry.serviceClass.name}:`, { cause }));
                };
                try {
                    const result = hook.call(entry.instance);
                    if (result && typeof result.then === 'function') {
                        hooks.push(Promise.resolve(result).then(() => {}, failed));
                    }
                } catch (error) {
                    failed(error);
                }
            }
        }
        this.owned.clear();
        this.ownedBySlot.clear();
        this.parent?.children.delete(this);
        void Promise.all([...this.childDisposals, ...hooks]).then(results => {
            for (const result of results) if (Array.isArray(result)) errors.push(...result);
            this.childDisposals.clear();
            complete(errors);
            // Browser root scopes can outlive thousands of layout changes.
            // Completed successful child hooks need no retained completion.
            if (!errors.length) this.parent?.childDisposals.delete(this.disposal!);
        });
        return this.disposal;
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
            const declared = Number(serverMethods[action]?.timeout);
            const timeoutMs = Number.isFinite(declared) && declared > 0 ? declared : undefined;
            // One request-scoped RPC with the same contract as component calls:
            // promise or iterator consumption, stream frames, cancellation,
            // deadlines, and correlated RpcError failures.
            entry.instance[action] = (...payload: unknown[]) => {
                this.setLoading(action, 1);
                const controller = new AbortController();
                let timedOut = false;
                const deadlineTimer = timeoutMs === undefined ? undefined : setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                }, timeoutMs);
                let request: Promise<Response>;
                try {
                    const state = getServiceState(entry.instance);
                    const unsupported = describeUnsupportedValue(payload, 'payload') ?? describeUnsupportedValue(state, 'state');
                    if (unsupported) throw new RpcError('COSSACK_RPC_SERIALIZATION_FAILED',
                        `Cannot serialize service request: unsupported value at ${unsupported}.`);
                    request = fetch('/crpc', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Accept: `${RPC_STREAM_CONTENT_TYPE}, application/json` },
                        signal: controller.signal,
                        body: JSON.stringify({
                            service: { ownerRouteId: this.ownerRouteId, slot: entry.slot },
                            action,
                            payload,
                            state,
                            scopeKey: this.scopeKey,
                        }),
                    });
                } catch (cause) {
                    request = Promise.reject(cause instanceof RpcError ? cause : new RpcError(
                        'COSSACK_RPC_SERIALIZATION_FAILED', 'Cannot serialize service request.', { cause }));
                }
                void request.catch(() => {});
                const operation = async function* (scope: ServiceScope): AsyncGenerator<unknown, unknown> {
                    try {
                        const response = await request;
                        if (!response.ok) {
                            let body: any;
                            try { body = await response.json(); } catch { /* preserve HTTP status */ }
                            throw new RpcError(body?.code ?? 'COSSACK_RPC_FAILED',
                                typeof body?.error === 'string' ? body.error : `HTTP error! status: ${response.status}`,
                                { status: response.status });
                        }
                        if (response.headers.get('Content-Type')?.split(';', 1)[0] === RPC_STREAM_CONTENT_TYPE) {
                            for await (const frame of readRpcStream(response, controller.signal)) {
                                if (frame.type === 'error') throw new RpcError(frame.code, frame.message, { requestId: frame.requestId });
                                if (frame.state && typeof frame.state === 'object') {
                                    hydrateServiceState(entry.instance, frame.state as Record<string, unknown>);
                                }
                                if (frame.type === 'done') return frame.value;
                                yield frame.value;
                            }
                        }
                        let data: Record<string, unknown>;
                        try {
                            data = await response.json() as Record<string, unknown>;
                            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Expected a service response object.');
                        } catch (cause) {
                            throw new RpcError('COSSACK_RPC_RESPONSE_INVALID', 'Invalid service RPC response.', { cause });
                        }
                        if (typeof (data as any)._cossack_redirect === 'string') {
                            window.location.href = (data as any)._cossack_redirect;
                            return undefined;
                        }
                        hydrateServiceState(entry.instance, (data as any)._cossack_service_state || {});
                        return (data as any)._cossack_return;
                    } catch (cause) {
                        if (controller.signal.aborted) {
                            if (timedOut) throw new RpcError('COSSACK_RPC_TIMEOUT',
                                `The call exceeded its ${timeoutMs}ms deadline. The server outcome is unknown and is never retried.`, { cause });
                            throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { cause });
                        }
                        if (cause instanceof RpcError) throw cause;
                        throw new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Service RPC request failed.', { cause });
                    } finally {
                        if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
                        scope.setLoading(action, -1);
                    }
                };
                return createRpcCall(operation(this), () => controller.abort(),
                    error => console.error(`Error calling service action '${action}':`, error));
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
