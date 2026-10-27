import { Float64, RecordId, Vector, fromBase64, plainObject, toBase64, type Value } from './values';

/** Version of the JSON transport representation. */
export const TRANSPORT_VERSION = 1;

/**
 * JSON-safe form of a RomeDB value for SSR state, hydration, RPC and plugin boundaries.
 * JSON scalars and arrays pass through; other values become `{ $fdb: 1, t, v }` objects, and
 * plain objects that contain a `$fdb` key are wrapped so they cannot be mistaken for a tag.
 */
export type TransportValue =
    | null | boolean | string | number
    | TransportValue[]
    | { [key: string]: TransportValue };

type Tag = 'int' | 'f64' | 'rec' | 'bin' | 'vec' | 'obj';

export function toTransport(value: Value): TransportValue {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('non-finite number');
        // JSON drops the sign of negative zero.
        return Object.is(value, -0) ? tag('f64', floatBits(value)) : value;
    }
    if (typeof value === 'bigint') return tag('int', value.toString());
    if (value instanceof Float64) return tag('f64', floatBits(value.value));
    if (value instanceof RecordId) return tag('rec', { table: value.table, [typeof value.key === 'bigint' ? 'int' : 'key']: String(value.key) });
    if (value instanceof Vector) return tag('vec', toBase64(value.bytes));
    if (value instanceof Uint8Array) return tag('bin', toBase64(value));
    if (Array.isArray(value)) return value.map(toTransport);
    if (plainObject(value)) {
        const entries: { [key: string]: TransportValue } = {};
        for (const [key, entry] of Object.entries(value)) entries[key] = toTransport(entry);
        return Object.hasOwn(value, '$fdb') ? tag('obj', entries) : entries;
    }
    throw new TypeError('unsupported value');
}

export function fromTransport(value: unknown, depth = 0): Value {
    if (depth > 64) throw new RangeError('value nesting exceeds 64');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('non-finite number');
        return value;
    }
    if (Array.isArray(value)) return value.map(entry => fromTransport(entry, depth + 1));
    if (!plainObject(value)) throw new TypeError('invalid transport value');
    if (!Object.hasOwn(value, '$fdb')) {
        const entries: { [key: string]: Value } = {};
        for (const [key, entry] of Object.entries(value)) entries[key] = fromTransport(entry, depth + 1);
        return entries;
    }
    if (value.$fdb !== TRANSPORT_VERSION || Object.keys(value).sort().join() !== '$fdb,t,v') throw new TypeError('unsupported transport tag');
    const payload = value.v;
    switch (value.t as Tag) {
        case 'int':
            if (typeof payload !== 'string' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(payload)) throw new TypeError('invalid int64');
            return BigInt(payload);
        case 'f64': {
            if (typeof payload !== 'string' || !/^[0-9a-f]{16}$/.test(payload)) throw new TypeError('invalid float64 bits');
            const view = new DataView(new ArrayBuffer(8));
            for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(payload.slice(i * 2, i * 2 + 2), 16));
            return new Float64(view.getFloat64(0, false));
        }
        case 'rec': {
            if (!plainObject(payload) || typeof payload.table !== 'string') throw new TypeError('invalid record');
            if (typeof payload.key === 'string' && Object.keys(payload).length === 2) return new RecordId(payload.table, payload.key);
            if (typeof payload.int === 'string' && Object.keys(payload).length === 2 && /^(?:0|-?[1-9][0-9]{0,18})$/.test(payload.int)) return new RecordId(payload.table, BigInt(payload.int));
            throw new TypeError('invalid record');
        }
        case 'bin':
            if (typeof payload !== 'string') throw new TypeError('invalid binary');
            return fromBase64(payload);
        case 'vec':
            if (typeof payload !== 'string') throw new TypeError('invalid vector');
            return new Vector(fromBase64(payload));
        case 'obj': {
            if (!plainObject(payload)) throw new TypeError('invalid object');
            const entries: { [key: string]: Value } = {};
            for (const [key, entry] of Object.entries(payload)) entries[key] = fromTransport(entry, depth + 1);
            return entries;
        }
        default: throw new TypeError('unsupported transport tag');
    }
}

function tag(t: Tag, v: TransportValue): TransportValue {
    return { $fdb: TRANSPORT_VERSION, t, v };
}

function floatBits(value: number): string {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, false);
    let hex = '';
    for (let i = 0; i < 8; i++) hex += view.getUint8(i).toString(16).padStart(2, '0');
    return hex;
}
