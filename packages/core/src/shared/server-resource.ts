/** Options accepted by the compiler-only {@link server$} macro. */
export interface ServerResourceOptions<T, Args extends readonly unknown[] = readonly unknown[]> {
    initial?: T;
    /** Readonly tuples (`as const`) are accepted without widening dependency values. */
    deps?: () => Args | Readonly<Args>;
}

/**
 * Declare read-only data loaded by the server.
 *
 * This function is a compiler macro and must be used in a Cossack component
 * class field or directly inside render(). The security plugin replaces it
 * before the module is evaluated.
 */
export function server$<T, Args extends readonly unknown[]>(
    loader: (...args: Args) => T | Promise<T>,
    options: ServerResourceOptions<T, Args> & { initial: T },
): T;
export function server$<T, Args extends readonly unknown[] = readonly []>(
    loader: (...args: Args) => T | Promise<T>,
    options?: ServerResourceOptions<T, Args>,
): T | undefined;
export function server$(): never {
    throw new Error('[Cossack] server$() is a compiler macro. Enable cossackSecurityPlugin() in Vite.');
}

export class ServerResourceSerializationError extends Error {
    constructor(resource: string, detail: string) {
        super(`[Cossack server$:${resource}] ${detail}`);
        this.name = 'ServerResourceSerializationError';
    }
}
