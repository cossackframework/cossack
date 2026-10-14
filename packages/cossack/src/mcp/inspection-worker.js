import { readDevelopmentTraces } from '@cossackframework/framework/development-traces';
import { readTestResults } from '../test-results-service.js';
import { readDocumentation } from '../documentation-service.js';
import { parentPort, workerData } from 'node:worker_threads';
import { inspectProject } from '../inspection-service.js';
import { diagnosticCode, diagnosticMessage } from '../output.js';
import { encodeInspectionResult } from './inspection-result.js';

// The runner reuses this worker for several calls (inspection-runner.js).
// Inspections must read project files on every call and never cache them at
// module level; only dependency modules stay loaded between calls.
const environment = { ...process.env };
function restoreEnvironment() {
  for (const name of Object.keys(process.env)) if (!Object.hasOwn(environment, name)) delete process.env[name];
  Object.assign(process.env, environment);
}

function operate(root, input) {
  if (input.operation === 'traces') return readDevelopmentTraces(root, input);
  if (input.operation === 'test-results') return readTestResults(root, input);
  if (input.operation === 'documentation') return readDocumentation(root, input);
  return inspectProject(root, input);
}

parentPort.on('message', async ({ input }) => {
  restoreEnvironment();
  try {
    parentPort.postMessage(encodeInspectionResult(await operate(workerData.root, input)));
  } catch (error) {
    const code = diagnosticCode(error, 'COSSACK_INSPECTION_FAILED');
    // A thrown inspection may leave dependency state behind; the runner
    // replaces this worker instead of reusing it.
    parentPort.postMessage({ ...encodeInspectionResult({ ok: false, data: null,
      diagnostics: [{ code, severity: 'error', message: diagnosticMessage(error, code) }] }), recycle: true });
  }
});
