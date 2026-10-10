import { commandSpecs } from '../command-specs.js';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, findProjectRoot, readJsonIfExists } from '../fs-utils.js';
import { resolvePackageVersion, readPackageVersion } from '../pkg.js';
import { detectAdapter } from './start.js';
import { runWithSpec } from '../command-spec.js';

const execFileP = promisify(execFile);
const spec = commandSpecs.info;

export async function infoCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    const pkg = (await readJsonIfExists(path.join(root, 'package.json'))) || {};

    const versions = {};
    for (const name of [
      '@cossackframework/core',
      '@cossackframework/renderer',
      '@cossackframework/framework',
      '@cossackframework/node-adapter',
      '@cossackframework/auth',
      '@cossackframework/database',
      'cossack',
    ]) {
      const v = resolvePackageVersion(name);
      if (v) versions[name] = v;
    }

    const data = {
      cliVersion: readPackageVersion(),
      adapter: await detectAdapter(root),
      lockfile: await detectLockfile(root),
      project: { name: pkg.name || null, version: pkg.version || null },
      platform: { os: `${process.platform} ${process.arch}`, osVersion: os.release(), node: process.version },
      packageManager: {
        npm: await spawnVersion('npm'),
        pnpm: await spawnVersion('pnpm'),
      },
      packages: versions,
    };
    if (ctx.flags.json === true) return data;
    const lines = [
      'Operating System:',
      `  Platform:   ${data.platform.os}`,
      `  OS Version: ${data.platform.osVersion}`,
      '',
      'Binaries:',
      `  Node:    ${data.platform.node}`,
      `  npm:     ${data.packageManager.npm}`,
      `  pnpm:    ${data.packageManager.pnpm}`,
      '',
      'Cossack:',
      `  CLI:         ${data.cliVersion}`,
      `  Adapter:     ${data.adapter}`,
      `  Lockfile:    ${data.lockfile}`,
      `  Project:     ${data.project.name || '(unnamed)'}${data.project.version ? `@${data.project.version}` : ''}`,
      '',
      'Packages:',
      ...Object.entries(data.packages).map(([n, v]) => `  ${n.padEnd(36)} ${v}`),
    ];
    console.log(lines.join('\n'));
    return null;
  });
}

async function detectLockfile(root) {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';
  return '(none)';
}

async function spawnVersion(bin) {
  try {
    const { stdout } = await execFileP(bin, ['--version'], { timeout: 5000 });
    const version = stdout.trim();
    return /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version) ? version : '(unavailable)';
  } catch {
    return '(not installed)';
  }
}

export function infoHelp() {
  return commandSpecs.info.help(`cossack info

Print system/environment details for bug reports.`);
}
