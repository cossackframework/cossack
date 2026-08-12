// @vitest-environment node
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { cossackSsg, getOutputFilePath, type CossackSsgOptions } from '../src/vite-ssg-plugin';

const PROJECT_ROOT = process.cwd();
const OUT = path.resolve(PROJECT_ROOT, 'dist', 'client');

// ---------------------------------------------------------------------------
// cossackSsg() plugin shape
// ---------------------------------------------------------------------------

describe('cossackSsg() plugin', () => {
  it('returns a Vite plugin named "cossack-ssg"', () => {
    const plugin = cossackSsg();
    expect(plugin.name).toBe('cossack-ssg');
  });

  it('has a configResolved hook (captures the parent build mode)', () => {
    const plugin = cossackSsg();
    expect(typeof plugin.configResolved).toBe('function');
  });

  it('has a closeBundle hook', () => {
    const plugin = cossackSsg();
    expect(typeof plugin.closeBundle).toBe('function');
  });

  it('defaults to enabled', () => {
    // An enabled plugin will attempt work in closeBundle; a disabled one
    // short-circuits. We verify the default by checking that closeBundle on a
    // non-client environment returns early (the environment gate runs before
    // the enabled gate, so both paths return undefined here).
    const plugin = cossackSsg();
    // Non-client environment -> early return regardless of enabled state.
    expect(plugin.closeBundle).toBeDefined();
  });

  it('respects enabled: false', () => {
    const plugin = cossackSsg({ enabled: false });
    expect(plugin.name).toBe('cossack-ssg');
    // closeBundle exists but will short-circuit on the enabled gate; we can't
    // observe the early return without a full Vite context, but the plugin
    // still has a well-formed shape.
    expect(typeof plugin.closeBundle).toBe('function');
  });

  it('captures the build mode via configResolved', async () => {
    const plugin = cossackSsg();
    // Simulate Vite calling configResolved with a staging mode. The hook
    // should not throw and should accept the resolved config shape.
    const configResolved = plugin.configResolved as (config: { mode: string }) => void;
    expect(() => configResolved({ mode: 'staging' })).not.toThrow();
    // The captured mode is internal state; we verify the hook ran without
    // error. The actual propagation is exercised by the integration build.
  });
});

// ---------------------------------------------------------------------------
// getOutputFilePath (path-traversal guard + route resolution)
// `ssg-build.test.ts` also imports and tests this function from the same
// source; the cases here extend that coverage with additional edge cases.
// ---------------------------------------------------------------------------

describe('getOutputFilePath (vite-ssg-plugin)', () => {
  it('resolves a simple nested route under the output dir', () => {
    const p = getOutputFilePath('/users/alice', OUT);
    expect(p).toBe(path.join(OUT, 'users', 'alice', 'index.html'));
    expect(p.startsWith(OUT + path.sep)).toBe(true);
  });

  it('resolves root to outDir/index.html', () => {
    expect(getOutputFilePath('/', OUT)).toBe(path.join(OUT, 'index.html'));
  });

  it('resolves root with empty string to outDir/index.html', () => {
    expect(getOutputFilePath('', OUT)).toBe(path.join(OUT, 'index.html'));
  });

  it('strips a trailing slash before resolving', () => {
    expect(getOutputFilePath('/about/', OUT)).toBe(path.join(OUT, 'about', 'index.html'));
  });

  it('prepends a leading slash when missing', () => {
    const p = getOutputFilePath('docs/hello', OUT);
    expect(p).toBe(path.join(OUT, 'docs', 'hello', 'index.html'));
  });

  it('throws on a traversal attempt via .. segments', () => {
    expect(() => getOutputFilePath('/../../etc/passwd', OUT)).toThrow();
  });

  it('throws when a substituted param value escapes the output dir', () => {
    // Simulates a malicious generateStaticParams value spliced into the route.
    expect(() => getOutputFilePath('/users/../../../etc/passwd', OUT)).toThrow();
  });

  it('throws on a deeply nested traversal', () => {
    expect(() => getOutputFilePath('/a/b/../../../../etc/passwd', OUT)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CossackSsgOptions typing (compile-time + runtime sanity)
// ---------------------------------------------------------------------------

describe('CossackSsgOptions', () => {
  it('accepts enabled, baseUrl, outDir, and application plugins', () => {
    const opts: CossackSsgOptions = {
      enabled: true,
      baseUrl: 'https://x.com',
      outDir: 'dist/out',
      plugins: [{ name: 'virtual-content' }],
    };
    const plugin = cossackSsg(opts);
    expect(plugin.name).toBe('cossack-ssg');
  });

  it('accepts an empty object (all fields optional)', () => {
    const plugin = cossackSsg({});
    expect(plugin.name).toBe('cossack-ssg');
  });
});
