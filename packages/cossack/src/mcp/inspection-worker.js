import { readDevelopmentTraces } from '@cossackframework/framework/development-traces';
import { readTestResults } from '../test-results-service.js';
import { readDocumentation } from '../documentation-service.js';
import { parentPort, workerData } from 'node:worker_threads';
import { inspectProject } from '../inspection-service.js';
import { diagnosticCode, diagnosticMessage } from '../output.js';

try {
  parentPort.postMessage(await (workerData.input.operation === 'traces' ? readDevelopmentTraces(workerData.root, workerData.input) : workerData.input.operation === 'test-results' ? readTestResults(workerData.root, workerData.input) : workerData.input.operation === 'documentation' ? readDocumentation(workerData.root, workerData.input) : inspectProject(workerData.root, workerData.input)));
} catch (error) {
  const code = diagnosticCode(error, 'COSSACK_INSPECTION_FAILED');
  parentPort.postMessage({ ok: false, data: null,
    diagnostics: [{ code, severity: 'error', message: diagnosticMessage(error, code) }] });
}
