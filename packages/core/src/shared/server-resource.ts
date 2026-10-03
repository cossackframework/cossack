/** Declared server$ field names. Values remain ordinary application types. */
export type ServerResourceName<Options, Host> = Options extends { Resources: infer Names extends string }
    ? Names & keyof Host
    : string;

/** Infer lifecycle values from the named field, including null/undefined. */
export type ServerResourceValue<Options, Host, Name extends string> =
    Options extends { Resources: string } ? Host[Name & keyof Host] : unknown;

/** A snapshot, not a mutable handle. Ready resources always have a value. */
export type ServerResourceStatus<Value> =
    | { state: 'ready'; hasValue: true; value: Value; stale: false; error?: undefined }
    | ({ state: 'pending'; stale: boolean; error?: undefined } & (
        | { hasValue: true; value: Value }
        | { hasValue: false; value: undefined }
    ))
    | ({ state: 'error'; stale: false; error: unknown } & (
        | { hasValue: true; value: Value }
        | { hasValue: false; value: undefined }
    ));

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
