import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.COSSACK_DENO_BINARY || 'deno';
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, COSSACK_DENO_BINARY: binary },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

try {
  run(binary, ['--version']);
} catch (error) {
  throw new Error('Deno acceptance requires Deno on PATH or COSSACK_DENO_BINARY set to its executable.', { cause: error });
}
// Build dependencies, then verify the actual installed packages in Deno.
run(process.execPath, ['scripts/test-local-scaffold.mjs', '--deno-runtime-only']);
run(binary, ['test', '--allow-env', '--allow-net', '--allow-read', 'packages/deno-adapter/tests/deno-smoke.test.ts']);
run('pnpm', ['--filter', 'cossack', 'exec', 'vitest', 'run', 'tests/generated-runtime-build.test.js', '-t', 'executes a generated Deno application|serves generated Deno development']);
