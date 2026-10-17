/**
 * FastDB typed values and the document-transfer-v1 wire codec, using Web APIs only.
 * Mirrors `@fastdb/node/client` 2.8.0 so the two stay interchangeable.
 */

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const MAX_BYTES = 524_289;
const MAX_DEPTH = 64;

/** An explicit float64. Integral numbers otherwise encode as Integer. */
export class Float64 {
    readonly value: number;
    constructor(value: number) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Float64 requires a finite number');
        this.value = value;
        Object.freeze(this);
    }
}

/** A typed record ID. String and bigint keys are distinct identities. */
export class RecordId {
    readonly table: string;
    readonly key: string | bigint;
    constructor(table: string, key: string | bigint) {
        if (typeof table !== 'string' || !table || table.includes('\0') || /^(?:__fastdb_|__turso_internal_|sqlite_)/i.test(table)) {
            throw new TypeError('RecordId requires a nonreserved logical table name');
        }
        if ((typeof key !== 'string' && typeof key !== 'bigint') || key === '') throw new TypeError('RecordId requires a nonempty string or bigint key');
        if (typeof key === 'bigint') checkInteger(key);
        this.table = table;
        this.key = key;
        Object.freeze(this);
    }

    /** `table:key` display text. Not a wire format; integer and string keys can print alike. */
    toString(): string {
        return `${this.table}:${String(this.key)}`;
    }

    equals(other: unknown): boolean {
        return other instanceof RecordId && other.table === this.table && other.key === this.key;
    }
}

/** Encoded vector bytes, copied on construction. */
export class Vector {
    readonly #bytes: Uint8Array;
    constructor(bytes: Uint8Array) {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new TypeError('Vector requires bounded encoded bytes');
        this.#bytes = bytes.slice();
        Object.freeze(this);
    }
    get bytes(): Uint8Array { return this.#bytes.slice(); }
    static float32(values: readonly number[] | Float32Array | Float64Array): Vector { return denseVector(values, 4); }
    static float64(values: readonly number[] | Float32Array | Float64Array): Vector { return denseVector(values, 8); }
    static sparse32Entries(dimensions: number, entries: readonly (readonly [number, number])[]): Vector {
        checkDimensions(dimensions);
        if (!Array.isArray(entries) || entries.length > dimensions) throw new TypeError('sparse entries require bounded index/value pairs');
        let previous = -1;
        const nonzero: [number, number][] = [];
        for (const entry of entries) {
            if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError('sparse entries require index/value pairs');
            const [index, value] = entry;
            if (!Number.isInteger(index) || index <= previous || index >= dimensions) throw new RangeError('sparse indices must be increasing and within dimensions');
            checkComponent(value, 4);
            const rounded = Math.fround(value);
            if (rounded !== 0) nonzero.push([index, rounded]);
            previous = index;
        }
        const bytes = new Uint8Array(nonzero.length * 8 + 5);
        const view = new DataView(bytes.buffer);
        nonzero.forEach(([index, value], i) => {
            view.setFloat32(i * 4, value, true);
            view.setUint32(nonzero.length * 4 + i * 4, index, true);
        });
        view.setUint32(nonzero.length * 8, dimensions, true);
        bytes[bytes.length - 1] = 9;
        return new Vector(bytes);
    }
}

export type Value =
    | null | boolean | bigint | number | string
    | Float64 | RecordId | Vector | Uint8Array
    | Value[] | { [key: string]: Value };

export type PortableValue =
    | { type: 'Null' }
    | { type: 'Boolean'; value: boolean }
    | { type: 'Integer' | 'Number' | 'String'; value: string }
    | { type: 'Binary' | 'Vector'; value: number[] | string }
    | { type: 'Record'; value: { table: string; key: { type: 'Integer' | 'String'; value: string } } }
    | { type: 'Array'; value: PortableValue[] }
    | { type: 'Object'; value: { [key: string]: PortableValue } };

/** Encode a value. `base64` selects the Cloud query version 3 byte encoding. */
export function encodeValue(value: Value, base64 = false, depth = 0): PortableValue {
    checkDepth(depth);
    if (value === null) return { type: 'Null' };
    if (typeof value === 'boolean') return { type: 'Boolean', value };
    if (typeof value === 'string') return { type: 'String', value: text(value) };
    if (typeof value === 'bigint') { checkInteger(value); return { type: 'Integer', value: value.toString() }; }
    if (value instanceof Float64) return encodeFloat(value.value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('non-finite number');
        if (Number.isInteger(value) && !Object.is(value, -0)) {
            if (!Number.isSafeInteger(value)) throw new RangeError('use bigint or Float64 for integers outside the safe Number range');
            return { type: 'Integer', value: String(value) };
        }
        return encodeFloat(value);
    }
    if (value instanceof RecordId) {
        return { type: 'Record', value: { table: text(value.table), key: encodeValue(value.key) as { type: 'Integer' | 'String'; value: string } } };
    }
    if (value instanceof Vector) return { type: 'Vector', value: base64 ? toBase64(value.bytes) : [...value.bytes] };
    if (value instanceof Uint8Array) return { type: 'Binary', value: base64 ? toBase64(value) : [...value] };
    if (Array.isArray(value)) {
        const entries: PortableValue[] = [];
        for (let i = 0; i < value.length; i++) {
            if (!Object.hasOwn(value, i)) throw new TypeError('array holes are not database values');
            entries.push(encodeValue(value[i]!, base64, depth + 1));
        }
        return { type: 'Array', value: entries };
    }
    if (plainObject(value)) {
        const entries: { [key: string]: PortableValue } = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined) throw new TypeError('undefined is not a database value; omit the field instead');
            entries[text(key)] = encodeValue(entry, base64, depth + 1);
        }
        return { type: 'Object', value: entries };
    }
    throw new TypeError('unsupported parameter value');
}

export function decodeValue(value: unknown, depth = 0): Value {
    checkDepth(depth);
    if (!plainObject(value) || typeof value.type !== 'string') throw new TypeError('invalid tagged value');
    const keys = Object.keys(value);
    if (value.type === 'Null') {
        if (keys.length !== 1) throw new TypeError('invalid Null value');
        return null;
    }
    if (keys.length !== 2 || !Object.hasOwn(value, 'value')) throw new TypeError('invalid tagged value fields');
    const payload = value.value;
    switch (value.type) {
        case 'Boolean':
            if (typeof payload !== 'boolean') throw new TypeError('invalid Boolean value');
            return payload;
        case 'String':
            if (typeof payload !== 'string') throw new TypeError('invalid String value');
            return payload;
        case 'Integer': {
            if (typeof payload !== 'string' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(payload)) throw new TypeError('invalid canonical int64');
            const integer = BigInt(payload);
            checkInteger(integer);
            return integer;
        }
        case 'Number': {
            if (typeof payload !== 'string' || !/^[0-9a-f]{16}$/.test(payload)) throw new TypeError('invalid float64 bits');
            const view = new DataView(new ArrayBuffer(8));
            for (let i = 0; i < 8; i++) view.setUint8(i, parseInt(payload.slice(i * 2, i * 2 + 2), 16));
            return new Float64(view.getFloat64(0, false));
        }
        case 'Binary': case 'Vector': {
            const bytes = typeof payload === 'string' ? fromBase64(payload) : byteArray(payload);
            return value.type === 'Vector' ? new Vector(bytes) : bytes;
        }
        case 'Record': {
            if (!plainObject(payload) || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'table') || !Object.hasOwn(payload, 'key')) throw new TypeError('invalid Record value');
            const table = payload.table as string;
            const key = payload.key;
            // Historical Cloud receipts keep their original enum-key encoding.
            if (plainObject(key) && Object.keys(key).length === 1) {
                const kind = Object.keys(key)[0]!;
                if (kind === 'String' || kind === 'Integer') return new RecordId(table, decodeValue({ type: kind, value: key[kind] }) as string | bigint);
            }
            if (!plainObject(key) || (key.type !== 'String' && key.type !== 'Integer')) throw new TypeError('invalid Record key');
            return new RecordId(table, decodeValue(key) as string | bigint);
        }
        case 'Array':
            if (!Array.isArray(payload)) throw new TypeError('invalid Array value');
            return payload.map(entry => decodeValue(entry, depth + 1));
        case 'Object': {
            if (!plainObject(payload)) throw new TypeError('invalid Object value');
            const result: { [key: string]: Value } = {};
            for (const [key, entry] of Object.entries(payload)) result[key] = decodeValue(entry, depth + 1);
            return result;
        }
        default: throw new TypeError('unsupported value tag');
    }
}

export function plainObject(value: unknown): value is { [key: string]: unknown } {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when the string has no lone surrogates (String.prototype.isWellFormed, without needing the ES2024 lib). */
export function isWellFormed(value: string): boolean {
    return !LONE_SURROGATE.test(value);
}

export function text(value: string): string {
    if (!isWellFormed(value)) throw new TypeError('strings must be well-formed Unicode');
    return value;
}

export function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

export function fromBase64(payload: string): Uint8Array {
    if (payload.length > 1_048_576 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) throw new TypeError('invalid base64 bytes');
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (toBase64(bytes) !== payload) throw new TypeError('invalid base64 bytes');
    return bytes;
}

function encodeFloat(value: number): PortableValue {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, false);
    let hex = '';
    for (let i = 0; i < 8; i++) hex += view.getUint8(i).toString(16).padStart(2, '0');
    return { type: 'Number', value: hex };
}

function byteArray(payload: unknown): Uint8Array {
    if (!Array.isArray(payload) || payload.length > MAX_BYTES || payload.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new TypeError('invalid byte array');
    return Uint8Array.from(payload as number[]);
}

function denseVector(values: readonly number[] | Float32Array | Float64Array, width: 4 | 8): Vector {
    if (!Array.isArray(values) && !(values instanceof Float32Array) && !(values instanceof Float64Array)) throw new TypeError('vector components require a number array');
    checkDimensions(values.length);
    const bytes = new Uint8Array(values.length * width + (width === 8 ? 1 : 0));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < values.length; i++) {
        const value = values[i]!;
        checkComponent(value, width);
        if (width === 4) view.setFloat32(i * width, value, true);
        else view.setFloat64(i * width, value, true);
    }
    if (width === 8) bytes[bytes.length - 1] = 2;
    return new Vector(bytes);
}

function checkDimensions(dimensions: number): void {
    if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65_536) throw new RangeError('vector dimensions must be 1..65536');
}

function checkComponent(value: number, width: 4 | 8): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('vector components must be finite');
    if (width === 4 && !Number.isFinite(Math.fround(value))) throw new RangeError('vector component is outside the finite float32 range');
}

function checkInteger(value: bigint): void {
    if (value < INT64_MIN || value > INT64_MAX) throw new RangeError('integer outside int64');
}

function checkDepth(depth: number): void {
    if (depth > MAX_DEPTH) throw new RangeError('value nesting exceeds 64');
}
