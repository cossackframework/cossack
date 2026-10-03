/** Pure storage contracts: configuration traits, never proof of remote readiness. */
export type StorageKind = 'cache' | 'rate-limit';
export type StorageOperation = 'get' | 'set' | 'has' | 'delete' | 'flush' | 'getMany' | 'setMany' | 'deleteMany' | 'hit';
export interface StorageCapabilities {
    kind: StorageKind;
    provider: string;
    durationUnit: 'milliseconds';
    locality: 'process' | 'shared' | 'unknown';
    persistence: 'ephemeral' | 'durable' | 'unknown';
    consistency: 'strong' | 'eventual' | 'unknown';
    atomicIncrement: boolean | 'unknown';
    expiryPrecision: 'milliseconds' | 'unknown';
    operations: readonly StorageOperation[] | 'unknown';
}
export interface StorageRequirements {
    shared?: boolean;
    durable?: boolean;
    strongConsistency?: boolean;
    atomicIncrement?: boolean;
    millisecondExpiry?: boolean;
    operations?: readonly StorageOperation[];
}
const CACHE_OPERATIONS: readonly StorageOperation[] = ['get', 'set', 'has', 'delete', 'flush', 'getMany', 'setMany', 'deleteMany'];
const OPERATIONS = [...CACHE_OPERATIONS, 'hit'];

export function storageCapabilities(kind: StorageKind, provider: string): StorageCapabilities {
    const database = kind === 'cache' && provider === 'database';
    const known = ['memory', 'kv', 'durable-object'].includes(provider) || (kind === 'rate-limit' && provider === 'redis');
    const result: StorageCapabilities = {
        kind, provider: /^[a-zA-Z0-9_.-]{1,128}$/.test(provider) ? provider : 'unknown', durationUnit: 'milliseconds',
        locality: known ? provider === 'memory' ? 'process' : 'shared' : 'unknown',
        persistence: provider === 'memory' ? 'ephemeral' : known && provider !== 'redis' ? 'durable' : 'unknown',
        consistency: known ? provider === 'kv' ? 'eventual' : 'strong' : 'unknown',
        atomicIncrement: kind === 'cache' ? false : known ? provider !== 'kv' : 'unknown',
        expiryPrecision: known || database ? 'milliseconds' : 'unknown',
        operations: known || database ? kind === 'rate-limit' ? ['hit']
            : CACHE_OPERATIONS.filter(operation => provider !== 'kv' || operation !== 'flush') : 'unknown',
    };
    if (Array.isArray(result.operations)) Object.freeze(result.operations);
    return Object.freeze(result);
}

export class StorageCapabilityError extends Error {
    readonly code = 'COSSACK_STORAGE_GUARANTEE_UNSUPPORTED';
    constructor(public readonly capability: keyof StorageRequirements) {
        super(`[Cossack] Selected storage cannot prove required ${capability}; inspect provider capabilities or select a suitable provider.`);
        this.name = 'StorageCapabilityError';
    }
}

/** Validate and snapshot a custom declaration; no backend values enter output. */
export function readStorageCapabilities(declaration: unknown, kind: StorageKind): StorageCapabilities {
    if (declaration === undefined) return storageCapabilities(kind, 'custom');
    try {
        if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) throw new Error();
        const value = declaration as StorageCapabilities;
        const result = { kind: value.kind, provider: value.provider, durationUnit: value.durationUnit,
            locality: value.locality, persistence: value.persistence, consistency: value.consistency,
            atomicIncrement: value.atomicIncrement, expiryPrecision: value.expiryPrecision, operations: value.operations };
        if (result.kind !== kind || typeof result.provider !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(result.provider) ||
            (kind === 'cache' && result.atomicIncrement === true) ||
            result.durationUnit !== 'milliseconds' || !['process', 'shared', 'unknown'].includes(result.locality) ||
            !['ephemeral', 'durable', 'unknown'].includes(result.persistence) || !['strong', 'eventual', 'unknown'].includes(result.consistency) ||
            ![true, false, 'unknown'].includes(result.atomicIncrement) || !['milliseconds', 'unknown'].includes(result.expiryPrecision) ||
            (result.operations !== 'unknown' && (!Array.isArray(result.operations) || result.operations.length > 9 ||
                result.operations.some(operation => kind === 'cache' ? !CACHE_OPERATIONS.includes(operation) : operation !== 'hit')))) throw new Error();
        return Object.freeze({ ...result, operations: result.operations === 'unknown' ? 'unknown' : Object.freeze([...result.operations]) });
    } catch { throw new Error('[Cossack] Invalid storage capability declaration.'); }
}

/** Snapshot requests too: later mutation cannot weaken an awaited guard. */
export function storageRequirements(input: unknown): Readonly<StorageRequirements> {
    if (input === undefined) return Object.freeze({});
    try {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error();
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(input)) {
            const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
            if (!('value' in descriptor)) throw new Error();
            const value = descriptor.value;
            if (['shared', 'durable', 'strongConsistency', 'atomicIncrement', 'millisecondExpiry'].includes(key)) {
                if (typeof value !== 'boolean') throw new Error();
                result[key] = value;
            } else if (key === 'operations' && Array.isArray(value) && value.length <= 9 && value.every(operation => OPERATIONS.includes(operation))) {
                result[key] = Object.freeze([...value]);
            } else throw new Error();
        }
        return Object.freeze(result);
    } catch { throw new Error('[Cossack] Invalid storage requirements; use documented boolean guarantees and operation names.'); }
}

export function assertStorageRequirements(capabilities: StorageCapabilities, requirements?: StorageRequirements): void {
    const required = storageRequirements(requirements);
    const facts = { shared: capabilities.locality === 'shared', durable: capabilities.persistence === 'durable',
        strongConsistency: capabilities.consistency === 'strong', atomicIncrement: capabilities.atomicIncrement === true,
        millisecondExpiry: capabilities.expiryPrecision === 'milliseconds' };
    for (const [key, supported] of Object.entries(facts)) {
        if (required[key as keyof typeof facts] && !supported) throw new StorageCapabilityError(key as keyof StorageRequirements);
    }
    if (required.operations?.some(operation => capabilities.operations === 'unknown' || !capabilities.operations.includes(operation))) {
        throw new StorageCapabilityError('operations');
    }
}
