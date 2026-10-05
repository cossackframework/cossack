import { beginDevelopmentServiceRpcTrace } from './development-trace';
import { registerDevelopmentScope, developmentName } from './development-inspection';
import { collectReactiveMetadata } from './reactive-metadata';
import { beginOptimisticCall, optimisticRequestState, finishOptimisticCall, optimisticHandlers, optimisticHandler, optimisticKeys, ownRpcLoading } from './optimistic-state';
import { createStateApplier } from './rpc-state';
import { collectServerMethodMetadata, validateServerMethodTimeout } from './server-method-metadata';
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
import { rpcFormData, snapshotRpcPayload } from './rpc-files';
import { readRpcJsonResponse, readRpcHttpError } from './rpc-json';
import { awaitRpcResponse } from './rpc-response';
import { createRpcCall, snapshotRpcValue, readRpcNativeResponse, RPC_NATIVE_RESPONSE_HEADER, readRpcStream, RPC_STREAM_CONTENT_TYPE, RpcError } from './rpc-stream';

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
    serviceClass: ServiceClass;
    consumer: any;
    unsubscribe: () => void;
};

type ServiceLoading = {
    serviceClass: ServiceClass;
    action: string;
    releases: Map<any, () => void>;
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
    private readonly pendingLoading = new Set<ServiceLoading>();
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
        if (import.meta.env?.DEV) registerDevelopmentScope(this, () => {
            const services = [];
            for (const entry of this.owned.values()) {
                if (services.length >= 64) break;
                services.push({ slot: entry.slot, name: developmentName(Object.getOwnPropertyDescriptor(entry.serviceClass, 'name')?.value),
                    initialized: entry.instance !== undefined });
            }
            return { parent: this.parent, disposed: this.disposed, pendingCalls: this.pendingLoading.size,
                subscribers: this.subscribers.size, services, truncated: this.owned.size > 64 };
        });

        try {
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
        } catch (error) {
            // Construction can fail after earlier services have acquired
            // resources. Roll back this partially initialized scope, while
            // keeping async cleanup observable to a parent that is also torn
            // down. The construction error remains the primary failure.
            void this.beginDisposal().then(errors => {
                for (const cleanupError of errors) {
                    console.error('[Cossack] Service scope setup cleanup failed:', cleanupError);
                }
            });
            throw error;
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
        const subscription: Subscriber = { serviceClass, consumer, unsubscribe: unsubscribeState };
        owner.subscribers.add(subscription);
        for (const loading of owner.pendingLoading) {
            if (loading.serviceClass === serviceClass) owner.attachLoading(loading, consumer);
        }
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
        const serverMethods = collectServerMethodMetadata(entry.serviceClass);
        const clientMethods = Reflect.getMetadata('cossack:client-methods', entry.serviceClass) || {};
        for (const action of Object.keys(serverMethods)) {
            if (clientMethods[action] || isSharedMethod(entry.serviceClass, action)) continue;
            const defaultTimeoutMs = validateServerMethodTimeout(serverMethods[action]?.timeout);
            // One request-scoped RPC with the same contract as component calls:
            // promise or iterator consumption, stream frames, cancellation,
            // deadlines, and correlated RpcError failures.
            entry.instance[action] = (...payload: unknown[]) => {
                const call = beginOptimisticCall(entry.instance, action,
                    optimisticHandler(entry.instance, optimisticHandlers(entry.serviceClass)[action], payload),
                    optimisticKeys(entry.serviceClass));
                const finishLoading = this.beginLoading(entry.serviceClass, action);
                let requestId: string = crypto.randomUUID();
                const trace = import.meta.env?.DEV ? beginDevelopmentServiceRpcTrace(entry.instance, requestId) : undefined;
                const controller = new AbortController();
                let timedOut = false;
                let timeoutMs = defaultTimeoutMs;
                let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
                const setDeadline = (timeout: number) => {
                    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
                    timeoutMs = timeout;
                    deadlineTimer = setTimeout(() => {
                        timedOut = true;
                        controller.abort();
                    }, timeout);
                };
                if (timeoutMs !== undefined) setDeadline(timeoutMs);
                let request: Promise<Response>;
                let requestState: Record<string, unknown> = {};
                let success = false;
                let finished = false;
                const cleanup = () => {
                    if (finished) return;
                    finished = true;
                    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
                    try { finishOptimisticCall(call, success); finishLoading(); }
                    catch (error) { trace?.finish('failed'); throw error; }
                    finally { trace?.finish(success ? 'succeeded' : timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'failed'); }
                };
                try {
                    requestState = snapshotRpcValue(optimisticRequestState(entry.instance, getServiceState(entry.instance)), 'state') as Record<string, unknown>;
                    const normalized = snapshotRpcPayload(payload);
                    const body = { service: { ownerRouteId: this.ownerRouteId, slot: entry.slot }, action,
                        payload: normalized.payload, state: requestState, scopeKey: this.scopeKey };
                    request = fetch(normalized.files.size ? '/upload' : '/crpc', {
                        method: 'POST',
                        headers: { ...trace?.requestHeaders, 'X-Cossack-Request-Id': requestId, ...(normalized.files.size ? {} : { 'Content-Type': 'application/json' }), Accept: `${RPC_STREAM_CONTENT_TYPE}, application/json` },
                        signal: controller.signal,
                        body: normalized.files.size ? rpcFormData(body, normalized.files) : JSON.stringify(body),
                    });
                } catch (cause) {
                    request = Promise.reject(cause instanceof RpcError ? cause : new RpcError(
                        'COSSACK_RPC_SERIALIZATION_FAILED', 'Cannot serialize service request.', { cause }));
                }
                request = awaitRpcResponse(request, controller.signal, () => requestId);
                void request.catch(() => {});
                const applyState = createStateApplier(entry.instance, requestState, call, trace ? () => trace.state() : undefined);
                const apply = (state: Record<string, unknown>) => applyState(sanitizeServiceState(entry.serviceClass, state));
                const operation = async function* (): AsyncGenerator<unknown, unknown> {
                    try {
                        const response = await request;
                        requestId = response.headers.get('X-Cossack-Request-Id') ?? requestId;
                        trace?.response(requestId);
                        trace?.server(response);
                        if (!response.ok) {
                            throw await readRpcHttpError(response, controller.signal);
                        }
                        if (response.headers.get(RPC_NATIVE_RESPONSE_HEADER) === 'native') {
                            const value = await readRpcNativeResponse(response, controller.signal);
                            success = true;
                            return value;
                        }
                        if (response.headers.get('Content-Type')?.split(';', 1)[0] === RPC_STREAM_CONTENT_TYPE) {
                            for await (const frame of readRpcStream(response, controller.signal)) {
                                if (frame.requestId !== requestId) {
                                    requestId = frame.requestId;
                                    trace?.response(requestId);
                                }
                                trace?.stream(frame);
                                if (frame.type === 'error') throw new RpcError(frame.code, frame.message,
                                    { requestId: frame.requestId, fieldErrors: frame.fieldErrors });
                                if (frame.state && typeof frame.state === 'object') {
                                    apply(frame.state as Record<string, unknown>);
                                }
                                if (frame.type === 'done') { success = true; return frame.value; }
                                yield frame.value;
                            }
                        }
                        const data = await readRpcJsonResponse(response, 'service', controller.signal);
                        if (typeof (data as any)._cossack_redirect === 'string') {
                            success = true;
                            window.location.href = (data as any)._cossack_redirect;
                            return undefined;
                        }
                        apply(data._cossack_service_state as Record<string, unknown>);
                        success = true;
                        return (data as any)._cossack_return;
                    } catch (cause) {
                        if (controller.signal.aborted) {
                            if (timedOut) throw new RpcError('COSSACK_RPC_TIMEOUT',
                                `The call exceeded its ${timeoutMs}ms deadline. The server outcome is unknown and is never retried.`, { cause, requestId });
                            throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.', { cause, requestId });
                        }
                        if (cause instanceof RpcError) throw cause;
                        throw new RpcError('COSSACK_RPC_NETWORK_FAILED',
                            'Service RPC request failed. The server outcome is unknown and is never retried.', { cause, requestId });
                    } finally {
                        cleanup();
                    }
                };
                return createRpcCall(operation(), () => { controller.abort(); cleanup(); },
                    error => console.error(`Error calling service action '${action}':`, error), () => requestId, {
                        signal: controller.signal,
                        error: () => new RpcError(timedOut ? 'COSSACK_RPC_TIMEOUT' : 'COSSACK_RPC_CANCELLED',
                            timedOut ? `The call exceeded its ${timeoutMs}ms deadline. The server outcome is unknown and is never retried.` : 'RPC call was cancelled.', { requestId }),
                        setTimeout: setDeadline,
                    });
            };
        }
        this.clientProxyInstalled.add(entry.instance);
    }

    private beginLoading(serviceClass: ServiceClass, action: string): () => void {
        const loading: ServiceLoading = { serviceClass, action, releases: new Map() };
        this.pendingLoading.add(loading);
        for (const subscription of this.subscribers) {
            if (subscription.serviceClass === serviceClass) this.attachLoading(loading, subscription.consumer);
        }
        return () => {
            if (!this.pendingLoading.delete(loading)) return;
            for (const release of loading.releases.values()) release();
            loading.releases.clear();
        };
    }

    private attachLoading(loading: ServiceLoading, consumer: any): void {
        if (!consumer.loading || loading.releases.has(consumer)) return;
        const { action, serviceClass } = loading;
        const release = ownRpcLoading(consumer, action);
        // Record ownership before rendering: injection may subscribe again
        // during the update. Rejoining the same invocation must not count twice.
        loading.releases.set(consumer, () => {
            release();
            const next = (consumer.loading[action] || 0) - 1;
            if (next > 0) consumer.loading[action] = next; else delete consumer.loading[action];
            // Release exited consumers too, without scheduling an exited render.
            if ([...this.subscribers].some(subscription => subscription.serviceClass === serviceClass
                && subscription.consumer === consumer) && typeof consumer.requestUpdate === 'function') {
                void consumer.requestUpdate();
            }
        });
        consumer.loading[action] = (consumer.loading[action] || 0) + 1;
        if (typeof consumer.requestUpdate === 'function') void consumer.requestUpdate();
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
    const { state: publicState, store } = collectReactiveMetadata(serviceClass);
    const allowed = new Set([...Object.keys(publicState), ...Object.keys(store)]);
    for (const key of allowed) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
        if (Object.prototype.hasOwnProperty.call(state, key)) clean[key] = (state as any)[key];
    }
    return clean;
}
