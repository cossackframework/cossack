import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

export type ResourceAuthorizationCode = 'COSSACK_AUTH_UNAUTHENTICATED' | 'COSSACK_AUTH_FORBIDDEN';

/** Deliberate denial, with a fixed public message and an HTTP/RPC marker. */
export class ResourceAuthorizationError extends HTTPException {
    readonly authorizationCode: ResourceAuthorizationCode;
    constructor(code: ResourceAuthorizationCode, requestId: string = crypto.randomUUID()) {
        const status = code === 'COSSACK_AUTH_UNAUTHENTICATED' ? 401 : 403;
        const message = status === 401 ? 'Authentication required' : 'Forbidden';
        super(status, { message, res: Response.json({ error: message, code, requestId }, {
            status, headers: { 'X-Cossack-Request-Id': requestId },
        }) });
        this.name = 'ResourceAuthorizationError';
        this.authorizationCode = code;
    }
}

export interface ResourcePolicyOptions { signal?: AbortSignal; }
export interface ResourcePolicyContext<User, Resource> {
    readonly user: User;
    readonly resource: Resource;
    readonly context: Context;
    readonly signal: AbortSignal;
}
export interface ResourceLookupContext {
    readonly context: Context;
    readonly signal: AbortSignal;
}
type Rule<User, Resource> = (options: ResourcePolicyContext<User, Resource>) => boolean | Promise<boolean>;
type Rules<User, Resource> = Record<string, Rule<User, Resource>>;
type Lookup<Resource, Input> = (input: Input, options: ResourceLookupContext) => Resource | undefined | null | Promise<Resource | undefined | null>;

export interface ResourcePolicy<Resource, Action extends string> {
    readonly actions: readonly Action[];
    can(context: Context, action: Action, resource: Resource | undefined | null, options?: ResourcePolicyOptions): Promise<boolean>;
    authorize(context: Context, action: Action, resource: Resource | undefined | null, options?: ResourcePolicyOptions): Promise<Resource>;
    permissions(context: Context, resource: Resource | undefined | null, options?: ResourcePolicyOptions): Promise<Readonly<Record<Action, boolean>>>;
    /** Adapter for @Server({ authorize }); lookup always uses parsed input/server context. */
    action<Input>(action: Action, lookup: Lookup<Resource, Input>): (input: Input, options: ResourceLookupContext) => Promise<boolean>;
    /** Request-specific record lookup, before an API/page handler executes. */
    middleware(action: Action, lookup: (context: Context, options: ResourcePolicyOptions) => Resource | undefined | null | Promise<Resource | undefined | null>): MiddlewareHandler;
}

function invalid(): never { throw new Error('[Cossack Auth] Invalid resource policy configuration.'); }
function abort(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Resource authorization was cancelled.', 'AbortError');
}
async function owned<T>(signal: AbortSignal, operation: () => T | Promise<T>): Promise<T> {
    abort(signal);
    let onAbort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new DOMException('Resource authorization was cancelled.', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
    try {
        const result = await Promise.race([Promise.resolve().then(() => { abort(signal); return operation(); }), interrupted]);
        abort(signal); return result;
    } catch (cause) {
        abort(signal);
        // Only this kit's explicit decisions are public denials. A lookup/rule
        // throwing an HTTP exception still represents an internal failure.
        throw new Error('[Cossack Auth] Resource policy callback failed.', {cause});
    } finally { signal.removeEventListener('abort', onAbort); }
}

/** Define named actions once, retaining their union and the application's resource/user types. */
export function createResourcePolicy<Resource, User>() {
    return <const R extends Rules<User, Resource>>(rules: R): ResourcePolicy<Resource, Extract<keyof R, string>> => {
        if (!rules || typeof rules !== 'object' || Array.isArray(rules)
            || ![Object.prototype, null].includes(Object.getPrototypeOf(rules))) invalid();
        const entries = Reflect.ownKeys(rules).map(key => {
            const descriptor = Object.getOwnPropertyDescriptor(rules, key)!;
            if (typeof key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(key)
                || ['constructor', 'prototype'].includes(key) || !('value' in descriptor) || typeof descriptor.value !== 'function') invalid();
            return [key, descriptor.value as Rule<User, Resource>] as const;
        });
        if (!entries.length || entries.length > 128) invalid();
        const callbacks = new Map(entries);
        type Action = Extract<keyof R, string>;
        const actions = Object.freeze(entries.map(([key]) => key as Action));
        const signalFor = (context: Context, options: ResourcePolicyOptions = {}) => options.signal ?? context.req.raw.signal;
        const denied = (context: Context, authenticated: boolean): never => {
            throw new ResourceAuthorizationError(authenticated ? 'COSSACK_AUTH_FORBIDDEN' : 'COSSACK_AUTH_UNAUTHENTICATED',
                context.res.headers.get('X-Cossack-Request-Id') ?? undefined);
        };
        const actor = (context: Context): User | undefined => context.get('user') as User | undefined;
        async function allowed(context: Context, user: User | undefined, action: Action, resource: Resource | undefined | null, signal: AbortSignal): Promise<boolean> {
            abort(signal);
            const callback = callbacks.get(action);
            if (!user || resource === undefined || resource === null || !callback) return false;
            const result = await owned(signal, () => callback({ user, resource, context, signal }));
            if (typeof result !== 'boolean') throw new Error('[Cossack Auth] Resource policy must return a boolean.');
            return result;
        }
        const kit: ResourcePolicy<Resource, Action> = {
            actions,
            can(context, action, resource, options) { return allowed(context, actor(context), action, resource, signalFor(context, options)); },
            async authorize(context, action, resource, options) {
                const user = actor(context), signal = signalFor(context, options);
                if (!await allowed(context, user, action, resource, signal)) denied(context, !!user);
                return resource as Resource;
            },
            async permissions(context, resource, options) {
                const user = actor(context), signal = signalFor(context, options);
                const result = Object.create(null) as Record<Action, boolean>;
                for (const action of actions) result[action] = await allowed(context, user, action, resource, signal);
                return Object.freeze(result);
            },
            action(action, lookup) {
                if (typeof lookup !== 'function') invalid();
                return async (input, { context, signal }) => {
                    abort(signal);
                    const user = actor(context);
                    if (!user) denied(context, false);
                    if (!callbacks.has(action)) denied(context, true);
                    const resource = await owned(signal, () => lookup(input, { context, signal }));
                    if (!await allowed(context, user, action, resource, signal)) denied(context, true);
                    return true;
                };
            },
            middleware(action, lookup) {
                if (typeof lookup !== 'function') invalid();
                return async (context, next) => {
                    const signal = signalFor(context);
                    try {
                        abort(signal);
                        const user = actor(context);
                        if (!user) denied(context, false);
                        if (!callbacks.has(action)) denied(context, true);
                        const resource = await owned(signal, () => lookup(context, { signal }));
                        if (!await allowed(context, user, action, resource, signal)) denied(context, true);
                        abort(signal);
                    } catch (error) {
                        if (signal.aborted) return Response.json({ error: 'Request was cancelled.', code: 'COSSACK_AUTH_CANCELLED' }, { status: 499 });
                        if (error instanceof ResourceAuthorizationError) return error.getResponse();
                        throw error;
                    }
                    await next();
                };
            },
        };
        return Object.freeze(kit);
    };
}
