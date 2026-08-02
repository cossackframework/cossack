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
  'ui',
  'framework',
  'studio',
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
  await run('pnpm', ['build'], { cwd: path.resolve(repositoryRoot, '../orm') });
  await run('pnpm', ['--filter', '@cossackframework/renderer', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/core', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/node-adapter', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/ui', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/framework', 'build:types']);
  await run('pnpm', ['--filter', '@cossackframework/studio', 'build']);
}

async function packPackages(destination) {
  const tarballs = new Map();
  const ormRoot = path.resolve(repositoryRoot, '../orm');
  const beforeOrm = new Set(await fs.readdir(destination));
  await run('pnpm', ['--dir', ormRoot, 'pack', '--pack-destination', destination]);
  const ormTarball = (await fs.readdir(destination))
    .find((entry) => entry.endsWith('.tgz') && !beforeOrm.has(entry));
  if (!ormTarball) throw new Error('pnpm pack did not produce an ORM tarball');
  tarballs.set('@cossackframework/orm', path.join(destination, ormTarball));
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

async function installGeneratedProject(projectDir) {
  // Scaffold commands intentionally update package.json without installing.
  // CI enables frozen lockfiles by default, so allow this temporary project's
  // lockfile to follow each recipe and adapter change.
  await run('pnpm', [
    'install',
    '--prefer-offline',
    '--no-frozen-lockfile',
  ], { cwd: projectDir });
}

async function eagerClientJavaScriptBytes(projectDir) {
  const clientDir = path.join(projectDir, 'dist', 'client');
  const manifest = JSON.parse(await fs.readFile(
    path.join(clientDir, '.vite', 'manifest.json'),
    'utf8',
  ));
  const seen = new Set();
  let bytes = 0;

  async function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Client manifest is missing eager import "${key}"`);
    if (chunk.file?.endsWith('.js')) {
      bytes += (await fs.stat(path.join(clientDir, chunk.file))).size;
    }
    for (const imported of chunk.imports ?? []) await visit(imported);
  }

  await visit('src/client/entry-client.ts');
  return bytes;
}

async function listFilesRecursive(directory, predicate, files = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await listFilesRecursive(absolute, predicate, files);
    else if (entry.isFile() && predicate(absolute)) files.push(absolute);
  }
  return files;
}

async function productionBundleMetrics(projectDir) {
  const clientDirectory = path.join(projectDir, 'dist', 'client');
  const clientFiles = await listFilesRecursive(
    clientDirectory,
    (file) => file.endsWith('.js'),
  );
  const workerFiles = await listFilesRecursive(
    path.join(projectDir, 'dist', 'ssr'),
    (file) => file.endsWith('.js'),
  );
  return {
    initialBrowserBytes: await eagerClientJavaScriptBytes(projectDir),
    totalClientBytes: (await Promise.all(
      clientFiles.map((file) => fs.stat(file)),
    )).reduce((total, stat) => total + stat.size, 0),
    workerBytes: (await Promise.all(
      workerFiles.map((file) => fs.stat(file)),
    )).reduce((total, stat) => total + stat.size, 0),
    clientFiles,
    workerFiles,
  };
}

async function assertBundlesExclude(files, forbidden) {
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    for (const marker of forbidden) {
      if (source.includes(marker)) {
        throw new Error(`${path.basename(file)} unexpectedly contains ${JSON.stringify(marker)}`);
      }
    }
  }
}

async function verifyMinimalProductionBundles(projectDir) {
  const metrics = await productionBundleMetrics(projectDir);
  await assertBundlesExclude(metrics.clientFiles, [
    '[Cossack] DevTools module loaded',
    '[Cossack] DevTools enabled',
    'Could not emit cossack-manifest.json',
    'Could not parse src/auth.ts exports',
    '@aws-sdk/client-s3',
    'AWS4-HMAC-SHA256',
    'X-Amz-Credential',
  ]);
  await assertBundlesExclude(metrics.workerFiles, [
    'Could not emit cossack-manifest.json',
    'Could not parse src/auth.ts exports',
    '[cossack/ssg] Starting static rendering',
    '[cossack/ssg] Generating sitemap',
    '@aws-sdk/client-s3',
    'AWS4-HMAC-SHA256',
    'X-Amz-Credential',
  ]);
  console.log(
    'Minimal production bundle sizes: ' +
    `initial browser JS=${metrics.initialBrowserBytes} bytes, ` +
    `total client JS=${metrics.totalClientBytes} bytes, ` +
    `Worker JS=${metrics.workerBytes} bytes`,
  );
}

async function assertStarterBundleBudgets(projectDir) {
  const eagerClientBytes = await eagerClientJavaScriptBytes(projectDir);
  const serverBytes = (await fs.stat(
    path.join(projectDir, 'dist', 'ssr', 'index.js'),
  )).size;
  const clientBudget = 350 * 1024;
  const serverBudget = 850 * 1024;
  if (eagerClientBytes > clientBudget) {
    throw new Error(
      `Starter eager client JavaScript is ${eagerClientBytes} bytes; budget is ${clientBudget}`,
    );
  }
  if (serverBytes > serverBudget) {
    throw new Error(
      `Starter server bundle is ${serverBytes} bytes; budget is ${serverBudget}`,
    );
  }
}

async function verifyGeneratedORMApplication(projectDir) {
  const fixture = path.join(projectDir, '.cossack-orm-acceptance.ts');
  await fs.writeFile(fixture, `import {
  createDatabaseCacheStore,
  createDatabaseSessionStore,
} from '@cossackframework/orm/cossack';
import { getORM } from './src/orm/factory';
import { Role, User, UserRole } from './src/models';

const orm = await getORM();
try {
  await orm.run(async () => {
    const user = await User.findOne({ where: { email: 'admin@example.com' } });
    const role = await Role.findOne({ where: { name: 'admin' } });
    if (!user || !role) throw new Error('Seeder did not create the admin user and role');
    const assignment = await UserRole.findOne({
      where: { userId: user.id, roleId: role.id },
    });
    if (!assignment) throw new Error('Seeder did not create the admin role assignment');

    const cache = createDatabaseCacheStore(orm);
    await cache.set('acceptance', { ok: true }, 60);
    const cached = await cache.get<{ ok: boolean }>('acceptance');
    if (!cached?.ok) throw new Error('ORM cache store round-trip failed');
    await cache.delete('acceptance');

    const sessions = createDatabaseSessionStore(orm);
    const sessionId = await sessions.create(60_000);
    await sessions.set(sessionId, 'acceptance', 'ok', 60_000);
    await sessions.bindUser(sessionId, user.id);
    if (await sessions.get(sessionId, 'acceptance') !== 'ok') {
      throw new Error('ORM session store round-trip failed');
    }
    await sessions.destroy(sessionId);
  });
} finally {
  await orm.close();
}
`);
  await run('pnpm', ['exec', 'tsx', fixture], { cwd: projectDir });
}

async function verifyGeneratedStudio(projectDir) {
  const smoke = `import { runStudio } from '@cossackframework/studio';
const controller = new AbortController();
setTimeout(() => controller.abort(), 250);
await runStudio({
  projectRoot: process.cwd(),
  port: 41739,
  open: false,
  signal: controller.signal,
});`;
  await run(process.execPath, ['--input-type=module', '--eval', smoke], {
    cwd: projectDir,
  });
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
    'minimal-production',
    '--adapter=cloudflare',
    '--preset=minimal',
    '--yes',
  ], { cwd: temporaryRoot });
  const minimalProjectDir = path.join(temporaryRoot, 'minimal-production');
  await useTarballs(minimalProjectDir, tarballs);
  await installGeneratedProject(minimalProjectDir);
  await run('pnpm', ['run', 'build'], { cwd: minimalProjectDir });
  await verifyMinimalProductionBundles(minimalProjectDir);
  await assertStarterBundleBudgets(minimalProjectDir);

  await run('pnpm', [
    'exec',
    'cossack',
    'add',
    'markdown',
    '--yes',
  ], { cwd: minimalProjectDir });
  await installGeneratedProject(minimalProjectDir);
  const ssgPageDirectory = path.join(
    minimalProjectDir,
    'src',
    'pages',
    'packaging-check',
  );
  await fs.mkdir(ssgPageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(ssgPageDirectory, 'index.md'),
    '---\ntitle: Packaging check\n---\n# Packaging check\n\nStatic output only.\n',
  );
  const typedSsgPageDirectory = path.join(
    minimalProjectDir,
    'src',
    'pages',
    'ssg-packaging-check',
  );
  await fs.mkdir(typedSsgPageDirectory, { recursive: true });
  await fs.writeFile(
    path.join(typedSsgPageDirectory, 'index.ts'),
    `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http', ssg: true })
export default class PackagingSsgPage extends Cossack {
  render() {
    return html\`<main><h1>SSG packaging check</h1></main>\`;
  }
}
`,
  );
  await run('pnpm', ['run', 'build'], { cwd: minimalProjectDir });
  await fs.access(path.join(
    minimalProjectDir,
    'dist',
    'client',
    'ssg-packaging-check',
    'index.html',
  ));
  const routesManifest = await fs.readFile(
    path.join(minimalProjectDir, 'dist', 'client', 'cossack-routes.json'),
    'utf8',
  );
  if (!routesManifest.includes('/src/pages/packaging-check/index.md')) {
    throw new Error('Markdown fixture was omitted from the generated routes manifest');
  }
  const sitemap = await fs.readFile(
    path.join(minimalProjectDir, 'dist', 'client', 'sitemap.xml'),
    'utf8',
  );
  if (!sitemap.includes('/ssg-packaging-check')) {
    throw new Error('SSG sitemap did not include the static fixture');
  }
  const ssgMetrics = await productionBundleMetrics(minimalProjectDir);
  await assertBundlesExclude(
    [...ssgMetrics.clientFiles, ...ssgMetrics.workerFiles],
    [
      '[cossack/ssg] Starting static rendering',
      '[cossack/ssg] Generating sitemap',
      'generateSitemapFromUrls',
    ],
  );

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
  await installGeneratedProject(projectDir);
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
  await installGeneratedProject(projectDir);
  await run('pnpm', [
    'exec',
    'cossack',
    'add',
    'studio',
    '--yes',
  ], { cwd: projectDir });
  await installGeneratedProject(projectDir);
  const studioPackage = JSON.parse(await fs.readFile(
    path.join(projectDir, 'package.json'),
    'utf8',
  ));
  if (!studioPackage.devDependencies?.['@cossackframework/studio'] ||
      studioPackage.scripts?.studio !== 'cossack studio') {
    throw new Error('Studio feature did not install its dependency and script');
  }
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
  await installGeneratedProject(projectDir);
  await run('pnpm', ['run', 'migrate'], { cwd: projectDir });
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
  await installGeneratedProject(projectDir);
  await run('pnpm', ['run', 'migrate'], { cwd: projectDir });
  await run('pnpm', ['exec', 'cossack', 'seeder', 'run'], { cwd: projectDir });
  await run('pnpm', ['run', 'schema:check'], { cwd: projectDir });
  await verifyGeneratedORMApplication(projectDir);
  await verifyGeneratedStudio(projectDir);
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
