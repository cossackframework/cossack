import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageDirectories = [
  'renderer',
  'core',
  'node-adapter',
  'auth',
  'database',
  'ui',
  'framework',
  'scaffold',
  'cossack',
];

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: repositoryRoot,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function buildPublishablePackages() {
  await run('pnpm', ['--filter', '@cossackframework/renderer', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/core', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/node-adapter', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/ui', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/framework', 'build:types']);
}

async function packPackages(destination) {
  const tarballs = new Map();
  for (const directory of packageDirectories) {
    const packageRoot = path.join(repositoryRoot, 'packages', directory);
    const pkg = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const before = new Set(await fs.readdir(destination));
    await run('pnpm', [
      '--dir',
      packageRoot,
      'pack',
      '--pack-destination',
      destination,
    ]);
    const created = (await fs.readdir(destination))
      .find((entry) => entry.endsWith('.tgz') && !before.has(entry));
    if (!created) throw new Error(`pnpm pack did not produce a tarball for ${pkg.name}`);
    tarballs.set(pkg.name, path.join(destination, created));
  }
  return tarballs;
}

async function useTarballs(projectDir, tarballs) {
  const packagePath = path.join(projectDir, 'package.json');
  const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  const overrides = {};
  for (const [name, tarball] of tarballs) {
    const target = `file:${tarball}`;
    overrides[name] = target;
    if (pkg.dependencies?.[name]) pkg.dependencies[name] = target;
    else if (pkg.devDependencies?.[name]) pkg.devDependencies[name] = target;
  }
  // cossack imports the scaffold engine at startup. Keeping it as a direct
  // local tarball ensures the smoke test never falls back to the npm release.
  pkg.devDependencies = {
    ...(pkg.devDependencies ?? {}),
    '@cossackframework/scaffold': `file:${tarballs.get('@cossackframework/scaffold')}`,
  };
  pkg.pnpm = {
    ...(pkg.pnpm ?? {}),
    overrides: {
      ...(pkg.pnpm?.overrides ?? {}),
      ...overrides,
    },
  };
  await fs.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-local-pack-'));
const keep = process.env.COSSACK_KEEP_SMOKE === '1';

try {
  const tarballDirectory = path.join(temporaryRoot, 'tarballs');
  await fs.mkdir(tarballDirectory);
  await buildPublishablePackages();
  const tarballs = await packPackages(tarballDirectory);

  await run(process.execPath, [
    path.join(repositoryRoot, 'packages/cossack/bin/cossack.js'),
    'create',
    'app',
    '--adapter=node',
    '--preset=minimal',
    '--yes',
  ], { cwd: temporaryRoot });

  const projectDir = path.join(temporaryRoot, 'app');
  await useTarballs(projectDir, tarballs);
  await run('pnpm', ['install', '--prefer-offline'], { cwd: projectDir });
  await run('pnpm', [
    'exec',
    'cossack',
    'add',
    'dashboard',
    '--features=users,sessions,settings,roles',
    '--yes',
  ], { cwd: projectDir });
  await run('pnpm', [
    'exec',
    'cossack',
    'add',
    'examples',
    '--yes',
  ], { cwd: projectDir });
  await run('pnpm', ['install', '--prefer-offline'], { cwd: projectDir });
  await run('pnpm', [
    'exec',
    'cossack',
    'add',
    'ui',
    'button',
    '--yes',
  ], { cwd: projectDir });
  const ejectedButton = await fs.readFile(
    path.join(projectDir, 'src/components/ui/Button.ts'),
    'utf8',
  );
  if (!ejectedButton.includes('export class Button')) {
    throw new Error('UI component ejection did not use the packaged source');
  }
  await run('pnpm', ['run', 'build'], { cwd: projectDir });
  await fs.access(path.join(
    projectDir,
    'dist/client/blog/hello-world/index.html',
  ));

  await run('pnpm', [
    'exec',
    'cossack',
    'adapter',
    'cloudflare',
    '--database=d1',
    '--yes',
  ], { cwd: projectDir });
  await run('pnpm', ['install', '--prefer-offline'], { cwd: projectDir });
  await run('pnpm', ['run', 'build'], { cwd: projectDir });
  const cloudflareManifest = JSON.parse(await fs.readFile(
    path.join(projectDir, '.cossack/scaffold.json'),
    'utf8',
  ));
  if (cloudflareManifest.runtime !== 'cloudflare') {
    throw new Error('Node to Cloudflare smoke switch did not update the manifest');
  }
  await fs.access(path.join(projectDir, 'wrangler.jsonc'));

  await run('pnpm', [
    'exec',
    'cossack',
    'adapter',
    'node',
    '--database=sqlite',
    '--yes',
  ], { cwd: projectDir });
  await run('pnpm', ['install', '--prefer-offline'], { cwd: projectDir });
  await run('pnpm', ['run', 'build'], { cwd: projectDir });
  const nodeManifest = JSON.parse(await fs.readFile(
    path.join(projectDir, '.cossack/scaffold.json'),
    'utf8',
  ));
  if (nodeManifest.runtime !== 'node') {
    throw new Error('Cloudflare to Node smoke switch did not update the manifest');
  }
  await fs.access(path.join(projectDir, 'dist/server/index.js'));
  console.log(`Bidirectional local package smoke test passed: ${projectDir}`);
} finally {
  if (keep) {
    console.log(`COSSACK_KEEP_SMOKE=1; retained ${temporaryRoot}`);
  } else {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
