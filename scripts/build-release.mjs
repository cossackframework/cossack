import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const repository = fileURLToPath(new URL('../', import.meta.url));
const stages = [
  ['renderer', 'build'],
  ['typescript-plugin', 'build'],
  ['core', 'build'],
  ['ui', 'build'],
  ['database', 'build'],
  ['auth', 'build'],
  // Preserve the root build's library declaration stage, not the demo Worker.
  ['framework', 'build:types'],
  ['node-adapter', 'build'],
  ['test-utils', 'build'],
  ['studio', 'build'],
];

/** Pure release plan. Auth currently publishes source; use its build if added. */
export function createReleaseBuildPlan(manifests) {
  return stages.flatMap(([directory, script]) => {
    const manifest = manifests[directory];
    if (!manifest || typeof manifest.name !== 'string') throw new Error(`Missing release package manifest: ${directory}`);
    if (typeof manifest.scripts?.[script] !== 'string') {
      if (directory === 'auth') return [];
      throw new Error(`Missing release build script: ${directory}/${script}`);
    }
    return [{ directory, packageName: manifest.name, script }];
  });
}

/** Inherit real native build output and wait for each package before proceeding. */
export function runBuildCommand(command, args, { cwd }) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', () => resolve(1));
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function buildRelease({ root = repository, manifests, runner = runBuildCommand, log = console.log } = {}) {
  if (!manifests) {
    manifests = Object.fromEntries(await Promise.all(stages.map(async ([directory]) => [
      directory, JSON.parse(await fs.readFile(path.join(root, 'packages', directory, 'package.json'), 'utf8')),
    ])));
  }
  const plan = createReleaseBuildPlan(manifests);
  log('Desktop build excluded by the release waiver; not reported as passed.');
  if (!plan.some(stage => stage.directory === 'auth')) log('Auth has no build script; its published source is checked by the release typecheck.');
  for (const stage of plan) {
    log(`Building ${stage.packageName} (${stage.script})`);
    const code = await runner('pnpm', ['--filter', stage.packageName, 'run', stage.script], { cwd: root });
    if (!Number.isInteger(code) || code < 0 || code > 255) return 1;
    if (code !== 0) return code;
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node scripts/build-release.mjs');
    process.exitCode = await buildRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release build failed.');
    process.exitCode = 1;
  }
}
