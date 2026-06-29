import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const requireFromHere = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve a package's installed version (string) by name, or null. */
export function resolvePackageVersion(name) {
  try {
    const pkgPath = requireFromHere.resolve(`${name}/package.json`);
    // eslint-disable-next-line
    const pkg = requireFromHere(pkgPath);
    return pkg.version || null;
  } catch {
    return null;
  }
}

/** Read the cossack CLI's own version from its package.json. */
export function readPackageVersion() {
  // src/pkg.js -> ../package.json
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  // eslint-disable-next-line
  return requireFromHere(pkgPath).version || '0.0.0';
}
