// Isolate application/ORM logs from the CLI's machine-readable event stream.
import { pathToFileURL } from 'node:url';

const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
process.once('disconnect', () => abort.abort());

try {
  const { entry, options } = JSON.parse(process.argv[2]);
  const module = await import(pathToFileURL(entry).href);
  if (typeof module.runStudio !== 'function') throw new Error('Missing runStudio export');
  await module.runStudio({ ...options, open: false, quiet: true, signal: abort.signal,
    onReady: (info) => process.send?.({ event: 'ready', origin: info.origin, remote: info.remote === true }),
  });
  process.exitCode = 0;
} catch {
  // Project code may include credentials in thrown messages or stacks.
  process.send?.({ event: 'failed' });
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
