import { verifyAuxiliaryBuildBudgets } from './verify-auxiliary-build-budgets.mjs';
import { verifyBudgetBuildModes } from './verify-budget-build-modes.mjs';
import { verifyBuildBudgets } from './verify-build-budgets.mjs';
import { verifyConfigHydration } from './verify-config-hydration.mjs';
import { verifyDesktopTraceReaders } from '../packages/cossack/tests/fixtures/desktop-trace-readers.js';
import { writeDesktopRuntimeAcceptance, verifyDesktopRuntimeApplication, verifyDesktopDevelopmentApplication } from '../packages/cossack/tests/fixtures/desktop-runtime-acceptance.js';
import { verifyDesktopPackage } from './verify-desktop-package.mjs';
import { verifyPublishedRelease } from './verify-published-release.mjs';
import { verifyDeploymentGuide } from './verify-deployment-guide.mjs';
import { verifyGeneratedMigrationPlans } from './verify-generated-migration-plans.mjs';
import { verifyAgentDocumentation } from './verify-agent-documentation.mjs';
import { verifyConfigTypes } from './verify-config-types.mjs';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageDirectories = [
  'renderer',
  'core',
  'node-adapter',
  'desktop',
  'auth',
  'ui',
  'framework',
  'database',
  'studio',
  'scaffold',
  'test-utils',
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

async function buildPublishablePackages({ includeDesktop = false } = {}) {
  await run('pnpm', ['--filter', '@cossackframework/renderer', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/core', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/node-adapter', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/ui', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/framework', 'build:types']);
  if (includeDesktop) await run('pnpm', ['--filter', '@cossackframework/desktop', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/database', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/studio', 'build']);
  await run('pnpm', ['--filter', '@cossackframework/test-utils', 'build']);
}

async function packPackages(destination, { includeDesktop = false } = {}) {
  const tarballs = new Map();
  for (const directory of packageDirectories.filter(name => includeDesktop || name !== 'desktop')) {
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

async function useTarballs(projectDir, tarballs, { documentation = false } = {}) {
  const packagePath = path.join(projectDir, 'package.json');
  const workspacePath = path.join(projectDir, 'pnpm-workspace.yaml');
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
  // Guidance fixtures need directly resolvable packages, without composing
  // their features into the minimal application.
  if (documentation) for (const name of [
    '@cossackframework/ui', '@cossackframework/auth', '@cossackframework/database',
    '@cossackframework/node-adapter',
    '@cossackframework/studio', '@cossackframework/test-utils',
  ]) {
    if (!pkg.dependencies?.[name]) pkg.devDependencies[name] = `file:${tarballs.get(name)}`;
  }
  await fs.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');

  // pnpm 11 moved overrides out of package.json's `pnpm` field. Keep the
  // tarball acceptance project compatible with both pnpm 10 and 11 by writing
  // the workspace setting used by current generated applications.
  const workspace = parseDocument(await fs.readFile(workspacePath, 'utf8'));
  if (workspace.errors.length) throw workspace.errors[0];
  for (const [name, target] of Object.entries(overrides)) workspace.setIn(['overrides', name], target);
  await fs.writeFile(workspacePath, workspace.toString());
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
} from '@cossackframework/database/cossack';
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
    await cache.set('acceptance', { ok: true }, 60_000);
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

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a Node smoke-test port');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function verifyNodeProductionAssets(projectDir) {
  const clientDirectory = path.join(projectDir, 'dist', 'client');
  const manifest = JSON.parse(await fs.readFile(
    path.join(clientDirectory, '.vite', 'manifest.json'),
    'utf8',
  ));
  const entry = manifest['src/client/entry-client.ts'];
  if (!entry?.file) throw new Error('Node production smoke test could not find the client entry asset');
  const stylesheets = await listFilesRecursive(clientDirectory, (file) => file.endsWith('.css'));
  if (!stylesheets.length) throw new Error('Node production smoke test could not find an emitted stylesheet');

  const requests = [
    { path: `/${entry.file}`, contentType: 'application/javascript', immutable: true },
    {
      path: `/${path.relative(clientDirectory, stylesheets[0]).split(path.sep).join('/')}`,
      contentType: 'text/css',
      immutable: true,
    },
    { path: '/logo.svg', contentType: 'image/svg+xml', immutable: false },
  ];
  const port = await reservePort();
  const child = spawn(process.execPath, [
    '--env-file-if-exists=.env',
    'dist/server/index.js',
  ], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });

  try {
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Node production entry exited before serving assets:\n${output}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}${requests[0].path}`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // The server may still be starting; retry until the deadline.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error(`Node production entry did not start within 15 seconds:\n${output}`);

    for (const expected of requests) {
      const response = await fetch(`http://127.0.0.1:${port}${expected.path}`);
      if (!response.ok) throw new Error(`${expected.path} returned ${response.status}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith(expected.contentType)) {
        throw new Error(`${expected.path} returned Content-Type ${JSON.stringify(contentType)}`);
      }
      const cacheControl = response.headers.get('cache-control') ?? '';
      if (expected.immutable !== cacheControl.includes('immutable')) {
        throw new Error(`${expected.path} returned unexpected Cache-Control ${JSON.stringify(cacheControl)}`);
      }
    }
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

// Representative release matrix: portable resources, validated mutations and
// scoped services on every web target; auth/database/dashboard on Node and
// its bidirectional D1 switch. Native Workflow lifecycle is a separate gate.
async function writeReleaseComposition(projectDir) {
  for (const feature of ['resource', 'mutation', 'scoped-service']) {
    await run('pnpm', ['exec', 'cossack', 'add', feature, '--yes'], { cwd: projectDir });
  }
  const directory = path.join(projectDir, 'src/pages/release-stripping');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'index.ts'), `import { Cossack, Page, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
@Page({transport:'http'})
export default class ReleaseStrippingPage extends Cossack {
  @Server() async serverSecret() { return 'COSSACK_RELEASE_SERVER_ONLY_SENTINEL_090'; }
  render() { return html\`<main>Release stripping acceptance</main>\`; }
}
`);
}

async function verifyReleaseStripping(projectDir) {
  const browser = await listFilesRecursive(path.join(projectDir, 'dist/client'), file => file.endsWith('.js'));
  const server = [];
  for (const target of ['server', 'ssr']) {
    const directory = path.join(projectDir, 'dist', target);
    if ((await fs.stat(directory).catch(() => null))?.isDirectory()) {
      server.push(...await listFilesRecursive(directory, file => file.endsWith('.js')));
    }
  }
  const marker = 'COSSACK_RELEASE_SERVER_ONLY_SENTINEL_090';
  await assertBundlesExclude(browser, [marker]);
  const sources = await Promise.all(server.map(file => fs.readFile(file, 'utf8')));
  if (!sources.some(source => source.includes(marker))) throw new Error('Server-only fixture was not present in production server artifacts');
}

async function verifyScaffoldApplications(minimalProjectDir) {
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
  await writeReleaseComposition(minimalProjectDir);
  await run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: minimalProjectDir });
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
  await verifyReleaseStripping(minimalProjectDir);
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
    path.join(minimalProjectDir, 'node_modules/cossack/bin/cossack.js'),
    'create',
    'app',
    '--adapter=node',
    '--preset=minimal',
    '--yes',
  ], { cwd: temporaryRoot });

  const projectDir = path.join(temporaryRoot, 'app');
  await useTarballs(projectDir, tarballs);
  await installGeneratedProject(projectDir);
  await writeReleaseComposition(projectDir);
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
  // Auth/session middleware runs while SSG renders the example pages. Apply
  // the generated schema before the first build, as the starter instructs.
  await run('pnpm', ['run', 'migrate'], { cwd: projectDir });
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
    // The harness deliberately changed published semver pins to local tarballs.
    '--force',
    '--yes',
  ], { cwd: projectDir });
  await useTarballs(projectDir, tarballs);
  await installGeneratedProject(projectDir);
  await run('pnpm', ['run', 'migrate'], { cwd: projectDir });
  await run('pnpm', ['run', 'build'], { cwd: projectDir });
  await verifyGeneratedMigrationPlans(projectDir);
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
    '--force',
    '--yes',
  ], { cwd: projectDir });
  await useTarballs(projectDir, tarballs);
  await installGeneratedProject(projectDir);
  await run('pnpm', ['run', 'migrate'], { cwd: projectDir });
  await run('pnpm', ['exec', 'cossack', 'seeder', 'run'], { cwd: projectDir });
  await run('pnpm', ['run', 'schema:check'], { cwd: projectDir });
  await verifyGeneratedORMApplication(projectDir);
  await verifyGeneratedStudio(projectDir);
  await run('pnpm', ['run', 'build'], { cwd: projectDir });
  await verifyReleaseStripping(projectDir);
  await run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: projectDir });
  await verifyNodeProductionAssets(projectDir);
  const nodeManifest = JSON.parse(await fs.readFile(
    path.join(projectDir, '.cossack/scaffold.json'),
    'utf8',
  ));
  if (nodeManifest.runtime !== 'node') {
    throw new Error('Cloudflare to Node smoke switch did not update the manifest');
  }
  await fs.access(path.join(projectDir, 'dist/server/index.js'));
  console.log(`Bidirectional local package smoke test passed: ${projectDir}`);
}

// Resume only the checks invalidated by a final generated Node repair. The
// caller must install the repaired artifact set and reconcile its generated
// sources first; this never republishes or silently regenerates the project.
const resumeNodeProject = process.argv.find(argument => argument.startsWith('--resume-node-acceptance='))?.slice('--resume-node-acceptance='.length);
if (resumeNodeProject) {
  const projectDir = path.resolve(resumeNodeProject);
  await run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: projectDir });
  await run('pnpm', ['run', 'build'], { cwd: projectDir });
  await verifyReleaseStripping(projectDir);
  await verifyNodeProductionAssets(projectDir);
  console.log(`Resumed generated Node typecheck, production build, stripping and asset acceptance passed: ${projectDir}`);
  process.exit(0);
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-local-pack-'));
const keep = process.env.COSSACK_KEEP_SMOKE === '1';
const nodeDevelopmentOnly = process.argv.includes('--node-dev-only');
const desktopRuntimeOnly = process.argv.includes('--desktop-runtime-only');
const agentDocsOnly = process.argv.includes('--agent-docs-only');
const publishedReleaseOnly = process.argv.includes('--published-release-only');
const deploymentGuideOnly = process.argv.includes('--deployment-guide-only');
const scaffoldOnly = process.argv.includes('--scaffold-only');
const reuseDirectory = process.argv.find(argument => argument.startsWith('--reuse-artifacts='))?.slice('--reuse-artifacts='.length);
const includeDesktop = desktopRuntimeOnly;

try {
  const tarballDirectory = path.join(temporaryRoot, 'tarballs');
  await fs.mkdir(tarballDirectory);
  let tarballs;
  if (reuseDirectory) {
    tarballs = new Map();
    for (const directory of packageDirectories.filter(name => includeDesktop || name !== 'desktop')) {
      const pkg = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'packages', directory, 'package.json'), 'utf8'));
      const filename = `${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}.tgz`;
      const tarball = path.resolve(reuseDirectory, filename);
      await fs.access(tarball);
      tarballs.set(pkg.name, tarball);
    }
    console.log(`Reusing artifact set: ${path.resolve(reuseDirectory)}`);
  } else {
    await buildPublishablePackages({ includeDesktop });
    tarballs = await packPackages(tarballDirectory, { includeDesktop });
  }

  await run(process.execPath, [
    path.join(repositoryRoot, 'packages/cossack/bin/cossack.js'),
    'create',
    'minimal-production',
    (nodeDevelopmentOnly || desktopRuntimeOnly) ? '--adapter=node' : '--adapter=cloudflare',
    '--preset=minimal',
    ...(desktopRuntimeOnly ? ['--features=desktop'] : []),
    '--yes',
  ], { cwd: temporaryRoot });
  const minimalProjectDir = path.join(temporaryRoot, 'minimal-production');
  await useTarballs(minimalProjectDir, tarballs, { documentation: !desktopRuntimeOnly });
  await installGeneratedProject(minimalProjectDir);
  if (deploymentGuideOnly) {
    console.log(JSON.stringify(await verifyDeploymentGuide(minimalProjectDir), null, 2));
  } else if (publishedReleaseOnly) {
    await verifyPublishedRelease(minimalProjectDir);
  } else if (scaffoldOnly) {
    await verifyScaffoldApplications(minimalProjectDir);
  } else if (desktopRuntimeOnly) {
    await writeDesktopRuntimeAcceptance(minimalProjectDir);
    const configFile = path.join(minimalProjectDir, 'vite.config.ts');
    await fs.writeFile(configFile, (await fs.readFile(configFile, 'utf8')).replace('cossackPages({', 'cossackPages({ developmentTraces:true,'));
    await run('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: minimalProjectDir });
    await run('pnpm', ['run', 'build:desktop'], { cwd: minimalProjectDir });
    await verifyDesktopRuntimeApplication(minimalProjectDir);
    await verifyDesktopPackage(minimalProjectDir);
    await verifyDesktopDevelopmentApplication(minimalProjectDir, { launcher: true, startupError: true,
      onRecorded: record => verifyDesktopTraceReaders(minimalProjectDir, record) });
  } else {
    if (!nodeDevelopmentOnly && !agentDocsOnly) console.log(JSON.stringify(await verifyDeploymentGuide(minimalProjectDir), null, 2));
    await verifyPublishedRelease(minimalProjectDir);
    await verifyConfigTypes(minimalProjectDir);
    await verifyAgentDocumentation(minimalProjectDir, { runtime: nodeDevelopmentOnly ? 'node' : 'cloudflare' });
    if (!nodeDevelopmentOnly) {
      await verifyConfigHydration(minimalProjectDir);
      await verifyBuildBudgets(minimalProjectDir);
      await verifyBudgetBuildModes(minimalProjectDir);
      await verifyAuxiliaryBuildBudgets(minimalProjectDir);
    }
  }
  if (!deploymentGuideOnly && !publishedReleaseOnly && !scaffoldOnly && !desktopRuntimeOnly && !nodeDevelopmentOnly && !agentDocsOnly) {
    await verifyScaffoldApplications(minimalProjectDir);
  }
} finally {
  if (keep) {
    console.log(`COSSACK_KEEP_SMOKE=1; retained ${temporaryRoot}`);
  } else {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
