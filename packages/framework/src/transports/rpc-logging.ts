export interface RpcFailureContext {
  requestId: string;
  route: string;
  action: string;
  runtime: string;
  startedAt: number;
}

export type RpcFailureStage =
  | 'action'
  | 'request'
  | 'stream'
  | 'response-stream'
  | 'cleanup'
  | 'response-cleanup'
  | 'coordinator-action'
  | 'coordinator-cancellation'
  | 'coordinator-stream';

export type RpcFailureCode = 'COSSACK_RPC_INTERNAL_ERROR' | 'COSSACK_RPC_CLEANUP_FAILED';

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedLabel(value: string, maxLength: number): string {
  return value.replace(/[^a-zA-Z0-9_.$/\[\]-]/g, '_').slice(0, maxLength) || 'unknown';
}

/** Emit searchable RPC failure metadata without retaining application error data. */
export function logRpcFailure(
  context: RpcFailureContext | undefined,
  stage: RpcFailureStage,
  code: RpcFailureCode = 'COSSACK_RPC_INTERNAL_ERROR',
): void {
  const elapsed = context ? performance.now() - context.startedAt : 0;
  console.error({
    event: 'cossack.rpc.failure',
    requestId: context && requestIdPattern.test(context.requestId) ? context.requestId : 'unavailable',
    route: boundedLabel(context?.route ?? 'unknown', 160),
    action: boundedLabel(context?.action ?? 'unknown', 80),
    runtime: boundedLabel(context?.runtime ?? 'unknown', 40),
    durationMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0,
    stage,
    code,
  });
}
