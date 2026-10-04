/** Passive development snapshots. Framework-owned providers never call authored getters/loaders. */
export type DevelopmentValue =
    | { type: 'null' | 'undefined' | 'omitted' | 'redacted' | 'unsupported' | 'accessor' | 'truncated' | 'cycle' | 'hole' }
    | { type: 'string'; value: string }
    | { type: 'number'; value: number | null }
    | { type: 'boolean'; value: boolean }
    | { type: 'array'; items: DevelopmentValue[]; truncated: boolean }
    | { type: 'object'; entries: { name: string; value: DevelopmentValue }[]; truncated: boolean };
export interface DevelopmentInspectionOptions { state?: readonly string[] }
export interface DevelopmentStateSnapshot {
    fields: { name: string; visibility: 'public' | 'client'; value: DevelopmentValue }[];
    truncated: boolean;
}
export interface DevelopmentResourceSnapshot {
    name: string; state: 'unbound' | 'pending' | 'ready' | 'error'; hasValue: boolean; stale: boolean;
}
export interface DevelopmentScopeSnapshot {
    scopeId: number; parentId: number | null; disposed: boolean; pendingCalls: number; subscribers: number;
    services: { slot: string; name: string; initialized: boolean }[]; truncated: boolean;
}
export interface DevelopmentTransportSnapshot {
    transport: 'sse' | 'websocket'; slot: number;
    state: 'connecting' | 'open' | 'reconnecting' | 'closed'; attempts: number; resynced: boolean;
}
export interface DevelopmentComponentDetails {
    lifecycle: string;
    state: DevelopmentStateSnapshot;
    resources: { entries: DevelopmentResourceSnapshot[]; truncated: boolean };
    scopes: { entries: DevelopmentScopeSnapshot[]; truncated: boolean };
    transports: { entries: DevelopmentTransportSnapshot[]; truncated: boolean };
}
export type DevelopmentComponentSnapshot = { capturedAt: number } & ({ componentId: number; status: 'available'; details: DevelopmentComponentDetails }
    | { componentId: number | null; status: 'unavailable' | 'stopped' | 'collected' });
const readers = new WeakMap<object, (fields: ReadonlySet<string>) => DevelopmentComponentDetails>();
const scopes = new WeakMap<object, () => Omit<DevelopmentScopeSnapshot, 'scopeId' | 'parentId'> & { parent?: object }>();
const scopeIds = new WeakMap<object, number>();
let nextScope = 0;
const scopeId = (scope: object) => { let id = scopeIds.get(scope); if (id === undefined) { id = ++nextScope; scopeIds.set(scope, id); } return id; };
export const developmentData = (object: object | undefined, key: string): any => object && Object.getOwnPropertyDescriptor(object, key)?.value;
const sensitive = /secret|token|password|credential|private.?key|api.?key|authorization|cookie/i;
export const developmentName = (name: unknown): string => typeof name === 'string' && /^[A-Za-z_$][\w$]{0,127}$/.test(name) ? name : '[omitted]';

/** @internal Registered once by framework constructors, held weakly. */
export function registerDevelopmentInspector(component: object, reader: (fields: ReadonlySet<string>) => DevelopmentComponentDetails): void {
    if (import.meta.env?.DEV) readers.set(component, reader);
}
/** @internal The caller owns the capture/session guard. */
export function inspectDevelopmentComponent(component: object, componentId: number, options: DevelopmentInspectionOptions = {}): DevelopmentComponentSnapshot {
    const capturedAt = Date.now();
    const fields = options.state ?? [];
    if (!Array.isArray(fields) || fields.length > 32 || fields.some(field => typeof field !== 'string' || field.length > 128)) {
        throw new TypeError('Select at most 32 state field names, each at most 128 characters.');
    }
    const read = readers.get(component);
    if (!read) return { capturedAt, componentId, status: 'unavailable' };
    try { return { capturedAt, componentId, status: 'available', details: read(new Set(fields)) }; }
    catch { return { capturedAt, componentId, status: 'unavailable' }; }
}
/** @internal Never resolves or instantiates services. */
export function registerDevelopmentScope(scope: object, reader: () => Omit<DevelopmentScopeSnapshot, 'scopeId' | 'parentId'> & { parent?: object }): void {
    if (import.meta.env?.DEV) scopes.set(scope, reader);
}
export function inspectDevelopmentScopes(scope?: object): DevelopmentComponentDetails['scopes'] {
    const entries: DevelopmentScopeSnapshot[] = [], seen = new Set<object>();
    while (scope && entries.length < 16 && !seen.has(scope)) {
        seen.add(scope);
        const read = scopes.get(scope); if (!read) return { entries, truncated: true };
        const { parent, ...data } = read();
        entries.push({ ...data, scopeId: scopeId(scope), parentId: parent ? scopeId(parent) : null });
        scope = parent;
    }
    return { entries, truncated: !!scope };
}

/** One bounded value budget per component snapshot, including all selected fields. */
export function developmentValueReader() {
    let remaining = 256;
    const ancestors = new WeakSet<object>();
    const read = (value: unknown, name: string, depth = 0): DevelopmentValue => {
        if (--remaining < 0 || depth > 4) return { type: 'truncated' };
        if (sensitive.test(name)) return { type: 'redacted' };
        if (value === null) return { type: 'null' };
        if (value === undefined) return { type: 'undefined' };
        if (typeof value === 'boolean') return { type: 'boolean', value };
        if (typeof value === 'number') return { type: 'number', value: Number.isFinite(value) ? value : null };
        if (typeof value === 'string' && value.length > 512) return { type: 'truncated' };
        if (typeof value === 'string') return { type: 'string', value: value
            .replace(/\b(Bearer\s+)\S+/gi, '$1[REDACTED]')
            .replace(/\b((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
            .replace(/([a-z]+:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@') };
        if (typeof value !== 'object') return { type: 'unsupported' };
        if (ancestors.has(value)) return { type: 'cycle' };
        try {
            const prototype = Object.getPrototypeOf(value);
            const array = Array.isArray(value);
            if (!array && prototype !== Object.prototype && prototype !== null) return { type: 'unsupported' };
            ancestors.add(value);
            if (array) {
                const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
                if (!Number.isSafeInteger(length) || length < 0) return { type: 'unsupported' };
                const items: DevelopmentValue[] = [];
                for (let index = 0; index < Math.min(length, 32) && remaining > 0; index++) {
                    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                    if (!descriptor || !('value' in descriptor)) remaining--;
                    items.push(!descriptor ? { type: 'hole' } : 'value' in descriptor
                        ? read(descriptor.value, String(index), depth + 1) : { type: 'accessor' });
                }
                return { type: 'array', items, truncated: items.length < length };
            }
            const keys = Object.keys(value), entries: { name: string; value: DevelopmentValue }[] = [];
            for (const key of keys.slice(0, 32)) {
                if (remaining <= 0) break;
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !('value' in descriptor)) remaining--;
                entries.push({ name: developmentName(key), value: descriptor && 'value' in descriptor
                    ? read(descriptor.value, key, depth + 1) : { type: 'accessor' } });
            }
            const truncated = entries.length < keys.length;
            return { type: 'object', entries, truncated };
        } catch { return { type: 'unsupported' }; }
        finally { ancestors.delete(value); }
    };
    return read;
}
