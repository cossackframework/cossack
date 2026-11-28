import type { Context } from 'hono';

export const REQUEST_STARTED_AT_KEY = 'cossack.requestStartedAt';

export interface ServerFailureContext {
  requestId: string;
  route: string;
  action: string;
  runtime: string;
  startedAt: number;
  /** The request the failure belongs to, for the application's failure handler. Never logged. */
  c?: Context;
}
/**
 * What the framework's log line says about a failure it answered itself: the same fields,
 * and nothing of the error.
 */
export interface ServerFailure {
  event: 'cossack.api.failure' | 'cossack.ssr.failure' | 'cossack.request.failure' | 'cossack.rpc.failure';
  /** The id in the response's `X-Cossack-Request-Id`, or `unavailable`. */
  requestId: string;
  /** The authored route template, never the address. */
  route: string;
  action: string;
  runtime: string;
  durationMs: number;
  stage: string;
  code: string;
}
/**
 * The application's function for failures (`createApp({ onServerFailure })`). It gets the
 * line, the thrown error, and the request when the framework has it. What it does with the
 * error is the application's choice: the framework logs none of it in production.
 */
export type ServerFailureHandler = (failure: ServerFailure, error: unknown, c?: Context) => unknown;
let failureHandler: ServerFailureHandler | undefined;
/** Set by `createApp`; `undefined` removes it. One application runs in a process. */
export function setServerFailureHandler(handler: ServerFailureHandler | undefined): void {
  failureHandler = typeof handler === 'function' ? handler : undefined;
}
/**
 * Gives a failure to development's log and to the application's handler. A handler that
 * throws or rejects changes nothing: the answer was decided before it ran. A promise it
 * returns is kept alive past the response where the runtime has `waitUntil`.
 */
export function reportServerFailure(failure: ServerFailure, error: unknown, c?: Context): void {
  logDevelopmentCause(error);
  if (!failureHandler || error === undefined) return;
  try {
    const result = failureHandler(failure, error, c);
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      const settled = Promise.resolve(result).catch(() => {});
      try { c?.executionCtx.waitUntil(settled); } catch { /* no execution context on this runtime */ }
    }
  } catch { /* the handler's own failure is not the request's */ }
}
export type ServerFailureKind = 'api' | 'ssr' | 'request';
export type ServerFailureStage = 'input' | 'authorize' | 'handler' | 'output' | 'render' | 'component-cleanup' | 'service-cleanup' | 'middleware';
export type ServerFailureCode = 'COSSACK_API_INTERNAL' | 'COSSACK_SSR_INTERNAL' | 'COSSACK_SSR_CLEANUP_FAILED' | 'COSSACK_REQUEST_INTERNAL';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function label(value: unknown, max: number): string {
  if (typeof value !== 'string') return 'unknown';
  return value.replace(/[^a-zA-Z0-9_.$/\[\]:*-]/g, '_').slice(0, max) || 'unknown';
}
/** Use authored route templates, never actual URLs, query strings or request headers. */
export function createServerFailureContext(c: Context, options: { route?: string; action?: string; runtime?: string } = {}): ServerFailureContext {
  const existing = c.res.headers.get('X-Cossack-Request-Id');
  const requestId = existing && uuid.test(existing) ? existing : crypto.randomUUID();
  c.header('X-Cossack-Request-Id', requestId);
  const runtime = options.runtime ?? c.get('cossack.configContext')?.runtime ?? 'unknown';
  const startedAt = c.get(REQUEST_STARTED_AT_KEY);
  return { requestId, route: label(options.route ?? c.req.routePath ?? 'unknown', 160),
    action: label(options.action ?? 'unknown', 80), runtime: label(runtime, 40),
    startedAt: typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : performance.now(), c };
}
/**
 * In production the line carries no exception: arbitrary messages, stacks, causes and
 * properties stay private. In development, the thrown error (message and stack) follows it.
 * The application's failure handler gets the line and the error.
 */
export function logServerFailure(context: ServerFailureContext, kind: ServerFailureKind, stage: ServerFailureStage, code: ServerFailureCode, error?: unknown): void {
  const elapsed = performance.now() - context.startedAt;
  const failure: ServerFailure = { event: `cossack.${kind}.failure`, requestId: uuid.test(context.requestId) ? context.requestId : 'unavailable',
    route: label(context.route, 160), action: label(context.action, 80), runtime: label(context.runtime, 40),
    durationMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0, stage, code };
  console.error(failure);
  reportServerFailure(failure, error, context.c);
}

/** Development only: the error behind a failure line, with its stack. */
export function logDevelopmentCause(error: unknown): void {
  if (error === undefined || !import.meta.env?.DEV) return;
  console.error('[cossack] caused by:', error);
}
