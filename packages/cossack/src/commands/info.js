import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, findProjectRoot, readJsonIfExists } from '../fs-utils.js';
import { resolvePackageVersion, readPackageVersion } from '../pkg.js';
import { detectAdapter } from './start.js';

const execFileP = promisify(execFile);

export async function infoCommand(args, ctx) {
  const root = await findProjectRoot(ctx.cwd);
  const pkg = (await readJsonIfExists(path.join(root, 'package.json'))) || {};

  const versions = {};
  for (const name of [
    '@cossackframework/core',
    '@cossackframework/renderer',
    '@cossackframework/framework',
    '@cossackframework/node-adapter',
    '@cossackframework/auth',
    '@cossackframework/orm',
    'cossack',
  ]) {
    const v = resolvePackageVersion(name);
    if (v) versions[name] = v;
  }
  const cliVersion = readPackageVersion();

  const lockfile = await detectLockfile(root);
  const adapter = await detectAdapter(root);

  const lines = [
    'Operating System:',
    `  Platform:   ${process.platform}`,
    `  Arch:       ${process.arch}`,
    `  OS Version: ${os.release()}`,
    '',
    'Binaries:',
    `  Node:    ${process.version}`,
    `  npm:     ${await spawnVersion('npm')}`,
    `  pnpm:    ${await spawnVersion('pnpm')}`,
    '',
    'Cossack:',
    `  CLI:         ${cliVersion}`,
    `  Adapter:     ${adapter}`,
    `  Lockfile:    ${lockfile}`,
    `  Project:     ${pkg.name || '(unnamed)'}${pkg.version ? `@${pkg.version}` : ''}`,
    '',
    'Packages:',
    ...Object.entries(versions).map(([n, v]) => `  ${n.padEnd(36)} ${v}`),
  ];
  console.log(lines.join('\n'));
  return 0;
}

async function detectLockfile(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';
  return '(none)';
}

async function spawnVersion(bin) {
  try {
    const { stdout } = await execFileP(bin, ['--version']);
    return stdout.trim();
  } catch {
    return '(not installed)';
  }
}

export function infoHelp() {
  return `cossack info

Print system/environment details for bug reports.`;
}
