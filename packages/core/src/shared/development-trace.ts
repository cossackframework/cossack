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
export interface DevelopmentTraceSnapshot {
    readonly schemaVersion: 1;
    readonly sessionId: string;
    readonly startedAt: number;
    readonly collecting: boolean;
    readonly capacity: number;
    readonly dropped: number;
    readonly events: readonly DevelopmentRpcEvent[];
}
export interface DevelopmentTraceSession {
    snapshot(): DevelopmentTraceSnapshot;
    stop(): void;
}
interface Collector {
    readonly sessionId: string;
    readonly startedAt: number;
    readonly capacity: number;
    readonly components: WeakMap<object, number>;
    componentSequence: number;
    sequence: number;
    dropped: number;
    collecting: boolean;
    events: DevelopmentRpcEvent[];
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
        components: new WeakMap(), componentSequence: 0, sequence: 0, dropped: 0, collecting: true, events: [] };
    active = collector;
    return {
        snapshot: () => ({ schemaVersion: 1, sessionId: collector.sessionId, startedAt: collector.startedAt,
            collecting: collector.collecting, capacity, dropped: collector.dropped,
            events: collector.events.map(event => ({ ...event })) }),
        stop: () => { collector.collecting = false; if (active === collector) active = undefined; },
    };
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
    let componentId = collector.components.get(component);
    if (componentId === undefined) { componentId = ++collector.componentSequence; collector.components.set(component, componentId); }
    const identity = { callId: crypto.randomUUID(), componentId, transport };
    let wireId = uuid.test(requestId) ? requestId : null;
    let finished = false;
    const emit = (phase: DevelopmentRpcEvent['phase'], outcome: DevelopmentRpcOutcome | null = null) => {
        if (finished || !collector.collecting) return;
        const event: DevelopmentRpcEvent = { ...identity, kind: 'rpc', requestId: wireId,
            sequence: ++collector.sequence, timestamp: Date.now(), phase, outcome };
        if (collector.events.length === collector.capacity) { collector.events.shift(); collector.dropped++; }
        collector.events.push(event);
    };
    emit('start');
    return {
        response: request => { wireId = uuid.test(request) ? request : null; emit('response'); },
        state: () => emit('state-reconciled'),
        finish: outcome => { emit('finish', outcome); finished = true; },
    };
}
