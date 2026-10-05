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
    let capturedBytes = 0;
    let outputTruncated = false;
    const capture = (chunk, stream) => {
      if (opts.discardOutput || outputTruncated) return;
      capturedBytes += chunk.length;
      if (opts.maxOutputBytes && capturedBytes > opts.maxOutputBytes) {
        outputTruncated = true;
        child.kill('SIGTERM');
        return;
      }
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on('data', chunk => capture(chunk, 'stdout'));
    child.stderr.on('data', chunk => capture(chunk, 'stderr'));
    child.on('close', (code) => resolve({ code: outputTruncated ? 1 : code ?? 1, stdout, stderr,
      ...(outputTruncated ? { outputTruncated: true } : {}) }));
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` }));
  });
}
