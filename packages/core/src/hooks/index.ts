/**
 * Typed local extension points: actions notify, filters transform a value.
 *
 * - An explicit registry instance. No global state, sandbox or RPC.
 * - Deterministic order: priority (lower first), then plugin name, then registration order.
 * - Each handler call gets a fresh frozen context with a signal and a deadline.
 * - Payloads and filter inputs are frozen copies; a filter returns its next value.
 * - Filters stop at the first error. Actions run every handler and report each outcome.
 */

export type HookKind = 'action' | 'filter';

/** A named, versioned extension point. Create with {@link defineAction} or {@link defineFilter}. */
export interface ExtensionPoint<Kind extends HookKind = HookKind, Value = unknown, Input = unknown> {
    readonly kind: Kind;
    readonly name: string;
    /** Incremented for incompatible payload or value changes. */
    readonly version: number;
    /** Default per-handler deadline in milliseconds. */
    readonly timeoutMs: number;
    /** Phantom types; never set at runtime. */
    readonly __value?: Value;
    readonly __input?: Input;
}

export type ActionPoint<Payload> = ExtensionPoint<'action', Payload, Payload>;
export type FilterPoint<Value, Input = undefined> = ExtensionPoint<'filter', Value, Input>;

export interface HookContext {
    readonly point: string;
    readonly version: number;
    /** Plugin that registered the handler being called. */
    readonly plugin: string;
    /** Aborts on caller cancellation or when the deadline passes. */
    readonly signal: AbortSignal;
    /** Unix milliseconds by which this handler must finish. */
    readonly deadline: number;
}

export interface FilterContext<Input> extends HookContext {
    /** Frozen, read-only input that accompanies the value. */
    readonly input: Input;
}

export type ActionHandler<Payload> = (payload: Payload, context: HookContext) => void | Promise<void>;
export type FilterHandler<Value, Input> = (value: Value, context: FilterContext<Input>) => Value | Promise<Value>;

export interface HandlerOptions {
    /** Owner of the handler, such as a plugin name. */
    plugin: string;
    /** Lower runs first. Default 10. */
    priority?: number;
    /** Extension point version the handler was written for. Defaults to the point's version. */
    version?: number;
}

export interface InvokeOptions {
    signal?: AbortSignal;
    /** Per-handler deadline. Defaults to the point's `timeoutMs`. */
    timeoutMs?: number;
    /** Run only the handlers of these plugins, for example to retry failed deliveries. */
    only?: readonly string[];
    now?: () => number;
}

export type HookErrorCode = 'COSSACK_HOOK_FAILED' | 'COSSACK_HOOK_TIMEOUT' | 'COSSACK_HOOK_CANCELLED' | 'COSSACK_HOOK_INVALID';

export class HookError extends Error {
    readonly code: HookErrorCode;
    readonly point: string;
    readonly plugin: string;
    readonly cause: unknown;
    constructor(code: HookErrorCode, point: string, plugin: string, cause?: unknown) {
        super(code === 'COSSACK_HOOK_TIMEOUT' ? `${plugin} did not finish ${point} before its deadline.`
            : code === 'COSSACK_HOOK_CANCELLED' ? `${point} was cancelled before ${plugin} finished.`
                : code === 'COSSACK_HOOK_INVALID' ? `${plugin} registered an incompatible ${point} handler.`
                    : `${plugin} failed in ${point}.`);
        this.name = 'HookError';
        this.code = code;
        this.point = point;
        this.plugin = plugin;
        this.cause = cause;
    }
}

export interface ActionOutcome {
    readonly plugin: string;
    readonly status: 'ok' | 'failed' | 'timeout' | 'cancelled';
    readonly error?: HookError;
}

export interface ActionReport {
    readonly ok: boolean;
    readonly outcomes: readonly ActionOutcome[];
    /** Plugins whose handler did not succeed; pass them as `only` to retry. */
    readonly failed: readonly string[];
}

export interface RegisteredHandler {
    readonly point: string;
    readonly kind: HookKind;
    readonly plugin: string;
    readonly priority: number;
    readonly sequence: number;
}

const NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const PLUGIN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function defineAction<Payload>(name: string, options: { version?: number; timeoutMs?: number } = {}): ActionPoint<Payload> {
    return definePoint('action', name, options) as ActionPoint<Payload>;
}

export function defineFilter<Value, Input = undefined>(name: string, options: { version?: number; timeoutMs?: number } = {}): FilterPoint<Value, Input> {
    return definePoint('filter', name, options) as FilterPoint<Value, Input>;
}

function definePoint(kind: HookKind, name: string, options: { version?: number; timeoutMs?: number }): ExtensionPoint {
    if (!NAME.test(name)) throw new TypeError(`Invalid extension point name: ${name}`);
    const version = options.version ?? 1;
    const timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Extension point version must be a positive integer');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new RangeError('Extension point timeoutMs must be 1..600000');
    return Object.freeze({ kind, name, version, timeoutMs });
}

interface Entry {
    point: ExtensionPoint;
    plugin: string;
    priority: number;
    sequence: number;
    handler: (value: unknown, context: HookContext) => unknown;
}

export class HookRegistry {
    readonly #entries = new Map<string, Entry[]>();
    readonly #points = new Map<string, ExtensionPoint>();
    #sequence = 0;
    #frozen = false;

    addAction<Payload>(point: ActionPoint<Payload>, handler: ActionHandler<Payload>, options: HandlerOptions): () => void {
        return this.#add(point, handler as Entry['handler'], options, 'action');
    }

    addFilter<Value, Input>(point: FilterPoint<Value, Input>, handler: FilterHandler<Value, Input>, options: HandlerOptions): () => void {
        return this.#add(point, handler as Entry['handler'], options, 'filter');
    }

    /** Stop accepting registrations, for example after boot. */
    freeze(): this {
        this.#frozen = true;
        return this;
    }

    get frozen(): boolean { return this.#frozen; }

    /** Registered handlers in invocation order, for inspection. */
    handlers(point?: ExtensionPoint): readonly RegisteredHandler[] {
        const lists = point ? [this.#entries.get(point.name) ?? []] : [...this.#entries.values()];
        return lists.flat().map(entry => Object.freeze({ point: entry.point.name, kind: entry.point.kind, plugin: entry.plugin, priority: entry.priority, sequence: entry.sequence }));
    }

    /** Run every action handler in order. Each outcome is reported; none stops the others. */
    async doAction<Payload>(point: ActionPoint<Payload>, payload: Payload, options: InvokeOptions = {}): Promise<ActionReport> {
        const frozen = snapshot(payload);
        const outcomes: ActionOutcome[] = [];
        for (const entry of this.#select(point, options)) {
            if (options.signal?.aborted) {
                outcomes.push({ plugin: entry.plugin, status: 'cancelled', error: new HookError('COSSACK_HOOK_CANCELLED', point.name, entry.plugin, options.signal.reason) });
                continue;
            }
            try {
                await invoke(entry, frozen, undefined, point, options);
                outcomes.push({ plugin: entry.plugin, status: 'ok' });
            } catch (error) {
                const hookError = error as HookError;
                outcomes.push({ plugin: entry.plugin, status: hookError.code === 'COSSACK_HOOK_TIMEOUT' ? 'timeout' : hookError.code === 'COSSACK_HOOK_CANCELLED' ? 'cancelled' : 'failed', error: hookError });
            }
        }
        const failed = outcomes.filter(outcome => outcome.status !== 'ok').map(outcome => outcome.plugin);
        return Object.freeze({ ok: failed.length === 0, outcomes: Object.freeze(outcomes), failed: Object.freeze(failed) });
    }

    /** Pass the value through each filter in order. The first error rejects with a {@link HookError}. */
    async applyFilters<Value, Input>(point: FilterPoint<Value, Input>, value: Value, ...[input, options]: Input extends undefined ? [input?: Input, options?: InvokeOptions] : [input: Input, options?: InvokeOptions]): Promise<Value> {
        const frozenInput = snapshot(input);
        let current = value;
        for (const entry of this.#select(point, options ?? {})) {
            if (options?.signal?.aborted) throw new HookError('COSSACK_HOOK_CANCELLED', point.name, entry.plugin, options.signal.reason);
            const next = await invoke(entry, snapshot(current), frozenInput, point, options ?? {}) as Value;
            if (next === undefined && current !== undefined) throw new HookError('COSSACK_HOOK_FAILED', point.name, entry.plugin, new TypeError('A filter must return the next value.'));
            current = next;
        }
        return current;
    }

    #add(point: ExtensionPoint, handler: Entry['handler'], options: HandlerOptions, kind: HookKind): () => void {
        if (this.#frozen) throw new Error('The hook registry is frozen; register handlers during boot.');
        if (point?.kind !== kind || typeof handler !== 'function') throw new TypeError(`Register ${kind} handlers with a ${kind} extension point.`);
        if (!PLUGIN.test(options?.plugin ?? '')) throw new TypeError('Handlers require a plugin name');
        const known = this.#points.get(point.name);
        if (known && (known.kind !== point.kind || known.version !== point.version)) throw new HookError('COSSACK_HOOK_INVALID', point.name, options.plugin);
        if ((options.version ?? point.version) !== point.version) throw new HookError('COSSACK_HOOK_INVALID', point.name, options.plugin);
        const priority = options.priority ?? 10;
        if (!Number.isSafeInteger(priority)) throw new RangeError('Handler priority must be an integer');
        this.#points.set(point.name, point);
        const entry: Entry = { point, plugin: options.plugin, priority, sequence: this.#sequence++, handler };
        const list = [...(this.#entries.get(point.name) ?? []), entry].sort(compare);
        this.#entries.set(point.name, list);
        return () => {
            if (this.#frozen) throw new Error('The hook registry is frozen.');
            this.#entries.set(point.name, (this.#entries.get(point.name) ?? []).filter(item => item !== entry));
        };
    }

    #select(point: ExtensionPoint, options: InvokeOptions): Entry[] {
        const known = this.#points.get(point.name);
        if (known && (known.kind !== point.kind || known.version !== point.version)) throw new HookError('COSSACK_HOOK_INVALID', point.name, 'host');
        const entries = this.#entries.get(point.name) ?? [];
        return options.only ? entries.filter(entry => options.only!.includes(entry.plugin)) : entries;
    }
}

export function createHookRegistry(): HookRegistry {
    return new HookRegistry();
}

function compare(a: Entry, b: Entry): number {
    return a.priority - b.priority || (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0) || a.sequence - b.sequence;
}

async function invoke(entry: Entry, value: unknown, input: unknown, point: ExtensionPoint, options: InvokeOptions): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? point.timeoutMs;
    const now = options.now ?? Date.now;
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const base = { point: point.name, version: point.version, plugin: entry.plugin, signal: controller.signal, deadline: now() + timeoutMs };
    const context = Object.freeze(point.kind === 'filter' ? { ...base, input } : base);
    try {
        const settled = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                controller.abort(new HookError('COSSACK_HOOK_TIMEOUT', point.name, entry.plugin));
                reject(new HookError('COSSACK_HOOK_TIMEOUT', point.name, entry.plugin));
            }, timeoutMs);
            controller.signal.addEventListener('abort', () => {
                if (options.signal?.aborted) reject(new HookError('COSSACK_HOOK_CANCELLED', point.name, entry.plugin, options.signal.reason));
            }, { once: true });
        });
        // A late handler keeps running, but its result is ignored once the deadline passes.
        return await Promise.race([Promise.resolve().then(() => entry.handler(value, context)), settled]);
    } catch (error) {
        if (error instanceof HookError && error.plugin === entry.plugin && error.point === point.name) throw error;
        throw new HookError('COSSACK_HOOK_FAILED', point.name, entry.plugin, error);
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
    }
}

/** Deep-copy plain objects and arrays, then freeze them. Other objects are shared as-is. */
function snapshot<T>(value: T, depth = 0): T {
    if (depth > 64) throw new RangeError('Hook payload nesting exceeds 64');
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Object.freeze(value.map(item => snapshot(item, depth + 1))) as T;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const copy: { [key: string]: unknown } = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = snapshot(entry, depth + 1);
    return Object.freeze(copy) as T;
}
