/** Bounded response-carried development evidence. It is not an authenticated audit log. */
export const DEVELOPMENT_RPC_HEADER = 'X-Cossack-Development-Trace';
export interface DevelopmentRpcEvidence {
    schemaVersion: 1;
    callId: string;
    requestId: string;
    dispatchId: string;
    receivedAt: number;
    invokedAt: number | null;
    returnedAt: number | null;
    respondedAt: number;
    result: 'none' | 'value' | 'stream' | 'native';
    status: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const time = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
/** Parsed JSON only; unknown fields are rejected so payloads cannot enter stored traces. */
export function parseDevelopmentRpcEvidence(json: string | null): DevelopmentRpcEvidence | undefined {
    if (!json || json.length > 1024) return;
    try {
        const e = JSON.parse(json);
        const keys = ['schemaVersion', 'callId', 'requestId', 'dispatchId', 'receivedAt', 'invokedAt', 'returnedAt', 'respondedAt', 'result', 'status'];
        if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length !== keys.length || keys.some(k => !Object.hasOwn(e, k))) return;
        if (e.schemaVersion !== 1 || ['callId', 'requestId', 'dispatchId'].some(k => typeof e[k] !== 'string' || !uuid.test(e[k]))) return;
        if (!time(e.receivedAt) || !time(e.respondedAt) || (e.invokedAt !== null && !time(e.invokedAt)) || (e.returnedAt !== null && !time(e.returnedAt))) return;
        if (!Number.isInteger(e.status) || e.status < 200 || e.status > 599 || !['none', 'value', 'stream', 'native'].includes(e.result)) return;
        if ((e.returnedAt === null) !== (e.result === 'none') || (e.returnedAt !== null && e.invokedAt === null)) return;
        return e;
    } catch { return; }
}

/** A delivered RPC terminal frame, after request cleanup was attempted. */
export interface DevelopmentStreamEvidence {
    schemaVersion: 1;
    callId: string;
    requestId: string;
    dispatchId: string;
    finishedAt: number;
    outcome: 'succeeded' | 'failed';
    cleanup: 'completed' | 'failed';
}
export function parseDevelopmentStreamEvidence(json: unknown): DevelopmentStreamEvidence | undefined {
    if (typeof json !== 'string' || json.length > 1024) return;
    try {
        const e = JSON.parse(json);
        const keys = ['schemaVersion', 'callId', 'requestId', 'dispatchId', 'finishedAt', 'outcome', 'cleanup'];
        if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length !== keys.length || keys.some(k => !Object.hasOwn(e, k))) return;
        if (e.schemaVersion !== 1 || ['callId', 'requestId', 'dispatchId'].some(k => typeof e[k] !== 'string' || !uuid.test(e[k]))) return;
        if (!time(e.finishedAt) || !['succeeded', 'failed'].includes(e.outcome) || !['completed', 'failed'].includes(e.cleanup)) return;
        if (e.outcome === 'succeeded' && e.cleanup !== 'completed') return;
        return e;
    } catch { return; }
}

/** Socket response preparation, not HTTP status or post-send/iterator cleanup evidence. */
export interface DevelopmentSocketEvidence extends Omit<DevelopmentRpcEvidence, 'status'> {
    frame: 'yield' | 'done' | 'error';
}
export function parseDevelopmentSocketEvidence(json: unknown): DevelopmentSocketEvidence | undefined {
    if (typeof json !== 'string' || json.length > 1024) return;
    try {
        const e = JSON.parse(json);
        if (!e || typeof e !== 'object' || Array.isArray(e)) return;
        const { frame, ...common } = e;
        if (!['yield', 'done', 'error'].includes(frame) || Object.hasOwn(common, 'status')) return;
        if (!parseDevelopmentRpcEvidence(JSON.stringify({ ...common, status: 200 }))) return;
        if (frame === 'yield' && e.result !== 'stream' || frame === 'done' && !['value', 'stream'].includes(e.result)) return;
        return e;
    } catch { return; }
}

/** Native body outcome reported separately after request cleanup was attempted. */
export interface DevelopmentNativeEvidence extends Omit<DevelopmentStreamEvidence, 'outcome'> {
    outcome: 'succeeded' | 'failed' | 'cancelled';
}
export function parseDevelopmentNativeEvidence(json: unknown): DevelopmentNativeEvidence | undefined {
    if (typeof json !== 'string' || json.length > 1024) return;
    try {
        const e = JSON.parse(json);
        if (!e || typeof e !== 'object' || Array.isArray(e)) return;
        // Reuse the strict terminal shape, including rejection of unknown fields.
        if (!parseDevelopmentStreamEvidence(JSON.stringify({ ...e, outcome: e.outcome === 'cancelled' ? 'failed' : e.outcome }))) return;
        return e;
    } catch { return; }
}
