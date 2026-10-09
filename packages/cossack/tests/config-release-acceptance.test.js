import { afterEach, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scaffoldLinkedApp } from './fixtures/linked-app.js';
import { writeConfigReleaseAcceptance, checkConfigReleaseTooling, startConfigReleaseServer,
  checkConfigReleaseAcceptance, CONFIG_RELEASE_MARKERS } from './fixtures/config-release-acceptance.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function generatedProject(adapter) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-config-release-'));
  roots.push(parent);
  const root = await scaffoldLinkedApp(parent, { adapter, packages: ['framework', 'core', 'renderer', 'scaffold', 'node-adapter', 'deno-adapter'] });
  await writeConfigReleaseAcceptance(root);
  // This deliberately invalid development file must never be read by config inspection
  // or production request preparation. The harness supplies values explicitly.
  await fs.writeFile(path.join(root, '.env'), `RT24_PRIVATE_TOKEN=${CONFIG_RELEASE_MARKERS[3]}\nRT24_LIMIT=not-a-number\n`);
  return root;
}
async function build(root, args) {
  const result = await promisify(execFile)(process.execPath, [path.join(repository, 'node_modules/vite/bin/vite.js'), 'build', '--sourcemap', ...args], {
    cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, VITEST: '', NODE_ENV: 'production', CLOUDFLARE_ENV: '', WRANGLER_SEND_METRICS: 'false' },
  });
  for (const marker of CONFIG_RELEASE_MARKERS) expect(result.stdout + result.stderr).not.toContain(marker);
}
for (const adapter of ['node', 'deno']) {
  it(`keeps configuration private, typed and isolated in a generated production ${adapter} app`, async () => {
    const binary = process.env.COSSACK_DENO_BINARY ?? 'deno';
    if (adapter === 'deno') await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
    const root = await generatedProject(adapter);
    await checkConfigReleaseTooling(root, path.join(repository, 'packages/cossack/bin/cossack.js'));
    await build(root, []); await build(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    const server = await startConfigReleaseServer(root, adapter, binary);
    try { await checkConfigReleaseAcceptance(root, server); }
    finally { await server.close(); }
  }, 180000);
}
