import { describe, expect, it } from 'vitest';
import { verifyHostedObservability } from './fixtures/cloudflare-hosted-observability.js';

function evidence() {
  const requestId = 'ec8a9030-2a48-4049-bfb1-48638f9b0f0b';
  const data = {
    request: { status: 500, requestId, body: { code: 'COSSACK_API_INTERNAL', requestId }, expectedRoute: '/api/acceptance-exception', expectedAction: 'POST', expectedRuntime: 'cloudflare' },
    deployment: { workerName: 'owned-test-worker', stdout: 'Uploaded owned-test-worker (2.10 sec)\nWorker Startup Time: 8.12 ms\n' },
    sensitiveValues: ['PRIVATE_HOSTED_API_EXCEPTION', 'PRIVATE_ACCEPTANCE_TOKEN'],
    tailRecords: [{ scriptName: 'owned-test-worker', event: { request: { headers: { secret: 'PRIVATE_ACCEPTANCE_TOKEN' } } }, logs: [{ message: [JSON.stringify({ event: 'cossack.api.failure', requestId, route: '/api/acceptance-exception', action: 'POST', runtime: 'cloudflare', durationMs: 2, stage: 'handler', code: 'COSSACK_API_INTERNAL' })] }], exceptions: [{ message: 'source-map-probe', stack: 'Error: source-map-probe\n    at probe (src/map-probe.ts:12:9)' }] }],
    sourceMap: { authoredPath: 'src/map-probe.ts', authoredLine: 12, generatedPath: 'index.js', exceptionMessage: 'source-map-probe' },
  };
  data.persistedEvidence = { run: { status: 'COMPLETED', dry: false, timeframe: { from: 100, to: 200 } }, events: { events: [{
    dataset: 'cloudflare-workers', timestamp: 150, source: { level: 'error', ...JSON.parse(data.tailRecords[0].logs[0].message[0]) },
    $workers: { scriptName: data.deployment.workerName, truncated: false }, $metadata: { id: 'provider-record-id', type: 'cf-worker' },
  }] } };
  return data;
}
function event(data) { return JSON.parse(data.tailRecords[0].logs[0].message[0]); }
function replaceEvent(data, value) { data.tailRecords[0].logs[0].message = [value]; }
describe('hosted observability evidence assertions', () => {
  it('accepts provider events, deployment startup metric and directly remapped stack', () => {
    expect(verifyHostedObservability(evidence())).toMatchObject({ passed: true, missing: [], providerStartupMs: 8.12, providerRemappedStack: true });
  });
  it('supports raw object console messages without treating private provider envelope as framework output', () => {
    const data = evidence(); replaceEvent(data, event(data));
    expect(verifyHostedObservability(data).passed).toBe(true);
  });
  it('reports all exact missing criteria with absent raw evidence', () => {
    expect(verifyHostedObservability({}).missing).toHaveLength(8);
    expect(verifyHostedObservability({}).passed).toBe(false);
  });
  it('rejects unrelated Worker records and uncorrelated returned IDs', () => {
    const data = evidence(); data.tailRecords[0].scriptName = 'other-worker';
    expect(verifyHostedObservability(data).missing).toContain('Provider tail records identifying the deployed Worker');
    data.tailRecords[0].scriptName = data.deployment.workerName;
    data.request.requestId = '943614ce-3228-4b76-b28d-aeecb236b822';
    expect(verifyHostedObservability(data).correlatedFailureEvents).toBe(0);
  });
  it.each(['durationMs', 'code', 'route', 'payload'])('rejects unsafe event field %s', key => {
    const data = evidence(); const value = event(data);
    value[key] = { durationMs: Infinity, code: 'PRIVATE_HOSTED_API_EXCEPTION', route: '/api/secret?id=123', payload: 'credential' }[key];
    replaceEvent(data, value);
    expect(verifyHostedObservability(data).passed).toBe(false);
  });
  it('rejects sensitive event and response content', () => {
    const data = evidence(); data.request.body.detail = 'PRIVATE_ACCEPTANCE_TOKEN';
    expect(verifyHostedObservability(data).missing).toContain('Sensitive-value redaction in framework events and public failure response');
  });
  it('does not treat local profiling or source-map upload as provider startup/remapping', () => {
    const data = evidence(); data.deployment.stdout = 'localStartupProfileMs: 20\nUploaded sourcemaps';
    data.tailRecords[0].exceptions[0].stack = 'Error: source-map-probe\n    at probe (index.js:12:9)';
    const result = verifyHostedObservability(data);
    expect(result.passed).toBe(false); expect(result.providerStartupMs).toBeUndefined(); expect(result.providerRemappedStack).toBe(false);
  });
  it('rejects a source-path suffix collision', () => {
    const data = evidence(); data.tailRecords[0].exceptions[0].stack = 'at probe (wrong-src/map-probe.ts:12:9)';
    expect(verifyHostedObservability(data).providerRemappedStack).toBe(false);
  });
  it.each(['missing', 'empty', 'dry', 'pending', 'other-worker', 'uncorrelated', 'extra-source', 'wrong-time', 'no-identity', 'conflicting-event'])('rejects invalid persisted ingestion: %s', kind => {
    const data = evidence(); const record = data.persistedEvidence.events.events[0];
    if (kind === 'missing') delete data.persistedEvidence;
    if (kind === 'empty') data.persistedEvidence.events.events = [];
    if (kind === 'dry') data.persistedEvidence.run.dry = true;
    if (kind === 'pending') data.persistedEvidence.run.status = 'PENDING';
    if (kind === 'other-worker') record.$workers.scriptName = 'unowned-worker';
    if (kind === 'uncorrelated') record.source.requestId = '943614ce-3228-4b76-b28d-aeecb236b822';
    if (kind === 'extra-source') record.source.payload = 'arbitrary-data';
    if (kind === 'wrong-time') record.timestamp = 250;
    if (kind === 'no-identity') delete record.$metadata.id;
    if (kind === 'conflicting-event') record.source.durationMs = 99;
    const result = verifyHostedObservability(data);
    expect(result.providerIngested).toBe(false); expect(result.passed).toBe(false);
  });
  it('rejects sensitive persisted framework events', () => {
    const data = evidence(); data.persistedEvidence.events.events[0].source.payload = 'PRIVATE_ACCEPTANCE_TOKEN';
    expect(verifyHostedObservability(data).missing).toContain('Sensitive-value redaction in framework events and public failure response');
  });
  it('rejects wrong authored line or an unrelated exception', () => {
    const data = evidence(); data.sourceMap.authoredLine = 13;
    expect(verifyHostedObservability(data).providerRemappedStack).toBe(false);
    data.sourceMap.authoredLine = 12; data.sourceMap.exceptionMessage = 'different';
    expect(verifyHostedObservability(data).providerRemappedStack).toBe(false);
  });
});
