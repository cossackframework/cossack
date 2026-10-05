/** Portable, value-free runtime failure metadata. Never pass exceptions or actual URLs. */
export interface RuntimeFailureContext {
  requestId?: string;
  /** An authored route template or canonical owner ID, not a concrete pathname. */
  route?: string;
  /** An allowlisted authored method/task name, never an arbitrary incoming action. */
  action?: string;
  component?: string;
  runtime?: string;
  startedAt?: number;
}
export type RuntimeFailureStage = 'action' | 'action-cleanup' | 'parse' | 'dispatch' | 'delivery' | 'task-setup' | 'task-cleanup' | 'component-cleanup' | 'service-setup-cleanup' | 'service-cleanup' | 'authentication' | 'scope' | 'upgrade' | 'initialization' | 'initial-state' | 'socket' | 'runtime-cleanup';
export type RuntimeFailureCode = 'COSSACK_RUNTIME_FAILED' | 'COSSACK_RPC_INTERNAL_ERROR' | 'COSSACK_RPC_CLEANUP_FAILED' | 'COSSACK_WEBSOCKET_MESSAGE_INVALID' | 'COSSACK_TASK_FAILED' | 'COSSACK_TASK_CLEANUP_FAILED' | 'COSSACK_COMPONENT_CLEANUP_FAILED' | 'COSSACK_SERVICE_CLEANUP_FAILED';
const stages = new Set<RuntimeFailureStage>(['action', 'action-cleanup', 'parse', 'dispatch', 'delivery', 'task-setup', 'task-cleanup', 'component-cleanup', 'service-setup-cleanup', 'service-cleanup', 'authentication', 'scope', 'upgrade', 'initialization', 'initial-state', 'socket', 'runtime-cleanup']);
const codes = new Set<RuntimeFailureCode>(['COSSACK_RUNTIME_FAILED', 'COSSACK_RPC_INTERNAL_ERROR', 'COSSACK_RPC_CLEANUP_FAILED', 'COSSACK_WEBSOCKET_MESSAGE_INVALID', 'COSSACK_TASK_FAILED', 'COSSACK_TASK_CLEANUP_FAILED', 'COSSACK_COMPONENT_CLEANUP_FAILED', 'COSSACK_SERVICE_CLEANUP_FAILED']);
const runtimes = new Set(['cloudflare', 'cloudflare-workers', 'node', 'deno', 'browser', 'web', 'unknown']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function field(context: RuntimeFailureContext, name: keyof RuntimeFailureContext): unknown {
  try { const descriptor = Object.getOwnPropertyDescriptor(context, name); return descriptor && 'value' in descriptor ? descriptor.value : undefined; }
  catch { return undefined; }
}
function label(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_.$/\[\]:*-]/g, '_').slice(0, max) || 'unknown' : 'unknown';
}
export function logRuntimeFailure(context: RuntimeFailureContext, stage: RuntimeFailureStage, code: RuntimeFailureCode = 'COSSACK_RUNTIME_FAILED'): void {
  const requestId = field(context, 'requestId');
  const runtime = field(context, 'runtime');
  const startedAt = field(context, 'startedAt');
  const elapsed = typeof startedAt === 'number' && Number.isFinite(startedAt) ? performance.now() - startedAt : 0;
  console.error({ event: 'cossack.runtime.failure',
    requestId: typeof requestId === 'string' && uuid.test(requestId) ? requestId : 'unavailable',
    route: label(field(context, 'route'), 160), action: label(field(context, 'action'), 80),
    component: label(field(context, 'component'), 80),
    runtime: typeof runtime === 'string' && runtimes.has(runtime) ? runtime : 'unknown',
    durationMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0,
    stage: stages.has(stage) ? stage : 'unknown', code: codes.has(code) ? code : 'COSSACK_RUNTIME_FAILED',
  });
}
