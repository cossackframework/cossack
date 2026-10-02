/** Merge server declarations without mutating ancestor maps. Nearest wins. */
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
