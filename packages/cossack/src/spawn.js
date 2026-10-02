import { spawn } from 'node:child_process';

/**
 * Spawn a command inheriting stdio. Resolves with the exit code.
 * Uses shell:true so `vite`/`wrangler`/`cossack` resolve from node_modules/.bin.
 */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: opts.stdio ?? 'inherit',
      shell: opts.shell ?? process.platform === 'win32',
      cwd: opts.cwd || process.cwd(),
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`  error  ${cmd}: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Run a command with captured output for machine-readable callers: stdout and
 * stderr never mix with CLI result envelopes. Resolves with the exit code and
 * both streams.
 */
export function runCaptured(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: opts.shell ?? process.platform === 'win32',
      cwd: opts.cwd || process.cwd(),
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { if (!opts.discardOutput) stdout += chunk; });
    child.stderr.on('data', chunk => { if (!opts.discardOutput) stderr += chunk; });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` }));
  });
}
