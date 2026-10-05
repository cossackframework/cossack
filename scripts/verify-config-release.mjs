import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeConfigReleaseAcceptance, checkConfigReleaseTooling, startConfigReleaseServer,
  checkConfigReleaseAcceptance, CONFIG_RELEASE_MARKERS } from '../packages/cossack/tests/fixtures/config-release-acceptance.js';

/** Fresh native apps use the supplied installed gate's exact published package overrides. */
export async function verifyConfigRelease(installedProjectDir, { runtimes = ['node', 'deno'], denoBinary = process.env.COSSACK_DENO_BINARY ?? 'deno', retain = false } = {}) {
  installedProjectDir = path.resolve(installedProjectDir);
  const scaffoldFile = fileURLToPath((await promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', "process.stdout.write(import.meta.resolve('@cossackframework/scaffold'))"],
    { cwd: installedProjectDir, timeout: 10000 })).stdout);
  assert.ok((await fs.realpath(scaffoldFile)).startsWith(installedProjectDir + path.sep), 'Use an installed scaffold package');
  const { createApp } = await import(pathToFileURL(scaffoldFile).href);
  const gatePackage = JSON.parse(await fs.readFile(path.join(installedProjectDir, 'package.json'), 'utf8'));
  const overrides = Object.fromEntries(Object.entries({ ...gatePackage.dependencies, ...gatePackage.devDependencies })
    .filter(([name, value]) => (name.startsWith('@cossackframework/') || name === 'cossack') && value.startsWith('file:')));
  for (const name of ['@cossackframework/core', '@cossackframework/framework', '@cossackframework/renderer', '@cossackframework/node-adapter', '@cossackframework/deno-adapter', 'cossack']) {
    assert.ok(overrides[name], `Missing installed tarball override ${name}`);
  }
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-installed-config-release-'));
  const run = promisify(execFile);
  const results = [];
  try {
    for (const runtime of runtimes) {
      assert.ok(['node', 'deno'].includes(runtime), 'Native config acceptance supports Node and Deno');
      if (runtime === 'deno') await run(denoBinary, ['--version'], { timeout: 10000 });
      const { projectDir: root } = await createApp(`app-${runtime}`, { cwd: parent, adapter: runtime, preset: 'minimal', interactive: false });
      const manifestFile = path.join(root, 'package.json');
      const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      manifest.pnpm = { ...manifest.pnpm, overrides };
      await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
      await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'overrides:\n' + Object.entries(overrides)
        .map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n') + '\n');
      await run('pnpm', ['install', '--ignore-scripts', '--config.strict-dep-builds=false'], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      for (const name of ['core', 'framework', 'renderer']) assert.ok((await fs.realpath(path.join(root, 'node_modules/@cossackframework', name)))
        .startsWith(root + path.sep), `Acceptance must use an installed ${name} package`);
      await writeConfigReleaseAcceptance(root);
      await fs.writeFile(path.join(root, '.env'), `RT24_PRIVATE_TOKEN=${CONFIG_RELEASE_MARKERS[3]}\nRT24_LIMIT=not-a-number\n`);
      const appRequire = createRequire(manifestFile);
      const cli = path.join(path.dirname(appRequire.resolve('cossack/package.json')), 'bin/cossack.js');
      await checkConfigReleaseTooling(root, cli);
      const vite = path.join(path.dirname(appRequire.resolve('vite/package.json')), 'bin/vite.js');
      for (const args of [[], ['--ssr', 'src/index.ts', '--outDir', 'dist/server']]) {
        const built = await run(process.execPath, [vite, 'build', '--sourcemap', ...args], { cwd: root, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
          env: { ...process.env, NODE_ENV: 'production', VITEST: '', CLOUDFLARE_ENV: '', WRANGLER_SEND_METRICS: 'false' } });
        for (const marker of CONFIG_RELEASE_MARKERS) assert.ok(!(built.stdout + built.stderr).includes(marker), 'Private build diagnostics');
      }
      const server = await startConfigReleaseServer(root, runtime, denoBinary);
      try { await checkConfigReleaseAcceptance(root, server); }
      finally { await server.close(); }
      results.push({ runtime, projectDir: root });
      console.log(`Installed ${runtime} config types, catalog policy, native SSR/RPC isolation, named failure diagnostics, hydration and client/source-map secrecy passed.`);
    }
    return results;
  } finally { if (!retain) await fs.rm(parent, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv[2]; assert.ok(root, 'Usage: node scripts/verify-config-release.mjs <installed-project>');
  await verifyConfigRelease(root, { retain: process.env.COSSACK_RETAIN_CONFIG_FIXTURE === '1' });
}
