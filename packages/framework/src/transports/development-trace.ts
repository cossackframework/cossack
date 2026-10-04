import type { Context, MiddlewareHandler } from 'hono';
import { DEVELOPMENT_RPC_HEADER, type DevelopmentRpcEvidence } from '@cossackframework/core/devtools';

const key = 'cossack:development-rpc-evidence';
/** Request-local only. An explicit browser capture opts in; production installs nothing. */
export function developmentRpcEvidence(): MiddlewareHandler {
    return async (c, next) => {
        if (!import.meta.env.DEV) return next();
        const callId = c.req.header(DEVELOPMENT_RPC_HEADER);
        if (!callId || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(callId)) return next();
        const evidence: DevelopmentRpcEvidence = { schemaVersion: 1, callId, requestId: '', dispatchId: crypto.randomUUID(),
            receivedAt: Date.now(), invokedAt: null, returnedAt: null, respondedAt: 0, result: 'none', status: 200 };
        c.set(key, evidence);
        await next();
        const requestId = c.res.headers.get('X-Cossack-Request-Id');
        if (!requestId) return;
        evidence.requestId = requestId; evidence.respondedAt = Date.now(); evidence.status = c.res.status;
        c.header(DEVELOPMENT_RPC_HEADER, JSON.stringify(evidence));
    };
}
export function developmentRpcInvoked(c: Context): void {
    if (!import.meta.env.DEV) return;
    const evidence = c.get(key) as DevelopmentRpcEvidence | undefined;
    if (evidence) evidence.invokedAt = Date.now();
}
export function developmentRpcReturned(c: Context, result: DevelopmentRpcEvidence['result']): void {
    if (!import.meta.env.DEV) return;
    const evidence = c.get(key) as DevelopmentRpcEvidence | undefined;
    if (evidence) { evidence.returnedAt = Date.now(); evidence.result = result; }
}

/** Called only after the existing dispatcher has classified a stream; never inspects application objects. */
export function developmentRpcStream(c: Context): void {
    if (!import.meta.env.DEV) return;
    const evidence = c.get(key) as DevelopmentRpcEvidence | undefined;
    if (evidence) evidence.result = 'stream';
}
