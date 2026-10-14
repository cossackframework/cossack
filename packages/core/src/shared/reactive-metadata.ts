import './metadata';
import type { StateOptions, StoreOptions, TaskRegistration } from './decorators';

/**
 * Reactive field declarations of one class, merged across inheritance.
 * Shared by every instance of the class: callers must not mutate it.
 */
export interface ReactiveMetadata {
    readonly state: Readonly<Record<string, StateOptions>>;
    readonly store: Readonly<Record<string, StoreOptions>>;
    readonly clientState: ReadonlySet<string>;
    readonly clientStore: ReadonlySet<string>;
    /** Every reactive field name: @State, @ClientState, @Store, then @ClientStore. */
    readonly keys: readonly string[];
}

/** Task declarations of one class, merged across inheritance, per side. */
interface TaskMetadata {
    readonly server: readonly TaskRegistration[];
    readonly client: readonly TaskRegistration[];
}

// Decorators write metadata when the class is defined, before any instance
// exists, so the merged view is computed once per constructor. A WeakMap
// (not a static field) keeps a subclass from reading its parent's entry.
const reactiveCache = new WeakMap<Function, ReactiveMetadata>();
const taskCache = new WeakMap<Function, TaskMetadata>();

const emptyReactive: ReactiveMetadata = Object.freeze({
    state: Object.freeze(Object.create(null)), store: Object.freeze(Object.create(null)),
    clientState: new Set<string>(), clientStore: new Set<string>(), keys: Object.freeze([]),
});

/** One inherited field contract, with child declarations replacing the field kind. */
export function collectReactiveMetadata(constructor: unknown): ReactiveMetadata {
    if (typeof constructor !== 'function') return emptyReactive;
    let metadata = reactiveCache.get(constructor);
    if (!metadata) {
        metadata = buildReactiveMetadata(constructor);
        reactiveCache.set(constructor, metadata);
    }
    return metadata;
}

function buildReactiveMetadata(constructor: Function): ReactiveMetadata {
    const fields = new Map<string, { kind: string; options: StateOptions | StoreOptions }>();
    const chain: Function[] = [];
    for (let current: Function | undefined = constructor; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) chain.unshift(current);
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
    return Object.freeze({ state: Object.freeze(state), store: Object.freeze(store), clientState, clientStore,
        keys: Object.freeze([...Object.keys(state), ...clientState, ...Object.keys(store), ...clientStore]) });
}

/**
 * The tasks that run on one side: `@Task` everywhere, `@ServerTask` on the
 * server, `@ClientTask` in the browser. A child declaration replaces the same
 * method's kind/track contract without dropping its siblings.
 */
export function collectTaskRegistrations(constructor: Function, isServer: boolean): readonly TaskRegistration[] {
    let metadata = taskCache.get(constructor);
    if (!metadata) {
        metadata = buildTaskMetadata(constructor);
        taskCache.set(constructor, metadata);
    }
    return isServer ? metadata.server : metadata.client;
}

function buildTaskMetadata(constructor: Function): TaskMetadata {
    const constructors: Function[] = [];
    for (let current: Function | undefined = constructor; current; current = Object.getPrototypeOf(current)) constructors.unshift(current);
    const registrations = new Map<string | symbol, TaskRegistration & { kind: string }>();
    for (const current of constructors) {
        for (const kind of ['tasks', 'server-tasks', 'client-tasks']) {
            for (const entry of (Reflect.getOwnMetadata(`cossack:${kind}`, current) || []) as TaskRegistration[]) {
                registrations.set(entry.propertyKey, { propertyKey: entry.propertyKey, track: entry.track, kind });
            }
        }
    }
    const side = (kind: string) => Object.freeze([...registrations.values()]
        .filter(entry => entry.kind === 'tasks' || entry.kind === kind)
        .map(({ propertyKey, track }) => Object.freeze({ propertyKey, track })));
    return { server: side('server-tasks'), client: side('client-tasks') };
}
