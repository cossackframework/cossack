// src/shared/state-container.ts

/**
 * Internal state container for a component.
 * This is the single source of truth for all component state.
 */
export class StateContainer {
    private _publicState = new Map<string, unknown>();
    private _internalState = new Map<string, unknown>();
    private _initializedKeys = new Set<string>();

    /** Get all public state as a plain object */
    getPublicState(): Record<string, unknown> {
        return Object.fromEntries(this._publicState);
    }

    /** Get all internal state as a plain object */
    getInternalState(): Record<string, unknown> {
        return Object.fromEntries(this._internalState);
    }

    /** Get a public state value */
    getPublic(key: string): unknown {
        return this._publicState.get(key);
    }

    /** Get an internal state value */
    getInternal(key: string): unknown {
        return this._internalState.get(key);
    }

    /** Set a public state value */
    setPublic(key: string, value: unknown): void {
        this._publicState.set(key, value);
        this._initializedKeys.add(key);
    }

    /** Set an internal state value */
    setInternal(key: string, value: unknown): void {
        this._internalState.set(key, value);
        this._initializedKeys.add(key);
    }

    /** Check if a key has been initialized */
    isInitialized(key: string): boolean {
        return this._initializedKeys.has(key);
    }

    /** Check if this container has any public state */
    hasPublicState(): boolean {
        return this._publicState.size > 0;
    }

    /** Check if this container has any internal state */
    hasInternalState(): boolean {
        return this._internalState.size > 0;
    }
}
