import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { verifyDesktopRuntimeApplication } from '../packages/cossack/tests/fixtures/desktop-runtime-acceptance.js';

const exec = promisify(execFile);
async function run(root, command, args) {
  try {
    const result = await exec(command, args, {
      cwd: root,
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result;
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${error.stdout}\n${error.stderr}`, {
      cause: error,
    });
  }
}

/** Build the public package, inspect ASAR, then execute a relocated native app. */
export async function verifyDesktopPackage(root) {
  assert.equal(
    process.platform,
    'linux',
    'Automated installer inspection currently requires a Linux host.',
  );
  const sentinels = [
    '.env.production',
    '.dev.vars',
    '.wrangler/private.txt',
    '.cossack/private.txt',
    'dist/server/private.txt',
    'private-notes.txt',
  ];
  for (const name of sentinels) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'COSSACK_PRIVATE_PACKAGING_SENTINEL=must-not-ship');
  }
  await run(root, 'pnpm', ['run', 'desktop:package']);
  const output = path.join(root, 'out');
  const bundles = (await fs.readdir(output)).filter((name) =>
    name.endsWith(`-linux-${process.arch}`),
  );
  assert.equal(bundles.length, 1, 'Expected exactly one native Linux package');
  const bundle = path.join(output, bundles[0]);
  const require = createRequire(path.join(root, 'package.json'));
  const { listPackage, extractFile } = require('@electron/asar');
  const asar = path.join(bundle, 'resources/app.asar');
  const entries = listPackage(asar).map((name) => name.replaceAll('\\', '/'));
  for (const name of sentinels)
    assert(!entries.includes(`/${name}`), `Private project file packaged: ${name}`);
  assert(
    !entries.some((name) => /^\/(src|node_modules|public)(\/|$)/.test(name)),
    'Source/dependencies copied into ASAR',
  );
  assert(entries.includes('/dist/desktop/index.js'), 'Desktop entry missing');
  assert(
    entries.some((name) => name.startsWith('/dist/client/')),
    'Renderer assets missing',
  );
  assert(entries.includes('/desktop-assets/icon-256.png'), 'Runtime icon missing');
  for (const entry of entries.filter(name => name.startsWith('/dist/client/') && name.endsWith('.js'))) {
    const code = extractFile(asar, entry.slice(1)).toString();
    for (const marker of ['foreign-write.txt', 'node:fs/promises', '__desktopAcceptanceApplication']) {
      assert(!code.includes(marker), `Server-only fixture code leaked into renderer: ${marker}`);
    }
  }
  for (const entry of entries.filter(name => /^\/dist\/(client|desktop)\//.test(name) && name.endsWith('.js'))) {
    const code = extractFile(asar, entry.slice(1)).toString();
    for (const marker of ['X-Cossack-Development-Trace', 'Record trace', 'server-stream', 'server-socket', 'server-native', 'cossack:development-trace:native', 'beginDevelopmentSocketDispatch', 'cossack-start:', 'cossack-desktop-development', '/@vite/client']) {
      assert(!code.includes(marker), `Development code leaked into production ${entry}: ${marker}`);
    }
  }
  assert.equal(
    JSON.parse(extractFile(asar, 'package.json').toString()).main,
    'dist/desktop/index.js',
  );

  const relocated = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-native-package-'));
  try {
    await fs.cp(bundle, path.join(relocated, 'application'), { recursive: true });
    const executable = JSON.parse(extractFile(asar, 'package.json').toString())
      .name.replace(/[^a-z0-9-]/gi, '-')
      .toLowerCase();
    await verifyDesktopRuntimeApplication(root, {
      executablePath: path.join(relocated, 'application', executable),
      packaged: true,
    });
  } finally {
    await fs.rm(relocated, { recursive: true, force: true });
  }

  // Reuse the exact bundle already executed above; do not rebuild it for the maker.
  await run(root, 'pnpm', ['exec', 'electron-forge', 'make', '--skip-package']);
  const artifacts = [];
  for await (const entry of await fs.readdir(path.join(output, 'make'), { recursive: true })) {
    if (entry.endsWith('.deb')) artifacts.push(path.join(output, 'make', entry));
  }
  assert.equal(artifacts.length, 1, 'Expected one native DEB');
  const { stdout: contents } = await run(root, 'dpkg-deb', ['--contents', artifacts[0]]);
  assert.match(contents, /resources\/app\.asar/);
  assert.match(contents, /\.desktop\n/);
  assert.match(contents, /icon|\.png/);
  console.log(
    'Native Desktop ASAR, relocated RPC/persistence and DEB construction acceptance passed.',
  );
  console.log(
    'Installed OS sandbox, desktop integration, Windows/macOS and signing remain separate native-host gates.',
  );
}
