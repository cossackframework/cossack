import { Context } from 'hono';

/** @internal Upgrade metadata retained per socket, independently of component state. */
export interface SocketRequestSnapshot {
    url: string;
    params: Record<string, string>;
    headers: [string, string][];
    locale?: string;
}

/** Authenticated metadata held in a Durable Object WebSocket attachment. */
export interface SocketPeerAttachment {
    channel?: string;
    user?: unknown;
    request?: SocketRequestSnapshot;
    identity?: unknown;
    componentPath?: string;
    scopeKey?: string;
}

/** Do not retain HTTP credentials, handshake noise, or internal auth assertions. */
export function snapshotSocketRequest(request: Request, params: Record<string, string>): SocketRequestSnapshot {
    const headers: [string, string][] = [];
    const locale = request.headers.get('x-cossack-realtime-locale') ?? request.headers.get('accept-language') ?? 'en';
    for (const [name, value] of request.headers) {
        if (['cookie', 'authorization', 'proxy-authorization', 'set-cookie', 'x-api-key', 'x-auth-token',
            'x-user-id', 'x-user-data', 'x-component-path',
            'x-cossack-realtime-identity', 'x-cossack-realtime-scope', 'x-cossack-realtime-locale', 'x-cossack-realtime-target-valid',
            'connection', 'upgrade'].includes(name) || name.startsWith('sec-websocket-')) continue;
        headers.push([name, value]);
    }
    return { url: request.url, params: { ...params }, headers, locale };
}

/** Reconstruct a fresh context for each action; never mutate a shared component's base context. */
export function socketRequestContext(snapshot: SocketRequestSnapshot, env: unknown, user: unknown): Context {
    const context = new Context(new Request(snapshot.url, { headers: snapshot.headers }), {
        env, path: new URL(snapshot.url).pathname,
    });
    context.set('user', user);
    const request = new Proxy(context.req, {
        get(target, property) {
            if (property === 'param') return (key?: string) => key === undefined ? { ...snapshot.params }
                : Object.hasOwn(snapshot.params, key) ? snapshot.params[key] : undefined;
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    return new Proxy(context, {
        get(target, property) {
            if (property === 'req') return request;
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}
