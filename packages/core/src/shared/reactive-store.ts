/**
 * A lightweight reactive store — a framework-agnostic signal/subscriber pattern
 * for cross-component state that needs to trigger re-renders when changed.
 *
 * The existing `provide`/`consume` context API does a one-time read and does
 * NOT notify consumers when the value changes. This module fills that gap for
 * global-state use cases like a Toast queue, a theme switcher, or a command
 * palette open/close trigger.
 *
 * Usage:
 *   // Create a global store (module-level singleton):
 *   const toastStore = createStore<Toast[]>([]);
 *
 *   // Anywhere in the app — push a toast:
 *   toastStore.set([...toastStore.get(), { id, message }]);
 *
 *   // In a component — subscribe so it re-renders on change:
 *   @ClientState() toasts = toastStore.get();
 *   onMount() {
 *     this._unsub = toastStore.subscribe((next) => { this.toasts = next; });
 *   }
 *   onCleanup() {
 *     this._unsub?.();
 *   }
 *
 * Or use the convenience helper to auto-wire a store into a component field:
 *   @ClientState() toasts = [];
 *   onMount() { connectStore(toastStore, this, 'toasts'); }
 */

export interface ReactiveStore<T> {
    /** Read the current value. */
    get(): T;
    /** Replace the value and notify all subscribers. */
    set(value: T): void;
    /** Update the value via a function and notify subscribers. */
    update(fn: (current: T) => T): void;
    /** Subscribe to value changes. Returns an unsubscribe function. */
    subscribe(listener: (value: T) => void): () => void;
}

/**
 * Create a reactive store with an initial value.
 */
export function createStore<T>(initial: T): ReactiveStore<T> {
    let value = initial;
    const listeners = new Set<(value: T) => void>();

    return {
        get: () => value,
        set: (next: T) => {
            if (Object.is(next, value)) return;
            value = next;
            for (const listener of listeners) {
                listener(value);
            }
        },
        update: (fn: (current: T) => T) => {
            const next = fn(value);
            if (Object.is(next, value)) return;
            value = next;
            for (const listener of listeners) {
                listener(value);
            }
        },
        subscribe: (listener: (value: T) => void) => {
            listeners.add(listener);
            // Immediately call with the current value so the consumer is in sync.
            listener(value);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/**
 * Convenience: connect a ReactiveStore to a component field. The field is
 * updated whenever the store changes, and the subscription is tracked for
 * cleanup. Returns an unsubscribe function (call in `onCleanup`).
 *
 * @param store   The reactive store to subscribe to.
 * @param target  The component instance (must have the field as a reactive prop).
 * @param key     The field name on the component to update.
 */
export function connectStore<T extends Record<string, any>>(
    store: ReactiveStore<any>,
    target: T,
    key: keyof T,
): () => void {
    return store.subscribe((value) => {
        target[key] = value;
    });
}
