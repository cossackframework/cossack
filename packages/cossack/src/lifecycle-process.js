import { spawn } from 'node:child_process';
import { writeResult } from './output.js';

/**
 * started confirms process creation, not HTTP readiness. Only framework-owned
 * metadata is emitted; child stdout/stderr and argv never enter the protocol.
 */
export function runLifecycle(command, executable, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(executable, args, {
      cwd: options.cwd ?? process.cwd(), env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ['ignore', 'ignore', 'ignore'], shell: process.platform === 'win32' && executable !== process.execPath,
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
      writeResult(command, { data: { event: 'started', pid: child.pid, ...(options.metadata ?? {}) } });
      if (stopping) child.kill('SIGTERM');
    });
    child.once('error', () => { /* close supplies the terminal diagnostic. */ });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      // Vite performs cleanup and exits with 128 + SIGTERM instead of being
      // terminated by the signal. Accept that code only after our own stop.
      const ok = !forced && (code === 0 || stopping && (signal === 'SIGTERM' || code === 143));
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
