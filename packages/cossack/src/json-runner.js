import { setResultSink, writeResult } from './output.js';

// Flush messages before exit; stdout/stderr (including inherited subprocess logs)
// belong to the isolated process and are never the machine protocol.
let pending = Promise.resolve();
setResultSink(result => {
  pending = pending.then(() => new Promise(resolve => {
    if (!process.connected) return resolve();
    process.send({ type: 'cossack-result', result }, () => resolve());
  }));
});
process.once('message', async ({ argv }) => {
  let exitCode;
  try {
    const { dispatch } = await import('./dispatch.js');
    exitCode = await dispatch(argv);
  } catch {
    writeResult(argv[0]?.split(':')[0] ?? 'cossack', { ok: false, diagnostics: [{
      code: 'COSSACK_COMMAND_FAILED', severity: 'error',
      message: 'Command execution failed. Run without --json for diagnostics.',
    }] });
    exitCode = 1;
  }
  await pending;
  process.exit(exitCode ?? 0);
});
process.once('disconnect', () => process.exit(1));
