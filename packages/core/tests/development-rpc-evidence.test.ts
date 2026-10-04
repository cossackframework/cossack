import { afterEach, expect, it } from 'vitest';
import { beginDevelopmentRpcTrace, beginDevelopmentServiceRpcTrace, startDevelopmentTrace, type DevelopmentTraceSession } from '../src/shared/development-trace';
import { DEVELOPMENT_RPC_HEADER, parseDevelopmentRpcEvidence, type DevelopmentRpcEvidence } from '../src/shared/development-rpc-evidence';
let capture: DevelopmentTraceSession | undefined;
afterEach(() => capture?.stop());
const evidence = (): DevelopmentRpcEvidence => ({ schemaVersion: 1, callId: crypto.randomUUID(), requestId: crypto.randomUUID(), dispatchId: crypto.randomUUID(),
    receivedAt: 10, invokedAt: 11, returnedAt: 12, respondedAt: 13, result: 'value', status: 200 });
it.each(['component', 'service'] as const)('joins %s server evidence to its client call without duplicating it', kind => {
    capture = startDevelopmentTrace(); const value = evidence();
    const trace = kind === 'component' ? beginDevelopmentRpcTrace({}, 'http', value.requestId)! : beginDevelopmentServiceRpcTrace({}, value.requestId)!;
    value.callId = trace.requestHeaders[DEVELOPMENT_RPC_HEADER];
    trace.response(value.requestId);
    const response = new Response(null, { headers: { [DEVELOPMENT_RPC_HEADER]: JSON.stringify(value) } });
    trace.server(response); trace.server(response); trace.state(); trace.finish('succeeded');
    const events = capture.snapshot().events;
    expect(events.map(e => e.kind)).toEqual([kind === 'component' ? 'rpc' : 'service-rpc', kind === 'component' ? 'rpc' : 'service-rpc', 'server-rpc', kind === 'component' ? 'rpc' : 'service-rpc', kind === 'component' ? 'rpc' : 'service-rpc']);
    expect(events[2]).toMatchObject({ ...value, phase: 'response' });
    expect(events.map(e => e.sequence)).toEqual([1, 2, 3, 4, 5]);
});
it('rejects malformed, uncorrelated, extra-field and mismatched-status server evidence', () => {
    capture = startDevelopmentTrace(); const value = evidence(); const trace = beginDevelopmentRpcTrace({}, 'http', value.requestId)!;
    value.callId = trace.requestHeaders[DEVELOPMENT_RPC_HEADER];
    for (const bad of [{...value, callId: crypto.randomUUID()}, {...value, requestId: crypto.randomUUID()}, {...value, status: 403}, {...value, arguments: ['secret']}, {...value, result: 'stream', returnedAt: null}]) {
        trace.server(new Response(null, {headers:{[DEVELOPMENT_RPC_HEADER]:JSON.stringify(bad)}}));
    }
    expect(capture.snapshot().events.every(e=>e.kind!=='server-rpc')).toBe(true);
    for (const bad of ['x', '{}', ' '.repeat(1025), JSON.stringify({...value, dispatchId: 'private path'})]) expect(parseDevelopmentRpcEvidence(bad)).toBeUndefined();
});
it('keeps evidence with its original capture and ignores a stopped owner', () => {
    const first = capture = startDevelopmentTrace(), value = evidence(); const trace = beginDevelopmentRpcTrace({}, 'http', value.requestId)!;
    value.callId = trace.requestHeaders[DEVELOPMENT_RPC_HEADER];
    capture = startDevelopmentTrace(); trace.server(new Response(null,{headers:{[DEVELOPMENT_RPC_HEADER]:JSON.stringify(value)}}));
    expect(first.snapshot().events).toHaveLength(1); expect(capture.snapshot().events).toEqual([]);
});

it.each(['succeeded', 'failed'] as const)('joins one %s stream terminal to its dispatch and excludes mismatched evidence', outcome => {
    capture = startDevelopmentTrace(); const responseEvidence = evidence(); responseEvidence.result = 'stream';
    const trace = beginDevelopmentRpcTrace({}, 'http', responseEvidence.requestId)!;
    responseEvidence.callId = trace.requestHeaders[DEVELOPMENT_RPC_HEADER];
    trace.server(new Response(null, {headers:{[DEVELOPMENT_RPC_HEADER]:JSON.stringify(responseEvidence)}}));
    const value = {schemaVersion:1, callId:responseEvidence.callId, requestId:responseEvidence.requestId, dispatchId:responseEvidence.dispatchId,
        finishedAt:50, outcome, cleanup:'completed'};
    const frame = {type:outcome === 'succeeded' ? 'done' : 'error', requestId:value.requestId};
    for (const bad of [{...value, dispatchId:crypto.randomUUID()}, {...value, callId:crypto.randomUUID()}, {...value, requestId:crypto.randomUUID()}, {...value, secret:'private'}]) trace.stream({...frame, developmentTrace:JSON.stringify(bad)});
    trace.stream({...frame, type:'yield', developmentTrace:JSON.stringify(value)});
    expect(capture.snapshot().events).toHaveLength(2);
    trace.stream({...frame, developmentTrace:JSON.stringify(value)}); trace.stream({...frame, developmentTrace:JSON.stringify(value)});
    expect(capture.snapshot().events).toHaveLength(3);
    expect(capture.snapshot().events[2]).toMatchObject({...value,kind:'server-stream',phase:'finish'});
});
it('ignores stream evidence without a matching dispatch record or after capture stops', () => {
    capture = startDevelopmentTrace(); const value = evidence(), trace = beginDevelopmentServiceRpcTrace({},value.requestId)!;
    value.callId = trace.requestHeaders[DEVELOPMENT_RPC_HEADER]; value.result = 'stream';
    const frame = {type:'done',requestId:value.requestId,developmentTrace:JSON.stringify({schemaVersion:1,callId:value.callId,requestId:value.requestId,dispatchId:value.dispatchId,finishedAt:20,outcome:'succeeded',cleanup:'completed'})};
    trace.stream(frame); expect(capture.snapshot().events).toHaveLength(1);
    trace.server(new Response(null,{headers:{[DEVELOPMENT_RPC_HEADER]:JSON.stringify(value)}}));
    capture.stop(); trace.stream(frame); expect(capture.snapshot().events).toHaveLength(2);
});
