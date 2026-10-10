import type { Context, MiddlewareHandler } from 'hono';
import { DEVELOPMENT_RPC_HEADER, type DevelopmentRpcEvidence, type DevelopmentStreamEvidence, type DevelopmentNativeEvidence } from '@cossackframework/core/devtools';

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
export function developmentRpcStream(c: Context, requestId: string): ((outcome: DevelopmentStreamEvidence['outcome'], cleanup: DevelopmentStreamEvidence['cleanup']) => string) | undefined {
    if (!import.meta.env.DEV) return;
    const evidence = c.get(key) as DevelopmentRpcEvidence | undefined;
    if (!evidence) return;
    evidence.result = 'stream';
    return (outcome, cleanup) => JSON.stringify({ schemaVersion: 1, callId: evidence.callId, requestId, dispatchId: evidence.dispatchId,
        finishedAt: Date.now(), outcome, cleanup } satisfies DevelopmentStreamEvidence);
}

/** The Vite runner channel leaves native application bytes and headers untouched. */
export function developmentRpcNative(c: Context, requestId: string): ((outcome: DevelopmentNativeEvidence['outcome'], cleanup: DevelopmentNativeEvidence['cleanup']) => void) | undefined {
    if (!import.meta.env.DEV || !import.meta.hot) return;
    const evidence = c.get(key) as DevelopmentRpcEvidence | undefined;
    if (!evidence) return;
    const hot = import.meta.hot;
    let execution: Pick<Context['executionCtx'], 'waitUntil'> | undefined;
    try { execution = c.executionCtx; } catch { /* Process adapters may not supply an execution context. */ }
    return (outcome, cleanup) => queueDevelopmentNativeEvidence(hot, { schemaVersion: 1,
        callId: evidence.callId, requestId, dispatchId: evidence.dispatchId, finishedAt: Date.now(), outcome, cleanup }, execution);
}

/** @internal Reporting must not hold native headers or EOF behind the development channel. */
export function queueDevelopmentNativeEvidence(hot: NonNullable<ImportMeta['hot']>, evidence: DevelopmentNativeEvidence,
    execution?: Pick<Context['executionCtx'], 'waitUntil'>): void {
    if (!import.meta.env.DEV) return;
    const pending = sendDevelopmentNativeEvidence(hot, evidence).catch(() => {});
    try { execution?.waitUntil(pending); } catch { /* A closing runtime must not change the response. */ }
    // Process runtimes keep the bounded timer alive without a Worker context.
    void pending;
}

/** @internal Keep runner I/O alive until receipt, without retaining a request indefinitely. */
export function sendDevelopmentNativeEvidence(hot: NonNullable<ImportMeta['hot']>, evidence: DevelopmentNativeEvidence): Promise<void> {
    if (!import.meta.env.DEV) return Promise.resolve();
    return new Promise<void>(resolve => {
        const event = 'cossack:development-trace:native';
        const ack = (data: { dispatchId?: string }) => { if (data?.dispatchId === evidence.dispatchId) finish(); };
        const finish = () => {
            clearTimeout(timer);
            try { hot.off(event + ':ack', ack); } catch { /* A disposed runner must still release the request. */ }
            resolve();
        };
        const timer = setTimeout(finish, 1000);
        try {
            hot.on(event + ':ack', ack);
            hot.send(event, JSON.stringify(evidence));
        } catch { finish(); }
    });
}
