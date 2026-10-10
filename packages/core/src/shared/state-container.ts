import { developmentName, developmentValueReader, type DevelopmentStateSnapshot } from './development-inspection';
// src/shared/state-container.ts

/**
 * Internal state container for a component.
 * This is the single source of truth for all component state.
 */
export class StateContainer {
    private _publicState = new Map<string, unknown>();
    private _internalState = new Map<string, unknown>();
    private _initializedKeys = new Set<string>();

    /** @internal Reads stored values, never component getters or serialization hooks. */
    developmentSnapshot(selected: ReadonlySet<string>, clientKeys: ReadonlySet<string>): DevelopmentStateSnapshot {
        if (!import.meta.env?.DEV) return { fields: [], truncated: false };
        const fields: DevelopmentStateSnapshot['fields'] = [], seen = new Set<string>();
        const read = developmentValueReader();
        let truncated = false;
        const append = (name: string, value: unknown, visibility: 'public' | 'client') => {
            if (seen.has(name)) return;
            if (fields.length >= 64) { truncated = true; return; }
            seen.add(name); fields.push({ name: developmentName(name), visibility,
                value: selected.has(name) ? read(value, name) : { type: 'omitted' } });
        };
        // Selected fields take precedence over the bounded default inventory.
        for (const name of selected) {
            if (this._publicState.has(name)) append(name, this._publicState.get(name), 'public');
            else if (clientKeys.has(name) && this._internalState.has(name)) append(name, this._internalState.get(name), 'client');
        }
        for (const [name, value] of this._publicState) { append(name, value, 'public'); if (truncated) break; }
        for (const name of clientKeys) { if (truncated) break; if (this._internalState.has(name)) append(name, this._internalState.get(name), 'client'); }
        return { fields, truncated };
    }

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
