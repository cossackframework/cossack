import { ActionValidationError } from './errors';
import { validateValue, type ValidationRule } from './validation';

const BRAND = Symbol.for('cossack:input-schema:v1');
const INVALID = Symbol('invalid-input');
const FIELD = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
const MAX_ITEMS = 1024;
const MAX_NODES = 4096;
const MAX_DEPTH = 32;
const MAX_ERRORS = 128;
const RULE_KEYS = ['required', 'minLength', 'maxLength', 'min', 'max', 'pattern', 'email', 'url', 'message'];

type Rules = Omit<ValidationRule, 'coerce' | 'custom' | 'customAsync'>;
export interface InputParseOptions { signal?: AbortSignal; }
/** Raw input matches Output unless a coercing or transforming schema declares another type. */
export interface InputSchema<Output = unknown, Raw = Output> {
    readonly [BRAND]: true;
    /** Type-only incoming shape; not a runtime value. */
    readonly _raw?: Raw;
    parse(value: unknown, options?: InputParseOptions): Promise<Output>;
    optional(): InputSchema<Output | undefined, Raw | undefined>;
    nullable(): InputSchema<Output | null, Raw | null>;
    refine(check: (value: Output, options: InputParseOptions) => boolean | Promise<boolean>, message?: string): InputSchema<Output, Raw>;
}
export type InputOf<S extends InputSchema<any, any>> = S extends InputSchema<infer T, any> ? T : never;
export type RawInputOf<S extends InputSchema<any, any>> = S extends InputSchema<any, infer T> ? T : never;
type Shape = Record<string, InputSchema<any, any>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends InputOf<S[K]> ? K : never }[keyof S];
type ObjectOutput<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: InputOf<S[K]> }
    & { [K in OptionalKeys<S>]?: Exclude<InputOf<S[K]>, undefined> };
type ObjectRaw<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: RawInputOf<S[K]> }
    & { [K in OptionalKeys<S>]?: Exclude<RawInputOf<S[K]>, undefined> };
interface State { nodes: number; errors: number; fields: Record<string, unknown>; ancestors: Set<object>; signal?: AbortSignal; }
type Path = string[];
type Reader = (value: unknown, state: State, path: Path, depth: number) => Promise<unknown>;
const readers = new WeakMap<object, Reader>();

function fieldName(value: string): boolean {
    return FIELD.test(value) && !['_', '__proto__', 'prototype', 'constructor'].includes(value);
}
function configuration(): never { throw new Error('[Cossack] Invalid input schema configuration.'); }
function optionsRecord(raw: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) configuration();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(raw)) {
        const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
        if (typeof key !== 'string' || !keys.includes(key) || !('value' in descriptor)) configuration();
        result[key] = descriptor.value;
    }
    return result;
}
function cancelled(state: State): void {
    if (state.signal?.aborted) throw new DOMException('Input validation was cancelled.', 'AbortError');
}
/** Stop owning a validator on abort; observe its eventual rejection as well. */
async function refinement(check: () => boolean | Promise<boolean>, state: State): Promise<boolean> {
    cancelled(state);
    if (!state.signal) return await check();
    const signal = state.signal;
    let abort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new DOMException('Input validation was cancelled.', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
    try { return await Promise.race([Promise.resolve().then(() => { cancelled(state); return check(); }), interrupted]); }
    finally { signal.removeEventListener('abort', abort); }
}
function error(state: State, path: Path, message: string): typeof INVALID {
    if (++state.errors <= MAX_ERRORS) {
        let target = state.fields;
        for (const part of path) {
            const existing = target[part];
            if (!existing || typeof existing !== 'object') target[part] = Object.create(null);
            target = target[part] as Record<string, unknown>;
        }
        target._ = message;
    }
    return INVALID;
}
/** Leaf messages use field keys; container/root errors use the reserved `_` slot. */
function compactErrors(tree: Record<string, unknown>): Record<string, unknown> {
    for (const key of Object.keys(tree)) {
        const value = tree[key];
        if (value && typeof value === 'object') {
            const child = compactErrors(value as Record<string, unknown>);
            tree[key] = Object.keys(child).length === 1 && typeof child._ === 'string' ? child._ : child;
        }
    }
    return tree;
}
function schema<T, R = T>(reader: Reader): InputSchema<T, R> {
    const result: InputSchema<T, R> = {
        [BRAND]: true,
        async parse(value, options = {}) {
            const state: State = { nodes: 0, errors: 0, fields: Object.create(null), ancestors: new Set(), signal: options.signal };
            const output = await visit(result, value, state, [], 0);
            if (state.errors) throw new ActionValidationError(compactErrors(state.fields));
            return output as T;
        },
        optional() { return schema<T | undefined, R | undefined>((value, state, path, depth) =>
            value === undefined ? Promise.resolve(undefined) : reader(value, state, path, depth)); },
        nullable() { return schema<T | null, R | null>((value, state, path, depth) =>
            value === null ? Promise.resolve(null) : reader(value, state, path, depth)); },
        refine(check, message = 'Invalid value.') {
            if (typeof check !== 'function' || typeof message !== 'string' || !message || message.length > 1024) configuration();
            return schema<T, R>(async (value, state, path, depth) => {
                const before = state.errors;
                const output = await reader(value, state, path, depth);
                if (state.errors !== before) return INVALID;
                cancelled(state);
                // Exceptions are application failures, not expected field errors.
                let accepted:boolean;
                try { accepted = await refinement(() => check(output as T, { signal: state.signal }), state); }
                catch (cause) {
                    cancelled(state);
                    // A callback cannot turn an internal validator failure into
                    // a public RPC/HTTP exception by choosing its error class.
                    throw new Error('[Cossack] Input refinement failed.', {cause});
                }
                cancelled(state);
                if (typeof accepted !== 'boolean') throw new Error('[Cossack] Input refinement must return a boolean.');
                return accepted ? output : error(state, path, message);
            });
        },
    };
    readers.set(result, reader);
    return Object.freeze(result);
}
async function visit(node: InputSchema<any, any>, value: unknown, state: State, path: Path, depth: number): Promise<unknown> {
    cancelled(state);
    if (++state.nodes > MAX_NODES || depth > MAX_DEPTH || state.errors >= MAX_ERRORS) return error(state, path, 'Input exceeds validation limits.');
    const reader = readers.get(node);
    if (!reader) configuration();
    const output = await reader(value, state, path, depth);
    cancelled(state);
    return output;
}
function rulesSnapshot(value: Rules = {}): Rules {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) configuration();
    const allowed = RULE_KEYS;
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptor)) configuration();
        const entry = descriptor.value;
        if (entry === undefined) continue;
        if (['minLength', 'maxLength'].includes(key) && (!Number.isSafeInteger(entry) || entry < 0)
            || ['min', 'max'].includes(key) && (typeof entry !== 'number' || !Number.isFinite(entry))
            || ['required', 'email', 'url'].includes(key) && typeof entry !== 'boolean'
            || key === 'pattern' && !(entry instanceof RegExp)
            || key === 'message' && (typeof entry !== 'string' || !entry || entry.length > 1024)) configuration();
        copy[key] = entry instanceof RegExp ? new RegExp(entry.source, entry.flags) : entry;
    }
    if (typeof copy.min === 'number' && typeof copy.max === 'number' && copy.min > copy.max
        || typeof copy.minLength === 'number' && typeof copy.maxLength === 'number' && copy.minLength > copy.maxLength) configuration();
    return Object.freeze(copy) as Rules;
}
function checked(value: unknown, rules: Rules, state: State, path: Path): unknown {
    if (rules.pattern) rules.pattern.lastIndex = 0;
    const result = validateValue(value, rules, { empty: 'validate' });
    return result.valid ? value : error(state, path, result.message ?? 'Invalid value.');
}
function enter(value: unknown, state: State, path: Path, array: boolean): boolean {
    if (!value || typeof value !== 'object' || (array ? !Array.isArray(value) : Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
        error(state, path, array ? 'Expected an array.' : 'Expected an object.'); return false;
    }
    if (state.ancestors.has(value)) { error(state, path, 'Cyclic input is not supported.'); return false; }
    state.ancestors.add(value); return true;
}
export function isInputSchema(value: unknown): value is InputSchema<any, any> {
    return !!value && typeof value === 'object' && (value as InputSchema)[BRAND] === true && typeof (value as InputSchema).parse === 'function';
}

/** Explicit server input grammar. Use InputOf<typeof schema> on the method parameter. */
export const input = Object.freeze({
    string(options: Rules = {}): InputSchema<string> {
        const rules = rulesSnapshot(options);
        return schema(async (value, state, path) => typeof value === 'string' ? checked(value, rules, state, path) : error(state, path, 'Expected a string.'));
    },
    number<const C extends boolean = false>(options: Rules & { coerce?: C; integer?: boolean } = {}): InputSchema<number, C extends true ? number | string : number> {
        const { coerce = false, integer = false, ...rest } = optionsRecord(options, [...RULE_KEYS, 'coerce', 'integer']);
        if (typeof coerce !== 'boolean' || typeof integer !== 'boolean') configuration();
        const rules = rulesSnapshot(rest);
        return schema(async (value, state, path) => {
            if (coerce && typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) value = Number(value);
            if (typeof value !== 'number' || !Number.isFinite(value) || integer && !Number.isSafeInteger(value)) return error(state, path, integer ? 'Expected a safe integer.' : 'Expected a finite number.');
            return checked(value, rules, state, path);
        });
    },
    boolean<const C extends boolean = false>(options: { coerce?: C } = {}): InputSchema<boolean, C extends true ? boolean | string : boolean> {
        options = optionsRecord(options, ['coerce']) as typeof options;
        if (Object.keys(options).some(key => key !== 'coerce') || options.coerce !== undefined && typeof options.coerce !== 'boolean') configuration();
        const coerce = options.coerce ?? false;
        return schema(async (value, state, path) => {
            if (coerce && typeof value === 'string') {
                const normalized = value.trim().toLowerCase();
                if (['true', '1', 'on', 'yes'].includes(normalized)) value = true;
                else if (['false', '0', 'off', 'no'].includes(normalized)) value = false;
            }
            return typeof value === 'boolean' ? value : error(state, path, 'Expected a boolean.');
        });
    },
    literal<const T extends string | number | boolean | null>(value: T): InputSchema<T> {
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) configuration();
        return schema(async (candidate, state, path) => candidate === value ? candidate : error(state, path, 'Unexpected value.'));
    },
    enum<const Values extends readonly [string, ...string[]]>(values: Values): InputSchema<Values[number]> {
        if (!Array.isArray(values) || !values.length || values.length > 128) configuration();
        const choices = Array.from({length:values.length}, (_, index) => values[index]);
        if (choices.some(value => typeof value !== 'string' || !value || value.length > 1024)) configuration();
        return schema(async (candidate, state, path) => typeof candidate === 'string' && choices.includes(candidate)
            ? candidate : error(state, path, 'Unexpected value.'));
    },
    date<const C extends boolean = false>(options: { coerce?: C } = {}): InputSchema<Date, C extends true ? Date | string : Date> {
        options = optionsRecord(options, ['coerce']) as typeof options;
        if (options.coerce !== undefined && typeof options.coerce !== 'boolean') configuration();
        const coerce = options.coerce ?? false;
        return schema(async (value, state, path) => {
            if (coerce && typeof value === 'string' && value.length <= 32) {
                const candidate = new Date(value);
                // Canonical UTC ISO strings avoid timezone and calendar normalization.
                if (Number.isFinite(candidate.getTime()) && candidate.toISOString() === value) value = candidate;
            }
            return value instanceof Date && Number.isFinite(value.getTime()) ? new Date(value.getTime())
                : error(state, path, 'Expected a valid date.');
        });
    },
    object<const S extends Shape>(shape: S, options: { unknownKeys?: 'reject' | 'strip' } = {}): InputSchema<ObjectOutput<S>, ObjectRaw<S>> {
        options = optionsRecord(options, ['unknownKeys']) as typeof options;
        if (!shape || typeof shape !== 'object' || Array.isArray(shape) || ![Object.prototype, null].includes(Object.getPrototypeOf(shape))
            || Object.keys(options).some(key => key !== 'unknownKeys') || !['reject', 'strip'].includes(options.unknownKeys === undefined ? 'reject' : options.unknownKeys)) configuration();
        const policy = options.unknownKeys === undefined ? 'reject' : options.unknownKeys;
        const fields = Reflect.ownKeys(shape).map(key => {
            if (typeof key !== 'string') configuration();
            const descriptor = Object.getOwnPropertyDescriptor(shape, key)!;
            if (!fieldName(key) || !('value' in descriptor) || !readers.has(descriptor.value)) configuration();
            return [key, descriptor.value] as const;
        });
        if (fields.length > MAX_ITEMS) configuration();
        const known = new Set(fields.map(([key]) => key));
        return schema(async (value, state, path, depth) => {
            if (!enter(value, state, path, false)) return INVALID;
            try {
                const keys = Reflect.ownKeys(value as object);
                if (keys.length > MAX_ITEMS) return error(state, path, 'Object exceeds field limit.');
                for (const key of keys) {
                    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
                    if (!('value' in descriptor)) { error(state, path, 'Input accessors are not supported.'); continue; }
                    if (policy === 'reject' && (typeof key !== 'string' || !known.has(key))) {
                        error(state, typeof key === 'string' && fieldName(key) ? [...path, key] : path, 'Unknown field.');
                    }
                }
                const output = Object.create(null);
                for (const [key, node] of fields) {
                    const descriptor = Object.getOwnPropertyDescriptor(value, key);
                    if (descriptor && !('value' in descriptor)) continue;
                    const parsed = await visit(node, descriptor?.value, state, [...path, key], depth + 1);
                    if (parsed !== undefined && parsed !== INVALID) output[key] = parsed;
                }
                return output;
            } finally { state.ancestors.delete(value as object); }
        });
    },
    array<S extends InputSchema<any, any>>(item: S, options: { minItems?: number; maxItems?: number } = {}): InputSchema<InputOf<S>[], RawInputOf<S>[]> {
        options = optionsRecord(options, ['minItems', 'maxItems']) as typeof options;
        const min = options.minItems === undefined ? 0 : options.minItems, max = options.maxItems === undefined ? MAX_ITEMS : options.maxItems;
        if (!readers.has(item) || Object.keys(options).some(key => !['minItems', 'maxItems'].includes(key))
            || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min || max > MAX_ITEMS) configuration();
        return schema(async (value, state, path, depth) => {
            if (!enter(value, state, path, true)) return INVALID;
            try {
                const values = value as unknown[];
                if (values.length < min || values.length > max) return error(state, path, 'Array length is outside its limits.');
                if (Reflect.ownKeys(values).some(key => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= values.length))) return error(state, path, 'Unexpected array properties.');
                const output = [];
                for (let index = 0; index < values.length; index++) {
                    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
                    if (!descriptor || !('value' in descriptor)) { error(state, [...path, String(index)], 'Expected an array item.'); continue; }
                    output.push(await visit(item, descriptor.value, state, [...path, String(index)], depth + 1));
                }
                return output;
            } finally { state.ancestors.delete(value as object); }
        });
    },
    file(options: { maxBytes?: number; mediaTypes?: readonly string[] } = {}): InputSchema<File> {
        options = optionsRecord(options, ['maxBytes', 'mediaTypes']) as typeof options;
        const max = options.maxBytes;
        if (Object.keys(options).some(key => !['maxBytes', 'mediaTypes'].includes(key)) || max !== undefined && (!Number.isSafeInteger(max) || max < 0)
            || options.mediaTypes !== undefined && (!Array.isArray(options.mediaTypes) || options.mediaTypes.length > 128 || options.mediaTypes.some(type => typeof type !== 'string' || !type || type.length > 128))) configuration();
        const types = options.mediaTypes && [...options.mediaTypes];
        return schema(async (value, state, path) => {
            if (typeof File === 'undefined' || !(value instanceof File)) return error(state, path, 'Expected an uploaded file.');
            if (max !== undefined && value.size > max) return error(state, path, 'File exceeds its size limit.');
            if (types && !types.includes(value.type)) return error(state, path, 'File media type is not allowed.');
            return value;
        });
    },
});
