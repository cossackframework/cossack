/** Merge server declarations without mutating ancestor maps. Nearest wins. */
export const MAX_SERVER_METHOD_TIMEOUT_MS = 2_147_483_647;

export function validateRpcTimeout(value: unknown, label = 'RPC timeout'): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_SERVER_METHOD_TIMEOUT_MS) {
        throw new RangeError(`[Cossack] ${label} must be an integer from 1 to ${MAX_SERVER_METHOD_TIMEOUT_MS} milliseconds.`);
    }
    return value;
}

/**
 * Validate a client-side RPC deadline before passing it to setTimeout.
 * JavaScript runtimes clamp larger delays to a short timer, so accepting them
 * would turn a long deadline into an almost immediate timeout.
 */
export function validateServerMethodTimeout(value: unknown): number | undefined {
    return validateRpcTimeout(value, 'Server method timeout');
}

export function collectServerMethodMetadata(constructor: unknown): Record<string, any> {
    const result: Record<string, any> = Object.create(null);
    let current: object | null = typeof constructor === 'function' ? constructor : null;
    while (current && current !== Function.prototype) {
        const own = Reflect.getOwnMetadata('cossack:server-methods', current) as Record<string, unknown> | undefined;
        for (const [name, options] of Object.entries(own ?? {})) {
            if (!Object.hasOwn(result, name)) result[name] = options;
        }
        current = Object.getPrototypeOf(current);
    }
    return result;
}
