import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = ['event', 'requestId', 'route', 'action', 'runtime', 'durationMs', 'stage', 'code'];
const failureCodes = new Set(['COSSACK_API_INTERNAL', 'COSSACK_SSR_INTERNAL', 'COSSACK_SSR_CLEANUP_FAILED', 'COSSACK_REQUEST_INTERNAL', 'COSSACK_RPC_INTERNAL_ERROR', 'COSSACK_RPC_CLEANUP_FAILED']);
const stages = new Set(['input', 'authorize', 'handler', 'output', 'render', 'component-cleanup', 'service-cleanup', 'middleware', 'action', 'request', 'stream', 'response-stream', 'cleanup', 'response-cleanup', 'coordinator-action', 'coordinator-cancellation', 'coordinator-stream']);
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function decodeMessage(message) {
  if (object(message)) return message;
  if (typeof message !== 'string') return undefined;
  try { const parsed = JSON.parse(message); return object(parsed) ? parsed : undefined; } catch { return undefined; }
}

/** Validate raw provider evidence. This never maps a stack locally or replaces missing metrics. */
export function verifyHostedObservability(evidence) {
  const missing = [];
  const require = (ok, criterion) => { if (!ok) missing.push(criterion); };
  const request = evidence?.request ?? {};
  const deployment = evidence?.deployment ?? {};
  const records = Array.isArray(evidence?.tailRecords) ? evidence.tailRecords : [];
  const workerRecords = records.filter(record => object(record) && typeof deployment.workerName === 'string' && deployment.workerName.length > 0 && record.scriptName === deployment.workerName);
  require(workerRecords.length > 0, 'Provider tail records identifying the deployed Worker');
  require(request.status === 500 && typeof request.requestId === 'string' && uuid.test(request.requestId) && (typeof request.body === 'string' || object(request.body)), 'Failed HTTP response with caller-visible UUID request ID');
  const events = workerRecords.flatMap(record => (Array.isArray(record.logs) ? record.logs : []).flatMap(log => {
    const messages = Array.isArray(log.message) ? log.message : [log.message];
    return messages.map(decodeMessage).filter(event => typeof event?.event === 'string' && /^cossack\.(api|ssr|request|rpc)\.failure$/.test(event.event));
  }));
  const correlated = events.filter(event => event.requestId === request.requestId);
  require(correlated.length > 0, 'Provider-delivered structured failure event matching returned request ID');
  const isSafeFailure = event =>
    keys.every(key => Object.hasOwn(event, key)) && Object.keys(event).every(key => keys.includes(key)) &&
    uuid.test(event.requestId) && Number.isFinite(event.durationMs) && event.durationMs >= 0 &&
    failureCodes.has(event.code) && stages.has(event.stage) &&
    ['route', 'action', 'runtime'].every(key => typeof request[`expected${key[0].toUpperCase()}${key.slice(1)}`] === 'string' && event[key] === request[`expected${key[0].toUpperCase()}${key.slice(1)}`]) &&
    event.route.length <= 160 && event.action.length <= 80 && event.runtime.length <= 40 &&
    [event.route, event.action, event.runtime].every(value => /^[a-zA-Z0-9_.$/\[\]:*-]+$/.test(value));
  require(correlated.length > 0 && correlated.every(isSafeFailure),
    'Exact safe failure-event fields, expected route/action/runtime, fixed code/stage and finite nonnegative duration');
  const secrets = Array.isArray(evidence?.sensitiveValues) ? evidence.sensitiveValues : [];
  // Workers Logs adds `level` to source; all other source fields must remain the exact safe event.
  // Tail delivery alone does not prove durable provider ingestion.
  const persisted = evidence?.persistedEvidence;
  const persistedRecords = Array.isArray(persisted?.events?.events) ? persisted.events.events : [];
  const stored = persistedRecords.filter(record => record?.dataset === 'cloudflare-workers' &&
    record?.$workers?.scriptName === deployment.workerName && record.$workers.truncated === false &&
    record?.$metadata?.type === 'cf-worker' && typeof record.$metadata.id === 'string' && record.$metadata.id.length > 0 &&
    Number.isFinite(record.timestamp) && record.timestamp >= persisted?.run?.timeframe?.from && record.timestamp <= persisted?.run?.timeframe?.to &&
    object(record.source) && record.source.level === 'error' && record.source.requestId === request.requestId);
  const storedEvents = stored.map(record => {
    const { level: _providerLevel, ...event } = record.source;
    return event;
  });
  const providerIngested = persisted?.run?.status === 'COMPLETED' && persisted.run.dry === false && storedEvents.length > 0 &&
    storedEvents.every(event => isSafeFailure(event) && correlated.some(tailEvent => keys.every(key => tailEvent[key] === event[key])));
  require(providerIngested, 'Persisted Workers Logs completed nondry query with owned Worker, matching UUID, exact safe event and provider record identity');
  const safeOutputs = JSON.stringify({ events, storedEvents, response: request.body });
  require(secrets.length > 0 && secrets.every(value => typeof value === 'string' && value.length > 0 && !safeOutputs.includes(value)), 'Sensitive-value redaction in framework events and public failure response');
  // Raw tail envelopes may contain private provider metadata; retain them privately, not as public events.
  const startup = typeof deployment.stdout === 'string' ? /\bWorker Startup Time:\s*(\d+(?:\.\d+)?)\s*ms\b/i.exec(deployment.stdout) : null;
  const startupMs = startup ? Number(startup[1]) : undefined;
  require(startupMs !== undefined && Number.isFinite(startupMs) && startupMs >= 0, 'Native deployment provider Worker Startup Time measurement');
  const map = evidence?.sourceMap ?? {};
  const authoredPath = typeof map.authoredPath === 'string' ? map.authoredPath : '';
  const authoredLine = map.authoredLine;
  const exceptions = workerRecords.flatMap(record => Array.isArray(record.exceptions) ? record.exceptions : []);
  const remapped = authoredPath.length > 0 && Number.isInteger(authoredLine) && authoredLine > 0 && typeof map.exceptionMessage === 'string' && map.exceptionMessage.length > 0 && exceptions.some(exception => {
    if (exception.message !== map.exceptionMessage || typeof exception.stack !== 'string') return false;
    return exception.stack.split('\n').some(line => {
      const location = /(?:^|[ (])([^\s()]+):(\d+):(\d+)\)?\s*$/.exec(line);
      if (!location) return false;
      const actualPath = location[1].replaceAll('\\', '/');
      const expectedPath = authoredPath.replaceAll('\\', '/');
      return (actualPath === expectedPath || actualPath.endsWith(`/${expectedPath}`)) && Number(location[2]) === authoredLine &&
        (typeof map.generatedPath !== 'string' || location[1] !== map.generatedPath);
    });
  });
  require(remapped, 'Provider-delivered exception stack remapped to expected authored source line (upload/local mapping is insufficient)');
  return { passed: missing.length === 0, missing, requestId: uuid.test(request.requestId ?? '') ? request.requestId : undefined,
    providerStartupMs: startupMs, correlatedFailureEvents: correlated.length, persistedFailureEvents: storedEvents.length, providerIngested: Boolean(providerIngested), providerRemappedStack: Boolean(remapped) };
}

export async function verifyHostedObservabilityFile(file) {
  const evidence = JSON.parse(await fs.readFile(file, 'utf8'));
  return verifyHostedObservability(evidence);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node cloudflare-hosted-observability.js <private-evidence.json>');
  const result = await verifyHostedObservabilityFile(process.argv[2]);
  // Only bounded results are public; never print evidence, tokens, response body or exception text.
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
