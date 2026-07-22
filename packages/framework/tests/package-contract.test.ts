// @vitest-environment node
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeConfig } from 'vite';
import { cossackPages } from '../src/vite-plugin.js';

const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');
const packages = ['core', 'framework', 'auth', 'node-adapter', 'database'] as const;

describe('Hono package contract', () => {
  it.each(packages)('%s uses the common Hono peer supplied by the consumer', (packageName) => {
    const packageJson = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), '..', packageName, 'package.json'),
      'utf8',
    ));

    expect(packageJson.peerDependencies?.hono).toBe('^4.12.0');
    expect(packageJson.dependencies?.hono).toBeUndefined();
    expect(packageJson.devDependencies?.hono).toMatch(/^\^4\.12\./);
  });
});

// Regression test for bug.md / bug-2.md: Node's native ESM resolver does not
// append file extensions. Every relative import/export in emitted JS must use
// an explicit, existing target. The Vite contract below separately ensures the
// framework is transformed so its intentional virtual imports are resolved.
describe('published ESM relative specifiers are Node-resolvable', () => {
  const distDir = path.resolve(process.cwd(), 'dist', 'esm');

  // Matches static (`from '...'`, `export ... from '...'`), side-effect
  // (`import './setup'`), and dynamic (`import('...')`) relative specifiers.
  // Bare/non-relative imports are handled by the package resolver.
  const relativeSpecifier =
    /(?:\bfrom\s+|\bexport\s+\*?\s*from\s+|\bimport\s*(?:\(\s*)?)['"](\.\.?\/[^'"]+)['"]/g;

  function listJsFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) listJsFiles(full, acc);
      else if (entry.isFile() && entry.name.endsWith('.js')) acc.push(full);
    }
    return acc;
  }

  it(
    'every relative specifier in dist/esm has an explicit extension',
    () => {
      expect(fs.existsSync(distDir), 'dist/esm must be built before this test').toBe(true);
      const violations: string[] = [];
      for (const file of listJsFiles(distDir)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        for (const [i, line] of lines.entries()) {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          let match: RegExpExecArray | null;
          const re = new RegExp(relativeSpecifier.source, 'g');
          while ((match = re.exec(line)) !== null) {
            const specifier = match[1];
            if (
              specifier.endsWith('.js') ||
              specifier.endsWith('.json') ||
              specifier.endsWith('.css')
            ) {
              continue;
            }
            violations.push(`${path.relative(distDir, file)}:${i + 1} -> ${specifier}`);
          }
        }
      }
      expect(violations, `extensionless relative imports:\n${violations.join('\n')}`).toEqual([]);
    },
  );

  it(
    'every relative specifier in dist/esm actually resolves on disk',
    () => {
      expect(fs.existsSync(distDir), 'dist/esm must be built before this test').toBe(true);
      const violations: string[] = [];
      for (const file of listJsFiles(distDir)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trimStart();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          const re = new RegExp(relativeSpecifier.source, 'g');
          let match: RegExpExecArray | null;
          while ((match = re.exec(line)) !== null) {
            const specifier = match[1];
            // CSS imports are consumed by Vite and are not emitted by the
            // declaration build. JS/JSON targets, however, must exist for
            // Node's native ESM resolver.
            if (
              !(specifier.endsWith('.js') ||
                specifier.endsWith('.json'))
            ) {
              continue;
            }
            const target = path.resolve(path.dirname(file), specifier);
            if (!fs.existsSync(target)) {
              violations.push(`${path.relative(distDir, file)} -> ${specifier} (unresolvable)`);
            }
          }
        }
      }
      expect(violations, `unresolvable relative imports:\n${violations.join('\n')}`).toEqual([]);
    },
  );
});

describe('external application SSR contract', () => {
  it('keeps the framework in Vite\'s SSR graph for virtual-module resolution', () => {
    const configHook = cossackPages().config;
    expect(typeof configHook).toBe('function');
    const config = (configHook as Function)({}, { command: 'serve', mode: 'development' });
    expect(config).toMatchObject({
      ssr: { noExternal: ['@cossackframework/framework'] },
    });
  });

  it('preserves user noExternal entries when Vite merges plugin config', () => {
    const configHook = cossackPages().config as Function;
    const pluginConfig = configHook({}, { command: 'serve', mode: 'development' });
    const merged = mergeConfig(
      { ssr: { noExternal: ['user-package'] } },
      pluginConfig,
    );
    expect(merged.ssr?.noExternal).toEqual([
      'user-package',
      '@cossackframework/framework',
    ]);
  });
});
