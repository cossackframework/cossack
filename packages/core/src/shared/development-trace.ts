import { inspectDevelopmentComponent, type DevelopmentInspectionOptions, type DevelopmentComponentSnapshot } from './development-inspection';
import type { NavigateOutcome, NavigationScrollBehavior, NavigationType } from '../client/navigation';

/** Development-only lifecycle evidence. Never accepts application payloads or raw errors. */
export type DevelopmentRpcOutcome = 'succeeded' | 'failed' | 'cancelled' | 'timeout' | 'disconnected';
export interface DevelopmentRpcEvent {
    readonly sequence: number;
    readonly timestamp: number;
    readonly kind: 'rpc';
    readonly callId: string;
    readonly requestId: string | null;
    readonly componentId: number;
    readonly transport: 'http' | 'websocket';
    readonly phase: 'start' | 'response' | 'state-reconciled' | 'finish';
    readonly outcome: DevelopmentRpcOutcome | null;
}
/** Explicit layout-service calls have service identities, not component identities. */
export interface DevelopmentServiceRpcEvent extends Omit<DevelopmentRpcEvent, 'kind' | 'componentId' | 'transport'> {
    readonly kind: 'service-rpc';
    readonly serviceId: number;
    readonly transport: 'http';
}
/** Fixed navigation decisions; never URLs, application state or error messages. */
export type DevelopmentNavigationDiagnostic =
    | { phase: 'start'; navigationType: NavigationType }
    | { phase: 'cache'; decision: 'hit' | 'miss' | 'shared' }
    | { phase: 'invalidate'; entries: number }
    | { phase: 'layouts'; retained: number; created: number; retired: number; rootReplaced: boolean }
    | { phase: 'scroll'; behavior: NavigationScrollBehavior; decision: 'unavailable' | 'preserve' | 'history' | 'top' | 'fragment' | 'fragment-missing' }
    | { phase: 'transition'; decision: 'disabled' | 'unsupported' | 'callback' | 'typed' | 'types-unsupported' | 'animation-skipped' }
    | { phase: 'finish'; outcome: NavigateOutcome; committed: boolean };
export type DevelopmentComponentRole = 'app' | 'layout' | 'page' | 'loading';
export type DevelopmentNavigationEvent = {
    readonly sequence: number;
    readonly timestamp: number;
    readonly kind: 'navigation';
    readonly navigationId: number | null;
} & (DevelopmentNavigationDiagnostic | { phase: 'component-prepared'; componentId: number; role: DevelopmentComponentRole });
export type DevelopmentTraceEvent = DevelopmentRpcEvent | DevelopmentServiceRpcEvent | DevelopmentNavigationEvent;

export interface DevelopmentTraceSnapshot {
    readonly schemaVersion: 1;
    readonly sessionId: string;
    readonly startedAt: number;
    readonly capturedAt: number;
    readonly collecting: boolean;
    readonly capacity: number;
    readonly dropped: number;
    readonly events: readonly DevelopmentTraceEvent[];
    readonly components: { entries: readonly DevelopmentComponentSnapshot[]; dropped: number; tracking: 'weak' | 'unavailable' };
}
export interface DevelopmentTraceSession {
    snapshot(): DevelopmentTraceSnapshot;
    inspect(component: object, options?: DevelopmentInspectionOptions): DevelopmentComponentSnapshot;
    stop(): void;
}
interface Collector {
    readonly sessionId: string;
    readonly startedAt: number;
    readonly capacity: number;
    readonly components: WeakMap<object, number>;
    readonly services: WeakMap<object, number>;
    serviceSequence: number;
    readonly componentRefs: Map<number, WeakRef<object>>;
    droppedComponents: number;
    componentSequence: number;
    sequence: number;
    dropped: number;
    collecting: boolean;
    events: DevelopmentTraceEvent[];
}
let active: Collector | undefined;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/**
 * Start one opt-in capture per runtime realm. Starting another stops the previous
 * session; in-flight calls retain their original owner and never enter the new one.
 * Buffers retain only fixed lifecycle fields. They are not authoritative server logs.
 */
export function startDevelopmentTrace(options: { capacity?: number } = {}): DevelopmentTraceSession {
    if (!import.meta.env?.DEV) throw Object.assign(new Error('Development trace capture is disabled outside development.'), { code: 'COSSACK_DEVTOOLS_DISABLED' });
    const capacity = options.capacity ?? 512;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2048) throw new RangeError('Trace capacity must be an integer from 1 to 2048.');
    if (active) active.collecting = false;
    const collector: Collector = { sessionId: crypto.randomUUID(), startedAt: Date.now(), capacity,
        components: new WeakMap(), services: new WeakMap(), serviceSequence: 0, componentRefs: new Map(), droppedComponents: 0, componentSequence: 0, sequence: 0, dropped: 0, collecting: true, events: [] };
    active = collector;
    return {
        snapshot: () => ({ schemaVersion: 1, sessionId: collector.sessionId, startedAt: collector.startedAt, capturedAt: Date.now(),
            collecting: collector.collecting, capacity, dropped: collector.dropped,
            events: collector.events.map(event => ({ ...event })),
            components: { tracking: typeof WeakRef === 'function' ? 'weak' : 'unavailable', dropped: collector.droppedComponents,
                entries: [...collector.componentRefs].map(([componentId, reference]) => {
                    if (!collector.collecting) return { componentId, capturedAt: Date.now(), status: 'stopped' };
                    const component = reference.deref();
                    return component ? inspectDevelopmentComponent(component, componentId) : { componentId, capturedAt: Date.now(), status: 'collected' };
                }) } }),
        inspect: (component, options) => {
            if (!collector.collecting) return { componentId: collector.components.get(component) ?? null, capturedAt: Date.now(), status: 'stopped' };
            return inspectDevelopmentComponent(component, componentIdentity(collector, component), options);
        },
        stop: () => { collector.collecting = false; if (active === collector) active = undefined; },
    };
}

function componentIdentity(collector: Collector, component: object): number {
    let id = collector.components.get(component);
    if (id === undefined) { id = ++collector.componentSequence; collector.components.set(component, id); }
    if (typeof WeakRef === 'function' && !collector.componentRefs.has(id)) {
        if (collector.componentRefs.size >= 64) {
            collector.componentRefs.delete(collector.componentRefs.keys().next().value!); collector.droppedComponents++;
        }
        collector.componentRefs.set(id, new WeakRef(component));
    }
    return id;
}
function append(collector: Collector, event: DevelopmentTraceEvent): void {
    if (collector.events.length === collector.capacity) { collector.events.shift(); collector.dropped++; }
    collector.events.push(event);
}

/** Framework integration: each callback retains its capture owner across awaits. */
export interface DevelopmentNavigationTrace {
    record(event: DevelopmentNavigationDiagnostic): void;
    component(component: object, role: DevelopmentComponentRole): void;
}
export function createDevelopmentNavigationTrace(navigationId: number | null): DevelopmentNavigationTrace | undefined {
    if (!import.meta.env?.DEV || !active || (navigationId !== null && (!Number.isSafeInteger(navigationId) || navigationId < 0))) return;
    const collector = active;
    let finished = false;
    const emit = (data: DevelopmentNavigationDiagnostic | { phase: 'component-prepared'; componentId: number; role: DevelopmentComponentRole }) => {
        if (finished || !collector.collecting) return;
        append(collector, { ...data, kind: 'navigation', navigationId, sequence: ++collector.sequence, timestamp: Date.now() });
    };
    return {
        record: event => {
            // Copy only explicitly allowed primitives, even for JavaScript callers.
            const data = navigationDiagnostic(event);
            if (!data) return;
            emit(data);
            if (data.phase === 'finish') finished = true;
        },
        component: (component, role) => {
            if (!collector.collecting || finished || component === null || typeof component !== 'object'
                || !['app', 'layout', 'page', 'loading'].includes(role)) return;
            emit({ phase: 'component-prepared', componentId: componentIdentity(collector, component), role });
        },
    };
}
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
function navigationDiagnostic(event: DevelopmentNavigationDiagnostic): DevelopmentNavigationDiagnostic | undefined {
    if (!event || typeof event !== 'object') return;
    switch (event.phase) {
        case 'start': return ['push', 'replace', 'traverse'].includes(event.navigationType) ? { phase: event.phase, navigationType: event.navigationType } : undefined;
        case 'cache': return ['hit', 'miss', 'shared'].includes(event.decision) ? { phase: event.phase, decision: event.decision } : undefined;
        case 'invalidate': return count(event.entries) ? { phase: event.phase, entries: event.entries } : undefined;
        case 'layouts': return count(event.retained) && count(event.created) && count(event.retired) && typeof event.rootReplaced === 'boolean'
            ? { phase: event.phase, retained: event.retained, created: event.created, retired: event.retired, rootReplaced: event.rootReplaced } : undefined;
        case 'scroll': return ['auto', 'top', 'preserve'].includes(event.behavior)
            && ['unavailable', 'preserve', 'history', 'top', 'fragment', 'fragment-missing'].includes(event.decision)
            ? { phase: event.phase, behavior: event.behavior, decision: event.decision } : undefined;
        case 'transition': return ['disabled', 'unsupported', 'callback', 'typed', 'types-unsupported', 'animation-skipped'].includes(event.decision)
            ? { phase: event.phase, decision: event.decision } : undefined;
        case 'finish': return ['completed', 'superseded', 'canceled', 'redirected', 'failed'].includes(event.outcome) && typeof event.committed === 'boolean'
            ? { phase: event.phase, outcome: event.outcome, committed: event.committed } : undefined;
    }
}

/** @internal Fixed operations keep arbitrary metadata out of the capture boundary. */
export interface DevelopmentRpcTrace {
    response(requestId: string): void;
    state(): void;
    finish(outcome: DevelopmentRpcOutcome): void;
}

/** @internal No session means no event allocation or retained component reference. */
export function beginDevelopmentRpcTrace(component: object, transport: 'http' | 'websocket', requestId: string): DevelopmentRpcTrace | undefined {
    if (!import.meta.env?.DEV || !active) return;
    const collector = active;
    return rpcTrace(collector, { kind: 'rpc', callId: crypto.randomUUID(), componentId: componentIdentity(collector, component), transport }, requestId);
}
/** @internal Service instances are held weakly and are not added to the component registry. */
export function beginDevelopmentServiceRpcTrace(service: object, requestId: string): DevelopmentRpcTrace | undefined {
    if (!import.meta.env?.DEV || !active) return;
    const collector = active;
    let serviceId = collector.services.get(service);
    if (serviceId === undefined) { serviceId = ++collector.serviceSequence; collector.services.set(service, serviceId); }
    return rpcTrace(collector, { kind: 'service-rpc', callId: crypto.randomUUID(), serviceId, transport: 'http' }, requestId);
}
function rpcTrace(collector: Collector, identity:
    | Pick<DevelopmentRpcEvent, 'kind' | 'callId' | 'componentId' | 'transport'>
    | Pick<DevelopmentServiceRpcEvent, 'kind' | 'callId' | 'serviceId' | 'transport'>,
    requestId: string): DevelopmentRpcTrace {
    let wireId = uuid.test(requestId) ? requestId : null;
    let finished = false;
    const emit = (phase: DevelopmentRpcEvent['phase'], outcome: DevelopmentRpcOutcome | null = null) => {
        if (finished || !collector.collecting) return;
        const event: DevelopmentRpcEvent | DevelopmentServiceRpcEvent = { ...identity, requestId: wireId,
            sequence: ++collector.sequence, timestamp: Date.now(), phase, outcome };
        append(collector, event);
    };
    emit('start');
    return {
        response: request => { wireId = uuid.test(request) ? request : null; emit('response'); },
        state: () => emit('state-reconciled'),
        finish: outcome => { emit('finish', outcome); finished = true; },
    };
}
