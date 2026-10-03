import { parentPort, workerData } from 'node:worker_threads';
import { inspectProject } from '../inspection-service.js';
import { diagnosticCode, diagnosticMessage } from '../output.js';

try {
  parentPort.postMessage(await inspectProject(workerData.root, workerData.input));
} catch (error) {
  const code = diagnosticCode(error, 'COSSACK_INSPECTION_FAILED');
  parentPort.postMessage({ ok: false, data: null,
    diagnostics: [{ code, severity: 'error', message: diagnosticMessage(error, code) }] });
}
