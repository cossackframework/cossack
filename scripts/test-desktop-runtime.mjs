import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

if (process.platform !== 'linux') {
  throw new Error(
    'This automated Desktop package gate requires Linux. Windows MSI and macOS DMG require separate native-host acceptance.',
  );
}
// Fail explicitly when native prerequisites are missing; skipped tests are not evidence.
for (const [command, args] of [
  ['Xvfb', ['-help']],
  ['dpkg-deb', ['--version']],
  ['fakeroot', ['--version']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'ignore' });
  if (result.error || result.status !== 0)
    throw new Error(`Desktop acceptance requires ${command} on PATH.`);
}
// Isolate acceptance windows from the user's desktop. The installed test builds
// dependencies first, and exercises the actual packaged public entry points.
run('xvfb-run', [
  '-a',
  process.execPath,
  'scripts/test-local-scaffold.mjs',
  '--desktop-runtime-only',
]);
run(
  'xvfb-run',
  [
    '-a',
    'pnpm',
    '--filter',
    'cossack',
    'exec',
    'vitest',
    'run',
    'tests/generated-runtime-recipes.test.js',
    '-t',
    'executes a generated Desktop application|executes Desktop development',
  ],
  { COSSACK_DESKTOP_ACCEPTANCE: '1' },
);
