// Builds the demo app for e2e unless an identical build already exists. The
// signature covers this app's sources and config, the built workspace packages
// it imports, and the lockfile, using path + size + mtime (fast to compute).
// COSSACK_E2E_REBUILD=1 forces a build; CI checkouts always miss the cache.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repository = path.resolve(root, '../..');
const stamp = path.join(root, 'dist', '.e2e-build-stamp');
const inputs = [
  'src', 'public', 'vite.config.ts', 'wrangler.jsonc', 'tsconfig.json', 'package.json',
  '../core/dist', '../renderer/dist', '../ui/dist', '../cossack/src', '../../pnpm-lock.yaml',
].map(input => path.resolve(root, input));

function signature() {
  const hash = createHash('sha256');
  const visit = file => {
    let stat;
    try { stat = fs.statSync(file); } catch { hash.update(`missing:${file}\n`); return; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (name !== 'node_modules') visit(path.join(file, name));
    } else hash.update(`${path.relative(repository, file)}:${stat.size}:${stat.mtimeMs}\n`);
  };
  inputs.forEach(visit);
  return hash.digest('hex');
}

const expected = signature();
const outputs = ['dist/client', 'dist/ssr'].every(dir => fs.existsSync(path.join(root, dir)));
let previous = null;
try { previous = fs.readFileSync(stamp, 'utf8'); } catch {}
if (!process.env.COSSACK_E2E_REBUILD && outputs && previous === expected) {
  console.log('[e2e] Reusing the existing build (inputs unchanged; COSSACK_E2E_REBUILD=1 forces a rebuild).');
  process.exit(0);
}

fs.rmSync(stamp, { force: true });
const vite = path.join(path.dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin', 'vite.js');
const result = spawnSync(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
fs.writeFileSync(stamp, expected);
