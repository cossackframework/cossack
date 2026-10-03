import { isPlainObjectOrArray } from './store';

/**
 * Snapshot browser draft data without JSON serialization or executing getters.
 * Plain records/arrays get new ownership. Native and authored class instances
 * remain opaque references, matching the store proxy's supported data shapes.
 */
export function snapshotNavigationDraft(values: Map<string, unknown>): Map<string, unknown> {
    const seen = new WeakMap<object, object>();
    const copy = (value: unknown, field: string): unknown => {
        if (value === null || typeof value !== 'object' ||
            (!isPlainObjectOrArray(value) && Object.getPrototypeOf(value) !== null)) return value;
        const existing = seen.get(value);
        if (existing) return existing;
        const result = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
        seen.set(value, result);
        for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (!('value' in descriptor)) {
                throw Object.assign(new Error(
                    `[Cossack] Cannot transfer navigation draft "${field}": accessor "${String(key)}" is not stored data. ` +
                    'Use data properties for the draft and keep computed getters on the component.',
                ), { code: 'COSSACK_NAVIGATION_DRAFT_ACCESSOR', field });
            }
            Object.defineProperty(result, key, { ...descriptor, value: copy(descriptor.value, field) });
        }
        if (!Object.isExtensible(value)) Object.preventExtensions(result);
        return result;
    };
    return new Map([...values].map(([field, value]) => [field, copy(value, field)]));
}
