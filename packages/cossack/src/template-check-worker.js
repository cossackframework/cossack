/**
 * Worker thread for development template diagnostics. The Vite plugin posts
 * `{ files }` (changed files, or none for the first check) and receives every
 * application file's diagnostics, so the dev server never blocks on the
 * TypeScript program.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createTemplateChecker } from './template-check.js';

const checker = createTemplateChecker(workerData.root);

parentPort.on('message', ({ id, files = [] }) => {
  try {
    for (const file of files) checker.update(file);
    parentPort.postMessage({ id, diagnostics: checker.check() });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
