import type { DevelopmentTraceSnapshot } from '@cossackframework/core/devtools';

export const DEVELOPMENT_TRACE_DIRECTORY = '.cossack/development-traces';
export const DEVELOPMENT_TRACE_MAX_BYTES = 2 * 1024 * 1024;
export const DEVELOPMENT_TRACE_SESSION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const traceFailure = (code: string, message: string) => Object.assign(new Error(message), { code });
const invalid = () => traceFailure('COSSACK_TRACE_INVALID', 'Development trace evidence has an invalid schema or exceeds its limits.');
type RecordValue = Record<string, any>;
function object(value: unknown, keys: string[]): asserts value is RecordValue {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}
function number(value: unknown, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) throw invalid(); }
function bool(value: unknown) { if (typeof value !== 'boolean') throw invalid(); }
function choice(value: unknown, values: readonly unknown[]) { if (!values.includes(value)) throw invalid(); }
function array(value: unknown, max: number): asserts value is any[] { if (!Array.isArray(value) || value.length > max) throw invalid(); }
function name(value: unknown) { if (typeof value !== 'string' || !/^(?:[A-Za-z_$][\w$]{0,127}|\[omitted\])$/.test(value)) throw invalid(); }
function id(value: unknown) { if (typeof value !== 'string' || !DEVELOPMENT_TRACE_SESSION.test(value)) throw invalid(); }
function component(value: unknown) {
    if (!value || typeof value !== 'object') throw invalid();
    const c = value as RecordValue;
    choice(c.status, ['available', 'unavailable', 'stopped', 'collected']);
    object(c, c.status === 'available' ? ['capturedAt', 'componentId', 'status', 'details'] : ['capturedAt', 'componentId', 'status']);
    number(c.capturedAt); if (c.componentId !== null) number(c.componentId);
    if (c.status !== 'available') return;
    number(c.componentId);
    const d = c.details;
    object(d, ['lifecycle', 'state', 'resources', 'scopes', 'transports']); choice(d.lifecycle, ['Creating', 'Bootstrapping', 'Mounted', 'Updating', 'Destroyed']);
    object(d.state, ['fields', 'truncated']); bool(d.state.truncated); array(d.state.fields, 64);
    for (const field of d.state.fields) {
        object(field, ['name', 'visibility', 'value']); name(field.name); choice(field.visibility, ['public', 'client']);
        // Persist default inventory only. Explicit selected values never cross this bridge.
        object(field.value, ['type']); choice(field.value.type, ['omitted']);
    }
    for (const key of ['resources', 'scopes', 'transports']) { object(d[key], ['entries', 'truncated']); bool(d[key].truncated); array(d[key].entries, key === 'scopes' ? 16 : 64); }
    for (const r of d.resources.entries) { object(r, ['name', 'state', 'hasValue', 'stale']); name(r.name); choice(r.state, ['unbound', 'pending', 'ready', 'error']); bool(r.hasValue); bool(r.stale); }
    for (const s of d.scopes.entries) {
        object(s, ['scopeId', 'parentId', 'disposed', 'pendingCalls', 'subscribers', 'services', 'truncated']);
        number(s.scopeId); if (s.parentId !== null) number(s.parentId); bool(s.disposed); number(s.pendingCalls); number(s.subscribers); bool(s.truncated); array(s.services, 64);
        for (const service of s.services) { object(service, ['slot', 'name', 'initialized']); if (typeof service.slot !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/.test(service.slot)) throw invalid(); name(service.name); bool(service.initialized); }
    }
    for (const t of d.transports.entries) { object(t, ['transport', 'slot', 'state', 'attempts', 'resynced']); choice(t.transport, ['sse', 'websocket']); number(t.slot); choice(t.state, ['connecting', 'open', 'reconnecting', 'closed']); number(t.attempts); bool(t.resynced); }
}
/** Validate parsed JSON, never arbitrary application objects. Strict fields exclude payloads and selected values. */
export function parseDevelopmentTrace(json: string): DevelopmentTraceSnapshot {
    if (typeof json !== 'string' || json.length > DEVELOPMENT_TRACE_MAX_BYTES || new TextEncoder().encode(json).length > DEVELOPMENT_TRACE_MAX_BYTES) throw invalid();
    let s: RecordValue;
    try { s = JSON.parse(json); } catch { throw invalid(); }
    object(s, ['schemaVersion', 'sessionId', 'startedAt', 'capturedAt', 'collecting', 'capacity', 'dropped', 'events', 'components']);
    choice(s.schemaVersion, [1]); id(s.sessionId); number(s.startedAt); number(s.capturedAt); bool(s.collecting); number(s.capacity, 2048); if (!s.capacity) throw invalid(); number(s.dropped); array(s.events, s.capacity);
    let sequence = 0;
    for (const e of s.events) {
        if (!e || typeof e !== 'object') throw invalid();
        const common = ['kind', 'sequence', 'timestamp', 'phase'];
        number(e.sequence); if (e.sequence <= sequence) throw invalid(); sequence = e.sequence; number(e.timestamp);
        if (e.kind === 'rpc') {
            object(e, [...common, 'callId', 'requestId', 'componentId', 'transport', 'outcome']);
            id(e.callId); if (e.requestId !== null && (typeof e.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(e.requestId))) throw invalid();
            number(e.componentId); choice(e.transport, ['http', 'websocket']); choice(e.phase, ['start', 'response', 'state-reconciled', 'finish']);
            choice(e.outcome, e.phase === 'finish' ? ['succeeded', 'failed', 'cancelled', 'timeout', 'disconnected'] : [null]);
        } else if (e.kind === 'navigation') {
            const fields: Record<string, string[]> = { start: ['navigationType'], cache: ['decision'], invalidate: ['entries'], layouts: ['retained', 'created', 'retired', 'rootReplaced'], scroll: ['behavior', 'decision'], transition: ['decision'], finish: ['outcome', 'committed'], 'component-prepared': ['componentId', 'role'] };
            if (!Object.hasOwn(fields, e.phase)) throw invalid(); object(e, [...common, 'navigationId', ...fields[e.phase]]);
            if (e.navigationId !== null) number(e.navigationId);
            switch (e.phase) {
                case 'start': choice(e.navigationType, ['push', 'replace', 'traverse']); break;
                case 'cache': choice(e.decision, ['hit', 'miss', 'shared']); break;
                case 'invalidate': number(e.entries); break;
                case 'layouts': number(e.retained); number(e.created); number(e.retired); bool(e.rootReplaced); break;
                case 'scroll': choice(e.behavior, ['auto', 'preserve', 'top']); choice(e.decision, ['unavailable', 'preserve', 'history', 'top', 'fragment', 'fragment-missing']); break;
                case 'transition': choice(e.decision, ['disabled', 'unsupported', 'callback', 'typed', 'types-unsupported', 'animation-skipped']); break;
                case 'finish': choice(e.outcome, ['completed', 'superseded', 'canceled', 'redirected', 'failed']); bool(e.committed); break;
                case 'component-prepared': number(e.componentId); choice(e.role, ['app', 'layout', 'page', 'loading']); break;
            }
        } else throw invalid();
    }
    object(s.components, ['entries', 'dropped', 'tracking']); array(s.components.entries, 64); number(s.components.dropped); choice(s.components.tracking, ['weak', 'unavailable']);
    for (const c of s.components.entries) component(c);
    return s as unknown as DevelopmentTraceSnapshot;
}
