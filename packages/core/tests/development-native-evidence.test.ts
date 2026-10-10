import { afterEach, expect, it, vi } from 'vitest';
import { beginDevelopmentRpcTrace, recordDevelopmentNativeEvidence, startDevelopmentTrace, type DevelopmentTraceSession } from '../src/shared/development-trace';
import { parseDevelopmentNativeEvidence } from '../src/shared/development-rpc-evidence';
let capture: DevelopmentTraceSession | undefined;
afterEach(() => { capture?.stop(); vi.unstubAllEnvs(); });
function fixture() {
    const requestId = crypto.randomUUID(), dispatchId = crypto.randomUUID();
    const call = beginDevelopmentRpcTrace({}, 'http', requestId)!;
    const terminal = { schemaVersion: 1, callId: call.callId, requestId, dispatchId, finishedAt: 10, outcome: 'succeeded', cleanup: 'completed' };
    const headers = () => call.server(new Response('', { headers: { 'X-Cossack-Development-Trace': JSON.stringify({
        schemaVersion: 1, callId: call.callId, requestId, dispatchId, receivedAt: 1, invokedAt: 2, returnedAt: 3, respondedAt: 4, result: 'native', status: 200,
    }) } }));
    return { call, terminal, headers };
}
it.each(['before-headers', 'after-finish'] as const)('joins native evidence %s without inferring completion from client events', when => {
    capture = startDevelopmentTrace(); const { call, terminal, headers } = fixture();
    if (when === 'before-headers') recordDevelopmentNativeEvidence(JSON.stringify(terminal));
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toEqual([]);
    headers(); call.finish('succeeded'); recordDevelopmentNativeEvidence(JSON.stringify(terminal)); recordDevelopmentNativeEvidence(JSON.stringify(terminal));
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toMatchObject([{ ...terminal, phase: 'finish' }]);
    expect(capture.snapshot().events.filter(e => e.kind === 'rpc' && e.phase === 'finish')).toHaveLength(1);
});
it('rejects wrong correlation, payloads and contradictory completion records', () => {
    capture = startDevelopmentTrace(); const { terminal, headers } = fixture(); headers();
    for (const patch of [{ callId: crypto.randomUUID() }, { requestId: crypto.randomUUID() }, { dispatchId: crypto.randomUUID() }, { payload: 'private' }, { cleanup: 'failed' }, { outcome: 'invented' }, { finishedAt: -1 }]) {
        recordDevelopmentNativeEvidence(JSON.stringify({ ...terminal, ...patch }));
    }
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toEqual([]);
    recordDevelopmentNativeEvidence(JSON.stringify({ ...terminal, outcome: 'cancelled', cleanup: 'failed' }));
    expect(capture.snapshot().events.at(-1)).toMatchObject({ kind: 'server-native', outcome: 'cancelled', cleanup: 'failed' });
    expect(parseDevelopmentNativeEvidence('x'.repeat(1025))).toBeUndefined();
    expect(parseDevelopmentNativeEvidence(terminal)).toBeUndefined();
});
it('keeps stopped or replaced calls out of the new capture', () => {
    const old = capture = startDevelopmentTrace(); const { terminal, headers } = fixture(); headers(); old.stop();
    const snapshot = old.snapshot(); capture = startDevelopmentTrace(); recordDevelopmentNativeEvidence(JSON.stringify(terminal));
    expect(old.snapshot().events).toEqual(snapshot.events); expect(capture.snapshot().events).toEqual([]);
});
it('bounds pending correlations and never resurrects an evicted call', () => {
    capture = startDevelopmentTrace({ capacity: 2048 }); const first = fixture();
    recordDevelopmentNativeEvidence(JSON.stringify(first.terminal));
    for (let i = 0; i < 256; i++) fixture();
    first.headers(); recordDevelopmentNativeEvidence(JSON.stringify(first.terminal));
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toEqual([]);
});
it('does not collect native evidence in production', () => {
    capture = startDevelopmentTrace(); const { terminal, headers } = fixture(); headers(); vi.stubEnv('DEV', false);
    recordDevelopmentNativeEvidence(JSON.stringify(terminal));
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toEqual([]);
});
it('keeps server cleanup failure separate from an already successful client result', () => {
    capture = startDevelopmentTrace(); const { call, terminal, headers } = fixture(); headers(); call.finish('succeeded');
    recordDevelopmentNativeEvidence(JSON.stringify({ ...terminal, outcome: 'failed', cleanup: 'failed' }));
    expect(capture.snapshot().events.filter(e => e.kind === 'rpc' && e.phase === 'finish')).toMatchObject([{ outcome: 'succeeded' }]);
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toMatchObject([{ outcome: 'failed', cleanup: 'failed' }]);
});
it('joins an early bodyless terminal after the server assigns a different wire request ID', () => {
    capture = startDevelopmentTrace();
    const call = beginDevelopmentRpcTrace({}, 'http', crypto.randomUUID())!;
    const requestId = crypto.randomUUID(), dispatchId = crypto.randomUUID();
    recordDevelopmentNativeEvidence(JSON.stringify({ schemaVersion: 1, callId: call.callId, requestId, dispatchId,
        finishedAt: 3, outcome: 'succeeded', cleanup: 'completed' }));
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toEqual([]);
    call.response(requestId);
    call.server(new Response(null, { status: 204, headers: { 'X-Cossack-Development-Trace': JSON.stringify({
        schemaVersion: 1, callId: call.callId, requestId, dispatchId, receivedAt: 1, invokedAt: 1, returnedAt: 2, respondedAt: 4, result: 'native', status: 204,
    }) } }));
    expect(capture.snapshot().events.filter(e => e.kind === 'server-native')).toMatchObject([{ requestId, dispatchId, outcome: 'succeeded' }]);
});
