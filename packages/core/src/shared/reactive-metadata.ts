import './metadata';
import type { StateOptions, StoreOptions } from './decorators';

/** One inherited field contract, with child declarations replacing the field kind. */
export function collectReactiveMetadata(constructor: unknown) {
    const fields = new Map<string, { kind: string; options: StateOptions | StoreOptions }>();
    const chain: Function[] = [];
    for (let current = typeof constructor === 'function' ? constructor : undefined; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) chain.unshift(current);
    for (const current of chain) {
        for (const kind of ['state', 'store', 'client-state', 'client-store']) {
            const own = Reflect.getOwnMetadata(`cossack:${kind}`, current);
            if (kind.startsWith('client-')) {
                for (const key of own ?? []) if (typeof key === 'string') fields.set(key, { kind, options: {} });
            } else {
                for (const key of Object.keys(own ?? {})) fields.set(key, { kind, options: own[key] });
            }
        }
    }
    const state: Record<string, StateOptions> = Object.create(null);
    const store: Record<string, StoreOptions> = Object.create(null);
    const clientState = new Set<string>();
    const clientStore = new Set<string>();
    for (const [key, field] of fields) {
        if (field.kind === 'state') state[key] = field.options;
        else if (field.kind === 'store') store[key] = field.options;
        else if (field.kind === 'client-state') clientState.add(key);
        else clientStore.add(key);
    }
    return { state, store, clientState, clientStore };
}
