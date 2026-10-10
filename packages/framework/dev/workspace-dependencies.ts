import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

/** Keep optimized linked packages fresh after a workspace library rebuild. */
export function workspaceDependencies(directories: readonly string[]): Plugin {
  const files = directories.flatMap(directory => {
    const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
      .flatMap(entry => entry.isDirectory() ? visit(join(directory, entry.name))
        : /\.(?:mjs|cjs|js|json)$/.test(entry.name) ? [join(directory, entry.name)] : []);
    return visit(directory);
  }).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(normalizePath(file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return {
    // Vite includes plugin names in its dependency cache key. Content hashing
    // reuses identical builds, but invalidates changed output on the next start.
    name: `cossack-workspace-dependencies:${hash.digest('hex')}`,
    apply: 'serve',
    configResolved(config) {
      // Vite already restarts when a config dependency changes. Also watch the
      // built libraries so a running demo picks up rebuilds without --force.
      config.configFileDependencies.push(...files.map(normalizePath));
    },
  };
}
