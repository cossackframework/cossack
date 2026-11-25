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

/** The largest JSON request or response limit a call may be given (`maxRequestBytes`, `maxResponseBytes`): 16 MiB. */
export const RPC_JSON_RESPONSE_LIMIT_MAX_BYTES = 16 * 1024 * 1024;

/** Validate a byte limit of server method calls: `maxResponseBytes` or `rpc.maxRequestBytes`. */
export function validateRpcByteLimit(value: unknown, label = 'maxResponseBytes'): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > RPC_JSON_RESPONSE_LIMIT_MAX_BYTES) {
        throw new RangeError(`[Cossack] ${label} must be an integer from 1 to ${RPC_JSON_RESPONSE_LIMIT_MAX_BYTES} bytes (16 MiB).`);
    }
    return value;
}

/** The `maxResponseBytes` a class's server method declares, inherited declarations included. */
export function serverMethodResponseLimit(constructor: unknown, action: string): number | undefined {
    const limit = collectServerMethodMetadata(constructor)[action]?.maxResponseBytes;
    return typeof limit === 'number' ? limit : undefined;
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
