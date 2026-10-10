import { spawn } from 'node:child_process';
import { writeResult } from './output.js';

/**
 * In JSON mode, started confirms process creation, not HTTP readiness. Only
 * framework metadata is emitted; child output and argv never enter the protocol.
 */
export function runLifecycle(command, executable, args, options = {}) {
  return new Promise(resolve => {
    const json = options.json !== false;
    const child = spawn(executable, args, {
      cwd: options.cwd ?? process.cwd(), env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: json ? ['ignore', 'ignore', 'ignore'] : 'inherit', shell: process.platform === 'win32' && executable !== process.execPath,
    });
    let stopping = false, forced = false, timer;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      child.kill('SIGTERM');
      timer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 4500);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('spawn', () => {
      if (json) writeResult(command, { data: { event: 'started', pid: child.pid, ...(options.metadata ?? {}) } });
      if (stopping) child.kill('SIGTERM');
    });
    child.once('error', error => {
      if (!json) console.error(`  error  ${executable}: ${error.message}`);
      // close supplies the machine-readable terminal diagnostic.
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      // Vite may translate signals to exit codes. A terminal Ctrl+C can also
      // reach the child directly. Accept either form only after our own stop.
      const ok = !forced && (code === 0 || stopping &&
        (signal === 'SIGTERM' || signal === 'SIGINT' || code === 143 || code === 130));
      if (!json && forced) console.error('The server did not stop before the shutdown deadline.');
      resolve({ exitCode: ok ? 0 : 1, data: {
        event: ok ? 'stopped' : 'failed', exitCode: code, signal,
        reason: stopping ? 'requested' : 'process-exit', ...(options.metadata ?? {}),
      }, diagnostics: ok ? [] : [{
        code: forced ? 'COSSACK_COMMAND_SHUTDOWN_TIMEOUT' : 'COSSACK_' + command.toUpperCase() + '_FAILED',
        severity: 'error', message: forced ? 'The server did not stop before the shutdown deadline.'
          : 'The server process failed. Run without --json for diagnostics.',
      }] });
    });
  });
}
