/** Pure URL construction. Route registration and application metadata live outside core. */
export interface RouteParameter {
    name: string;
    catchAll: boolean;
}

type ParameterToken<Segment extends string> = Segment extends `:${infer Name}{.+}` ? Name
    : Segment extends `:${infer Name}` ? Name : never;
type SegmentTokens<Path extends string> = Path extends `${infer Head}/${infer Tail}`
    ? ParameterToken<Head> | SegmentTokens<Tail> : ParameterToken<Path>;
type CatchAllTokens<Path extends string> = Path extends `${infer Head}/${infer Tail}`
    ? (Head extends `:${infer Name}{.+}` ? Name : never) | CatchAllTokens<Tail>
    : Path extends `:${infer Name}{.+}` ? Name : never;

/** Ordinary parameters are strings; catch-alls are nonempty ordered path segments. */
export type RouteParameters<Path extends string> = {
    [Name in SegmentTokens<Path>]: Name extends CatchAllTokens<Path> ? readonly [string, ...string[]] : string;
};
type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never;
type IsUnion<Value, Whole = Value> = Value extends Whole ? ([Whole] extends [Value] ? false : true) : never;
type LiteralPatterns<Registry extends Readonly<Record<string, string>>> = {
    [Name in keyof Registry]: string extends Registry[Name] ? never
        : IsUnion<Registry[Name]> extends true ? never : Registry[Name];
};
type CheckRouteArguments<Registry extends Readonly<Record<string, string>>, Args extends unknown[]> =
    Args extends [infer Name extends keyof Registry & string, ...infer Rest]
        ? IsUnion<Name> extends true ? never
        : keyof RouteParameters<Registry[Name]> extends never ? Rest extends [] ? unknown : never
        : Rest extends [infer Params]
            ? [Params] extends [RouteParameters<Registry[Name]>]
                ? Exclude<KeysOfUnion<Params>, keyof RouteParameters<Registry[Name]>> extends never ? unknown : never
                : never
            : never
        : never;
/** Capture authored arguments before checking them, so inference cannot erase extra union keys. */
export type RouteBuilder<Registry extends Readonly<Record<string, string>>> = <
    const Args extends [name: keyof Registry & string, ...parameters: unknown[]],
>(...args: Args & CheckRouteArguments<Registry, NoInfer<Args>>) => string;

export class RouteUrlError extends Error {
    constructor(readonly code: 'COSSACK_ROUTE_UNKNOWN' | 'COSSACK_ROUTE_PATTERN_UNSUPPORTED' | 'COSSACK_ROUTE_PARAMETER_INVALID',
        message: string, readonly route: string, readonly parameter?: string) {
        super(message); this.name = 'RouteUrlError';
    }
}

/** Only the router's literal, :name and :name{.+} segment forms are supported. */
export function routeParameters(pattern: string): RouteParameter[] {
    if (typeof pattern !== 'string' || !pattern.startsWith('/') || /[?#\\]/.test(pattern) || pattern.includes('//')) {
        throw new RouteUrlError('COSSACK_ROUTE_PATTERN_UNSUPPORTED', `Unsupported route pattern ${String(pattern)}.`, String(pattern));
    }
    const result: RouteParameter[] = [];
    for (const segment of pattern.split('/')) {
        if (!segment.startsWith(':')) {
            // URL parsing removes dot segments; Hono treats these symbols as patterns.
            const normalized = segment.replace(/%2e/gi, '.');
            if (normalized === '.' || normalized === '..' || /[:*{}\[\]\s]/.test(segment)) {
                throw new RouteUrlError('COSSACK_ROUTE_PATTERN_UNSUPPORTED', `Unsupported literal segment in ${pattern}.`, pattern);
            }
            continue;
        }
        const match = /^:([A-Za-z_][A-Za-z0-9_-]*)(\{\.\+\})?$/.exec(segment);
        if (!match || result.some(parameter => parameter.name === match[1])) {
            throw new RouteUrlError('COSSACK_ROUTE_PATTERN_UNSUPPORTED', `Unsupported or repeated parameter in ${pattern}.`, pattern);
        }
        result.push({ name: match[1], catchAll: Boolean(match[2]) });
    }
    return result;
}

/** Snapshot patterns once so mutations cannot change the generated URL contract. */
export function createRouteBuilder<const Registry extends Readonly<Record<string, string>>>(registry: Registry & LiteralPatterns<NoInfer<Registry>>): RouteBuilder<Registry> {
    const patterns = new Map(Object.entries(registry).map(([name, pattern]) => [name, { pattern, parameters: routeParameters(pattern) }]));
    const build = (name: string, ...args: unknown[]) => {
        const entry = patterns.get(name);
        if (!entry) throw new RouteUrlError('COSSACK_ROUTE_UNKNOWN', `Unknown route ${String(name)}.`, String(name));
        const invalid = (parameter?: string): never => {
            throw new RouteUrlError('COSSACK_ROUTE_PARAMETER_INVALID', `Invalid parameters for route ${name}${parameter ? `: ${parameter}` : ''}.`, name, parameter);
        };
        if (!entry.parameters.length) { if (args.length) invalid(); return entry.pattern; }
        const params = args[0];
        if (args.length !== 1 || !params || typeof params !== 'object' || Array.isArray(params)) invalid();
        const fields = Reflect.ownKeys(params as object);
        if (fields.length !== entry.parameters.length || fields.some(key => typeof key !== 'string' || !entry.parameters.some(parameter => parameter.name === key))) invalid();
        const values = new Map<string, string>();
        for (const parameter of entry.parameters) {
            const descriptor = Object.getOwnPropertyDescriptor(params, parameter.name);
            if (!descriptor || !('value' in descriptor)) return invalid(parameter.name);
            const segments = parameter.catchAll ? descriptor.value : [descriptor.value];
            if (!Array.isArray(segments) || !segments.length) invalid(parameter.name);
            const encoded: string[] = [];
            for (let index = 0; index < segments.length; index++) {
                const item = Object.getOwnPropertyDescriptor(segments, index);
                if (!item || !('value' in item)) return invalid(parameter.name);
                const segment: unknown = item.value;
                if (typeof segment !== 'string' || !segment || segment === '.' || segment === '..') invalid(parameter.name);
                try { encoded.push(encodeURIComponent(segment as string)); } catch { invalid(parameter.name); }
            }
            values.set(parameter.name, encoded.join('/'));
        }
        return entry.pattern.split('/').map(segment => {
            if (!segment.startsWith(':')) return segment;
            const name = /^:([^{}]+)/.exec(segment)![1];
            return values.get(name)!;
        }).join('/');
    };
    return build as RouteBuilder<Registry>;
}
