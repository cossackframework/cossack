import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Packages a project can install from npm. Private workspace packages such as
 * @cossackframework/test-utils are never published, so they are not listed.
 */
export const COSSACK_PACKAGES = Object.freeze(['cossack', ...[
  'core', 'renderer', 'framework', 'node-adapter', 'desktop', 'solar-icons', 'database', 'auth', 'scaffold', 'ui', 'studio',
  'typescript-plugin',
].map(name => '@cossackframework/' + name)]);

/** Locate manifests without requiring import-only entries or executing modules. */
export async function readInstalledPackage(root, name) {
  if (!COSSACK_PACKAGES.includes(name)) throw Object.assign(new Error('Select a supported Cossack package.'), { code: 'COSSACK_DOCS_PACKAGE_UNKNOWN' });
  const require = createRequire(path.join(root, 'package.json'));
  for (const directory of require.resolve.paths(name) ?? []) {
    const folder = path.join(directory, name);
    try {
      const source = await fs.readFile(path.join(folder, 'package.json'), 'utf8');
      const manifest = JSON.parse(source);
      if (manifest.name !== name || typeof manifest.version !== 'string') {
        throw Object.assign(new Error('Installed package manifest has an invalid identity.'), { code: 'COSSACK_DOCS_MANIFEST_INVALID' });
      }
      return { folder, manifest, source };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw Object.assign(new Error('Cannot read the installed package manifest.'), { code: 'COSSACK_DOCS_MANIFEST_INVALID' });
    }
  }
  return null;
}
