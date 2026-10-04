import type { DevelopmentSocketEvidence } from './development-rpc-evidence';

export interface DevelopmentSocketDispatch {
    invoked(): void;
    returned(result: DevelopmentSocketEvidence['result']): void;
    frame(type: DevelopmentSocketEvidence['frame']): string | undefined;
}
/** One message owns this recorder even while waiting behind another queued action. */
export function beginDevelopmentSocketDispatch(callId: unknown, requestId: unknown): DevelopmentSocketDispatch | undefined {
    if (!import.meta.env?.DEV) return;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    if (typeof callId !== 'string' || !uuid.test(callId) || typeof requestId !== 'string' || !uuid.test(requestId)) return;
    const evidence: Omit<DevelopmentSocketEvidence, 'frame' | 'respondedAt'> = {
        schemaVersion: 1, callId, requestId, dispatchId: crypto.randomUUID(),
        receivedAt: Date.now(), invokedAt: null, returnedAt: null, result: 'none',
    };
    let yielded = false, finished = false;
    return {
        invoked: () => { evidence.invokedAt = Date.now(); },
        returned: result => { evidence.returnedAt = Date.now(); evidence.result = result; },
        frame: frame => {
            if (finished || frame === 'yield' && yielded) return;
            if (frame === 'yield') yielded = true; else finished = true;
            return JSON.stringify({ ...evidence, respondedAt: Date.now(), frame } satisfies DevelopmentSocketEvidence);
        },
    };
}
