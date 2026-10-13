// Builds the demo app for e2e unless an identical build already exists. The
// signature covers this app's sources and config, the built workspace packages
// it imports, and the lockfile, using file contents. Rebuilding identical
// workspace output must not invalidate the cache merely by changing mtimes.
// COSSACK_E2E_REBUILD=1 forces a build.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildSignature(root, environment = process.env) {
  const repository = path.resolve(root, '../..');
  const inputs = [
    'src', 'public', 'dev', 'scripts/e2e-build.mjs',
    'vite.config.ts', 'wrangler.jsonc', 'tsconfig.json', 'package.json',
    '../core/dist', '../core/package.json', '../renderer/dist', '../renderer/package.json',
    '../ui/dist', '../ui/package.json', '../cossack/src', '../../pnpm-lock.yaml',
    ...fs.readdirSync(root).filter(name => /^(?:\.env|\.dev\.vars)(?:\.|$)/.test(name)).sort(),
  ].map(input => path.resolve(root, input));
  if (environment.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH) {
    inputs.push(path.resolve(root, environment.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH));
  }
  const hash = createHash('sha256');
  const visit = file => {
    let stat;
    try { stat = fs.statSync(file); } catch { hash.update(`missing:${file}\n`); return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (name !== 'node_modules') visit(path.join(file, name));
    } else {
      hash.update(`${path.relative(repository, file)}\0${stat.size}\0`);
      hash.update(fs.readFileSync(file));
    }
  };
  inputs.forEach(visit);
  for (const name of ['APP_URL', 'APP_LOCALE', 'CLOUDFLARE_ENV', 'CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH']) {
    hash.update(JSON.stringify([name, environment[name] ?? null]));
  }
  return hash.digest('hex');
}

export function canReuseBuild(root, expected) {
  const outputs = ['dist/client/cossack-manifest.json', 'dist/client/cossack-routes.json',
    'dist/ssr/index.js', 'dist/ssr/wrangler.json'];
  if (!outputs.every(file => fs.existsSync(path.join(root, file)))) return false;
  try { return fs.readFileSync(path.join(root, 'dist', '.e2e-build-stamp'), 'utf8') === expected; }
  catch { return false; }
}

function build() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const stamp = path.join(root, 'dist', '.e2e-build-stamp');
  const expected = buildSignature(root);
  if (!process.env.COSSACK_E2E_REBUILD && canReuseBuild(root, expected)) {
    console.log('[e2e] Reusing the existing build (inputs unchanged; COSSACK_E2E_REBUILD=1 forces a rebuild).');
    return;
  }

  fs.rmSync(stamp, { force: true });
  console.log('[e2e] Building the production app before starting browser tests...');
  const started = performance.now();
  const vite = path.join(path.dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin', 'vite.js');
  const result = spawnSync(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  fs.writeFileSync(stamp, expected);
  console.log(`[e2e] Production build ready in ${((performance.now() - started) / 1000).toFixed(1)}s.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
