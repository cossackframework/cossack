/** Return whether a method is explicitly marked local-only with `@Shared()`. */
export function isSharedMethod(constructor: unknown, action: string): boolean {
    if (typeof constructor !== 'function') return false;
    let prototype: object | null = constructor.prototype;
    while (prototype !== null && prototype !== Object.prototype) {
        if (Reflect.getOwnMetadata('cossack:shared', prototype, action) === true) return true;
        prototype = Object.getPrototypeOf(prototype);
    }
    return false;
}
