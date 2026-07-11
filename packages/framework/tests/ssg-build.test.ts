// @vitest-environment node
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { getOutputFilePath } from '../src/vite-ssg-plugin';

/**
 * Use createRequire to obtain the real, unshimmed `node:fs`.
 *
 * The framework's vitest configuration inherits the Cloudflare SSR/Workers
 * environment, which replaces `node:fs` with an unenv shim that does not
 * implement `existsSync` against the host filesystem. Going through
 * `createRequire` bypasses Vite's SSR resolver so we get the real Node.js
 * built-in, letting these tests inspect on-disk build artifacts.
 */
const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');

const PROJECT_ROOT = process.cwd();

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.resolve(PROJECT_ROOT, relPath));
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.resolve(PROJECT_ROOT, relPath), 'utf-8');
}

const manifestExists = fileExists('dist/client/.vite/manifest.json');
const sitemapExists = fileExists('dist/client/sitemap.xml');
const buildReady = manifestExists && sitemapExists;
const describeOrSkip = buildReady ? describe : describe.skip;

describeOrSkip('SSG build output (requires `pnpm run build:ssg`)', () => {
  it('writes dist/client/ssg-demo/index.html', () => {
    expect(fileExists('dist/client/ssg-demo/index.html')).toBe(true);
  });

  it('writes dist/client/ssg-demo/users/alice/index.html', () => {
    expect(fileExists('dist/client/ssg-demo/users/alice/index.html')).toBe(true);
  });

  it('writes dist/client/sitemap.xml containing <urlset', () => {
    expect(readFile('dist/client/sitemap.xml')).toContain('<urlset');
  });

  it('produced SSG HTML contains the client hydration script', () => {
    expect(readFile('dist/client/ssg-demo/index.html')).toContain('<script type="module"');
  });

  it('produced SSG HTML contains window.__INITIAL_STATE__', () => {
    expect(readFile('dist/client/ssg-demo/index.html')).toContain('window.__INITIAL_STATE__');
  });

  it('does not create a redundant dist/ssg-static/ directory', () => {
    expect(fileExists('dist/ssg-static')).toBe(false);
  });
});

// Always-running sanity check so the file always reports at least one test.
describe('SSG build test guard', () => {
  it('skips integration checks when the build has not run', () => {
    if (!manifestExists) {
      expect(sitemapExists).toBe(false);
    }
  });
});

describe('getOutputFilePath (path-traversal guard)', () => {
  const out = path.resolve(PROJECT_ROOT, 'dist', 'client');

  it('resolves a simple nested route under the output dir', () => {
    const p = getOutputFilePath('/users/alice', out);
    expect(p).toBe(path.join(out, 'users', 'alice', 'index.html'));
    expect(p.startsWith(out + path.sep)).toBe(true);
  });

  it('resolves root to outDir/index.html', () => {
    const p = getOutputFilePath('/', out);
    expect(p).toBe(path.join(out, 'index.html'));
  });

  it('throws on a traversal attempt via .. segments', () => {
    expect(() => getOutputFilePath('/../../etc/passwd', out)).toThrow();
  });

  it('throws when a substituted param value escapes the output dir', () => {
    // Simulates a malicious generateStaticParams value spliced into the route.
    expect(() => getOutputFilePath('/users/../../../etc/passwd', out)).toThrow();
  });
});
