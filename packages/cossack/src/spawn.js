import { spawn } from 'node:child_process';

/**
 * Spawn a command inheriting stdio. Resolves with the exit code.
 * Uses shell:true so `vite`/`wrangler`/`cossack` resolve from node_modules/.bin.
 */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: opts.shell ?? process.platform === 'win32',
      cwd: opts.cwd || process.cwd(),
      env: process.env,
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`  error  ${cmd}: ${err.message}`);
      resolve(1);
    });
  });
}
