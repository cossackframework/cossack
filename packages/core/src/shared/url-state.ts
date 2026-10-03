/** Portable page query contracts. Parsing has no application or browser dependency. */
export type UrlScalar = string | number | boolean;
export type UrlValue = UrlScalar | readonly UrlScalar[] | undefined;
declare const codecValue: unique symbol;
export interface UrlCodec<T extends UrlValue> { readonly [codecValue]: T }
export type UrlCodecValue<C> = C extends UrlCodec<infer T> ? T : never;
export type UrlStateValues<S extends Record<string, UrlCodec<UrlValue>>> =
    Readonly<{ [K in keyof S]: UrlCodecValue<S[K]> }>;
type UnionKeys<T> = T extends unknown ? keyof T : never;
export type UrlStateIssueCode = 'invalid-encoding' | 'repeated-scalar' | 'invalid-value';
export interface UrlStateIssue { readonly field: string; readonly code: UrlStateIssueCode }
export interface UrlStateRead<T> { readonly values: T; readonly issues: readonly UrlStateIssue[] }
export interface UrlStateDefinition<S extends Record<string, UrlCodec<UrlValue>>> {
    readonly keys: readonly (keyof S & string)[];
    read(url: string | URL): UrlStateRead<UrlStateValues<S>>;
    /** Undefined resets a key to its default. Unknown query pairs and fragments survive. */
    url<P extends { [K in keyof S]?: UrlCodecValue<S[K]> | undefined }>(
        current: string | URL,
        patch: P & Record<Exclude<UnionKeys<P>, keyof S>, never>,
        options?: { defaults?: 'omit' | 'include' },
    ): string;
}
export type InferUrlState<D> = D extends UrlStateDefinition<infer S> ? UrlStateValues<S> : never;
export class UrlStateError extends Error {
    constructor(readonly code: string, readonly field?: string) {
        super(`[Cossack] ${code}${field ? ` for query field ${field}` : ''}.`);
        this.name = 'UrlStateError';
    }
}

const MAX_QUERY_LENGTH = 65_536;
const MAX_PAIRS = 1_024;
const MAX_FIELDS = 128;
const MAX_STRING_LENGTH = 2_048;
const MAX_ARRAY_ITEMS = 100;
type Codec = {
    kind: 'scalar' | 'array'; defaultValue: UrlValue;
    parse(raw: string): UrlScalar | undefined;
    accepts(value: unknown): boolean;
    encode(value: UrlScalar): string;
    item?: Codec;
    maxItems?: number;
};
const codecs = new WeakMap<object, Codec>();
function fail(code: string, field?: string): never { throw new UrlStateError(`COSSACK_URL_STATE_${code}`, field); }
function rejectCallbackValue(value: unknown): never {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) void Promise.resolve(value).catch(() => {});
    return fail('CODEC_INVALID');
}
function getCodec(codec: object): Codec {
    const implementation = codecs.get(codec);
    return implementation ?? fail('CODEC_INVALID');
}
function scalar(value: unknown): value is UrlScalar {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    if (typeof value !== 'string' || value.length > MAX_STRING_LENGTH) return false;
    try { encodeURIComponent(value); return true; } catch { return false; }
}
function snapshot(value: UrlValue): UrlValue {
    if (!Array.isArray(value)) return value;
    if (value.length > MAX_ARRAY_ITEMS) return fail('VALUE_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return fail('VALUE_INVALID');
    const copy: UrlScalar[] = [];
    for (let i = 0; i < value.length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !('value' in descriptor) || !scalar(descriptor.value)) return fail('VALUE_INVALID');
        copy.push(descriptor.value);
    }
    return Object.freeze(copy);
}
function accepts(codec: Codec, value: unknown): boolean {
    if (value === undefined) return codec.defaultValue === undefined;
    if (codec.kind === 'scalar') return scalar(value) && codec.accepts(value);
    if (!Array.isArray(value) || value.length > codec.maxItems!) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return false;
    for (let i = 0; i < value.length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !('value' in descriptor) || !accepts(codec.item!, descriptor.value)) return false;
    }
    return true;
}
function register<T extends UrlValue>(codec: Codec): UrlCodec<T> {
    if (!accepts(codec, codec.defaultValue)) return fail('DEFAULT_INVALID');
    codec.defaultValue = snapshot(codec.defaultValue);
    const token = Object.freeze({});
    codecs.set(token, Object.freeze(codec));
    return token as UrlCodec<T>;
}
function numberCodec(options: { default?: number; min?: number; max?: number; integer?: boolean } = {}): UrlCodec<number> {
    const { min = -Number.MAX_VALUE, max = Number.MAX_VALUE, integer = false, default: defaultValue = 0 } = options;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || typeof integer !== 'boolean') return fail('CONFIG_INVALID');
    const valid = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isSafeInteger(value));
    return register({ kind: 'scalar', defaultValue, accepts: valid, encode: String, parse(raw) {
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return undefined;
        const value = Number(raw); return valid(value) ? value : undefined;
    } });
}

export const url = Object.freeze({
    string(options: { default?: string; minLength?: number; maxLength?: number } = {}): UrlCodec<string> {
        const { default: defaultValue = '', minLength = 0, maxLength = MAX_STRING_LENGTH } = options;
        if (!Number.isSafeInteger(minLength) || !Number.isSafeInteger(maxLength) || minLength < 0 || maxLength < minLength || maxLength > MAX_STRING_LENGTH) return fail('CONFIG_INVALID');
        const valid = (value: unknown) => typeof value === 'string' && scalar(value) && value.length >= minLength && value.length <= maxLength;
        return register({ kind: 'scalar', defaultValue, accepts: valid, encode: String, parse: raw => valid(raw) ? raw : undefined });
    },
    number: numberCodec,
    integer(options: { default?: number; min?: number; max?: number } = {}): UrlCodec<number> {
        return numberCodec({ ...options, integer: true });
    },
    boolean(options: { default?: boolean } = {}): UrlCodec<boolean> {
        return register({ kind: 'scalar', defaultValue: options.default === undefined ? false : options.default,
            accepts: value => typeof value === 'boolean', encode: String,
            parse: raw => raw === 'true' ? true : raw === 'false' ? false : undefined });
    },
    enum<const V extends readonly [string, ...string[]]>(values: V, options: { default?: V[number] } = {}): UrlCodec<V[number]> {
        if (!Array.isArray(values)) return fail('CONFIG_INVALID');
        const copy = snapshot(values) as readonly string[];
        if (!copy.length || !copy.every(value => typeof value === 'string') || new Set(copy).size !== copy.length) return fail('CONFIG_INVALID');
        const allowed = new Set(copy);
        return register({ kind: 'scalar', defaultValue: options.default === undefined ? copy[0]! : options.default,
            accepts: value => typeof value === 'string' && allowed.has(value), encode: String,
            parse: raw => allowed.has(raw) ? raw : undefined });
    },
    array<T extends UrlScalar>(item: UrlCodec<T>, options: { default?: readonly T[]; maxItems?: number } = {}): UrlCodec<readonly T[]> {
        const implementation = getCodec(item);
        const maxItems = options.maxItems ?? MAX_ARRAY_ITEMS;
        if (implementation.kind !== 'scalar' || implementation.defaultValue === undefined || !Number.isSafeInteger(maxItems) || maxItems < 0 || maxItems > MAX_ARRAY_ITEMS) return fail('CONFIG_INVALID');
        return register({ kind: 'array', item: implementation, defaultValue: options.default ?? [], maxItems,
            parse: implementation.parse, accepts: () => false, encode: implementation.encode });
    },
    optional<T extends UrlValue>(codec: UrlCodec<T>): UrlCodec<T | undefined> {
        return register({ ...getCodec(codec), defaultValue: undefined });
    },
    /** Synchronous, application-owned codecs. Undefined means invalid input. */
    custom<T extends UrlScalar>(options: { default: T; parse(raw: string): T | undefined; serialize(value: NoInfer<T>): string }): UrlCodec<T> {
        const { default: defaultValue, parse, serialize } = options;
        if (!scalar(defaultValue) || typeof parse !== 'function' || typeof serialize !== 'function') return fail('CONFIG_INVALID');
        const kind = typeof defaultValue;
        const valid = (value: unknown) => scalar(value) && typeof value === kind;
        return register({ kind: 'scalar', defaultValue, accepts: valid,
            parse(raw) { const value = parse(raw); return value === undefined || valid(value) ? value : rejectCallbackValue(value); },
            encode(value) { const encoded = serialize(value as T); return typeof encoded === 'string' && scalar(encoded) ? encoded : rejectCallbackValue(encoded); } });
    },
});

type Pair = { key: string; value: string | null; invalid: boolean; raw?: string };
function asUrl(value: string | URL): URL {
    try {
        if (typeof value !== 'string' && !(value instanceof URL)) return fail('URL_INVALID');
        return new URL(typeof value === 'string' ? value : URL.prototype.toString.call(value), 'https://cossack.invalid');
    } catch { return fail('URL_INVALID'); }
}
function decode(raw: string): string { return decodeURIComponent(raw.replace(/\+/g, ' ')); }
function pairs(target: URL): Pair[] {
    if (target.search.length > MAX_QUERY_LENGTH + 1) return fail('LIMIT');
    const parts = target.search.slice(1).split('&').filter(Boolean);
    if (parts.length > MAX_PAIRS) return fail('LIMIT');
    return parts.map((part): Pair => {
        const equals = part.indexOf('=');
        let key: string;
        try { key = decode(equals < 0 ? part : part.slice(0, equals)); }
        catch { return { key: '', value: null, invalid: true, raw: part }; }
        try { return { key, value: equals < 0 ? null : decode(part.slice(equals + 1)), invalid: false, raw: part }; }
        catch { return { key, value: null, invalid: true, raw: part }; }
    });
}
function ownData(value: object): Record<string, PropertyDescriptor> {
    if (!value || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length) return fail('DECLARATION_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) return fail('DECLARATION_INVALID');
    return descriptors;
}
function equal(a: UrlValue, b: UrlValue): boolean {
    return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value, i) => Object.is(value, b[i])) : Object.is(a, b);
}

export function defineUrlState<const S extends Record<string, UrlCodec<UrlValue>>>(shape: S): UrlStateDefinition<S> {
    const descriptors = ownData(shape);
    const keys = Object.keys(descriptors).sort();
    if (!keys.length || keys.length > MAX_FIELDS || keys.some(key => !key || key.length > 128 || !scalar(key))) return fail('DECLARATION_INVALID');
    const fields = new Map(keys.map(key => [key, getCodec(descriptors[key]!.value)]));
    const read = (target: URL): UrlStateRead<UrlStateValues<S>> => {
        const all = pairs(target);
        const values: Record<string, UrlValue> = {};
        const issues: UrlStateIssue[] = [];
        for (const [key, codec] of fields) {
            const entries = all.filter(pair => pair.key === key);
            let value: UrlValue = codec.defaultValue;
            let issue: UrlStateIssueCode | undefined;
            if (entries.some(entry => entry.invalid)) issue = 'invalid-encoding';
            else if (codec.kind === 'scalar' && entries.length > 1) issue = 'repeated-scalar';
            else if (entries.length) {
                try {
                    if (codec.kind === 'array' && entries.length > codec.maxItems! && !(entries.length === 1 && entries[0]!.value === null)) {
                        issue = 'invalid-value';
                    } else if (codec.kind === 'array') {
                        const decoded = entries.length === 1 && entries[0]!.value === null ? []
                            : entries.map(entry => entry.value === null ? undefined : codec.item!.parse(entry.value));
                        if (accepts(codec, decoded)) value = snapshot(decoded as readonly UrlScalar[]);
                        else issue = 'invalid-value';
                    } else {
                        const decoded = codec.parse(entries[0]!.value ?? '');
                        if (decoded !== undefined && accepts(codec, decoded)) value = decoded;
                        else issue = 'invalid-value';
                    }
                } catch { return fail('CODEC_FAILED', key); }
            }
            if (issue) issues.push(Object.freeze({ field: key, code: issue }));
            Object.defineProperty(values, key, { value, enumerable: true });
        }
        return Object.freeze({ values: Object.freeze(values) as UrlStateValues<S>, issues: Object.freeze(issues) });
    };
    return Object.freeze({ keys: Object.freeze(keys) as readonly (keyof S & string)[],
        read: (value: string | URL) => read(asUrl(value)),
        url(current: string | URL, patch: object, options: { defaults?: 'omit' | 'include' } = {}) {
            if (options.defaults !== undefined && options.defaults !== 'omit' && options.defaults !== 'include') return fail('CONFIG_INVALID');
            const target = asUrl(current);
            const previous = read(target).values as Record<string, UrlValue>;
            const changes = ownData(patch);
            for (const key of Object.keys(changes)) if (!fields.has(key)) return fail('FIELD_UNKNOWN', key);
            const result = pairs(target).filter(pair => !fields.has(pair.key));
            for (const [key, codec] of fields) {
                const requested = changes[key]?.value;
                const value = Object.hasOwn(changes, key) ? requested === undefined ? codec.defaultValue : requested : previous[key];
                if (!accepts(codec, value)) return fail('VALUE_INVALID', key);
                if (value === undefined || options.defaults !== 'include' && equal(value, codec.defaultValue)) continue;
                const copy = snapshot(value);
                if (codec.kind === 'array' && (copy as readonly UrlScalar[]).length === 0) result.push({ key, value: null, invalid: false });
                else for (const item of codec.kind === 'array' ? copy as readonly UrlScalar[] : [copy as UrlScalar]) {
                    try {
                        const encoded = codec.encode(item);
                        if (!scalar(encoded) || typeof encoded !== 'string' || codec.parse(encoded) !== item) return fail('CODEC_INVALID', key);
                        result.push({ key, value: encoded, invalid: false });
                    } catch { return fail('CODEC_FAILED', key); }
                }
            }
            const query = result.map(pair => {
                if (pair.raw !== undefined) return pair.raw;
                const encoded = new URLSearchParams([[pair.key, pair.value ?? '']]).toString();
                return pair.value === null ? encoded.slice(0, -1) : encoded;
            }).join('&');
            if (query.length > MAX_QUERY_LENGTH || result.length > MAX_PAIRS) return fail('LIMIT');
            return target.pathname + (query ? `?${query}` : '') + target.hash;
        },
    });
}
