import type { Context } from 'hono';

export const REQUEST_STARTED_AT_KEY = 'cossack.requestStartedAt';

export interface ServerFailureContext {
  requestId: string;
  route: string;
  action: string;
  runtime: string;
  startedAt: number;
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
    startedAt: typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : performance.now() };
}
/** No exception argument: arbitrary messages, stacks, causes and properties stay private. */
export function logServerFailure(context: ServerFailureContext, kind: ServerFailureKind, stage: ServerFailureStage, code: ServerFailureCode): void {
  const elapsed = performance.now() - context.startedAt;
  console.error({ event: `cossack.${kind}.failure`, requestId: uuid.test(context.requestId) ? context.requestId : 'unavailable',
    route: label(context.route, 160), action: label(context.action, 80), runtime: label(context.runtime, 40),
    durationMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0, stage, code });
}
