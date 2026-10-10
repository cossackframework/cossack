import { execFile, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeResult } from './output.js';
import { commandSpecs } from './command-specs.js';

const EVENTS = new Set(['dev', 'start', 'studio']);
const MAX_TIMEOUT = 86_400_000;

/** Own the command process and its machine protocol, never raw project stdio. */
export function runJSONCommand(argv) {
  const raw = argv[0] ?? 'cossack';
  const head = raw.split(':')[0];
  const command = Object.values(commandSpecs).find(spec => spec.name === head || spec.aliases.includes(head))?.name
    ?? (['--version', '-V'].includes(raw) ? 'version' : ['--help', '-h', 'help', 'h'].includes(raw) ? 'cossack' : raw);
  const requested = process.env.COSSACK_COMMAND_TIMEOUT_MS;
  const timeout = requested === undefined ? 300_000 : Number(requested);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT) {
    writeResult(command, { ok: false, diagnostics: [{
      code: 'COSSACK_TIMEOUT_INVALID', severity: 'error',
      message: 'COSSACK_COMMAND_TIMEOUT_MS must be an integer between 1 and 86400000.',
    }] });
    return Promise.resolve(1);
  }
  return new Promise(resolve => {
    const child = fork(fileURLToPath(new URL('./json-runner.js', import.meta.url)), [], {
      cwd: process.cwd(), stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: [], detached: process.platform !== 'win32',
    });
    let terminal, badProtocol = false, deadlineExpired = false, interrupted = false, shutdownExpired = false;
    let killTimer;
    const killGroup = () => {
      try {
        if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true }, () => { try { child.kill('SIGKILL'); } catch { /* Already closed. */ } });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* The group may already have closed. */ }
    };
    const stop = () => {
      if (interrupted) { killGroup(); return; }
      interrupted = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { shutdownExpired = true; killGroup(); }, 5000);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    // Finite commands have a wall deadline. Event commands have a startup deadline;
    // their supervised lifecycle may then continue until explicitly stopped.
    // Studio owns its configurable readiness timer (up to five minutes).
    // Its outer bound must not silently shorten an explicit --timeout.
    const startupLimit = command === 'studio' ? 300_000 : 30_000;
    const timer = setTimeout(() => { deadlineExpired = true; killGroup(); }, EVENTS.has(command) ? Math.min(timeout, startupLimit) : timeout);
    child.on('message', message => {
      if (deadlineExpired || badProtocol || message?.type !== 'cossack-result') return;
      const result = message.result;
      const valid = result?.schemaVersion === 1 && result.command === command &&
        typeof result.ok === 'boolean' && Array.isArray(result.diagnostics) &&
        result.diagnostics.every(d => typeof d?.code === 'string' && ['error', 'warning', 'info'].includes(d.severity) && typeof d.message === 'string');
      if (!valid || terminal) { badProtocol = true; killGroup(); return; }
      const event = result.data?.event;
      const ongoing = EVENTS.has(command) && ['started', 'ready'].includes(event);
      if (!ongoing) terminal = result;
      else clearTimeout(timer);
      // Reformat only validated envelopes; child console/process output is discarded.
      if (ongoing) writeResult(result.command, result);
    });
    child.once('error', () => { badProtocol = true; });
    child.once('close', code => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      killGroup(); // Also reclaim subprocess descendants left by project code.
      const validExit = terminal && Number.isInteger(code) && (terminal.ok ? code === 0 : code !== 0);
      if (!badProtocol && !deadlineExpired && validExit) {
        writeResult(terminal.command, terminal);
        return resolve(code);
      }
      writeResult(command, { ok: false, data: EVENTS.has(command) ? { event: 'failed' } : null, diagnostics: [{
        code: deadlineExpired ? 'COSSACK_COMMAND_TIMEOUT' : shutdownExpired ? 'COSSACK_COMMAND_SHUTDOWN_TIMEOUT'
          : interrupted ? 'COSSACK_COMMAND_ABORTED' : 'COSSACK_COMMAND_PROCESS_FAILED',
        severity: 'error', message: deadlineExpired ? 'Command exceeded its execution/startup deadline.'
          : shutdownExpired ? 'Command did not stop before the shutdown deadline.'
          : interrupted ? 'Command stopped before reporting completion.'
          : 'Command process exited without a valid terminal result. Run without --json for diagnostics.',
      }] });
      resolve(interrupted && !shutdownExpired ? 130 : 1);
    });
    child.send({ argv }, error => { if (error) { badProtocol = true; killGroup(); } });
  }).catch(() => {
    writeResult(command, { ok: false, diagnostics: [{ code: 'COSSACK_COMMAND_PROCESS_FAILED', severity: 'error',
      message: 'Could not start the command process. Check the CLI installation and working directory.' }] });
    return 1;
  });
}
