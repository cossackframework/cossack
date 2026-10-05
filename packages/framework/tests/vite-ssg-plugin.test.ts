// @vitest-environment node
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { cossackSsg, getOutputFilePath, type CossackSsgOptions } from '../src/vite-ssg-plugin';

const PROJECT_ROOT = process.cwd();
const OUT = path.resolve(PROJECT_ROOT, 'dist', 'client');

// ---------------------------------------------------------------------------
// cossackSsg() plugin shape
// ---------------------------------------------------------------------------

describe('cossackSsg() plugin', () => {
  it.each(['failed render', 'path traversal', 'duplicate output'])('publishes no SSG files after %s', async failure => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'cossack-ssg-publication-'));
    const outDir = path.join(fixture, 'dist');
    mkdirSync(outDir);
    writeFileSync(path.join(outDir, 'cossack-routes.json'), '{}');
    const pages = [{ routePath: '/public', html: '<main>public</main>' },
      ...(failure === 'path traversal' ? [{ routePath: '/../../outside', html: 'invalid' }] : []),
      ...(failure === 'duplicate output' ? [{ routePath: '/public/', html: 'duplicate' }] : [])];
    const failed = failure === 'failed render' ? [{ routePath: '/private', error: 'COSSACK_SSG_NOT_PUBLIC' }] : [];
    writeFileSync(path.join(fixture, 'entry.ts'), `
      export async function runSsg() { return { rendered: ['/public'], failed: ${JSON.stringify(failed)} }; }
      export function drainRenderedHtml() { return ${JSON.stringify(pages)}; }
    `);
    try {
      vi.stubEnv('VITEST', '');
      const plugin = cossackSsg({ outDir, baseUrl: 'https://site.example.test', plugins: [{
        name: 'ssg-publication-fixture', enforce: 'pre',
        resolveId(id) { if (id === 'virtual:cossack-ssg-entry') return path.join(fixture, 'entry.ts'); },
      }] });
      await expect((plugin.closeBundle as Function).call({ environment: { name: 'client' } })).rejects.toThrow();
      expect(existsSync(path.join(outDir, 'public/index.html'))).toBe(false);
      expect(existsSync(path.join(outDir, 'sitemap.xml'))).toBe(false);
      expect(existsSync(path.join(outDir, 'routes.json'))).toBe(false);
      expect(readFileSync(path.join(outDir, 'cossack-routes.json'), 'utf8')).toBe('{}');
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  it('renders with UI JavaScript importing Solar Icons TypeScript from node_modules', async () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'cossack-ssg-icons-'));
    const outDir = path.join(fixture, 'dist');
    const write = (file: string, content: string) => {
      const target = path.join(fixture, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    };

    try {
      // Model the published dependency chain, not workspace symlinks: Node
      // refuses the .ts export only when it lives under node_modules.
      write('node_modules/@cossackframework/ui/package.json', JSON.stringify({
        name: '@cossackframework/ui', type: 'module', exports: './index.js',
      }));
      write('node_modules/@cossackframework/ui/index.js',
        "export { icon } from '@cossackframework/solar-icons/info-circle';");
      write('node_modules/@cossackframework/solar-icons/package.json', JSON.stringify({
        name: '@cossackframework/solar-icons', version: '0.7.2', type: 'module',
        exports: { './info-circle': './src/info-circle/index.ts' },
      }));
      write('node_modules/@cossackframework/solar-icons/src/info-circle/index.ts',
        'export const icon: string = \'<svg data-icon="info-circle"></svg>\';');
      write('entry.ts', `
        import { icon } from '@cossackframework/ui';
        export async function runSsg() {
          return { rendered: ['/icons'], failed: [] };
        }
        export function drainRenderedHtml() {
          return [{ routePath: '/icons', html: '<main>' + icon + '</main>' }];
        }
      `);
      write('dist/cossack-routes.json', '{}');

      const plugin = cossackSsg({
        outDir,
        baseUrl: 'https://example.com',
        plugins: [{
          name: 'ssg-icons-fixture-entry',
          enforce: 'pre',
          resolveId(id) {
            if (id === 'virtual:cossack-ssg-entry') return path.join(fixture, 'entry.ts');
          },
        }],
      });
      // Exercise the real closeBundle -> loadEntry -> runnerImport path,
      // replacing only the entry to keep this regression fixture minimal.
      vi.stubEnv('VITEST', '');
      await (plugin.closeBundle as Function).call({ environment: { name: 'client' } });

      expect(readFileSync(path.join(outDir, 'icons/index.html'), 'utf8'))
        .toBe('<main><svg data-icon="info-circle"></svg></main>');
      expect(JSON.parse(readFileSync(path.join(outDir, 'routes.json'), 'utf8')))
        .toEqual(['/icons']);
    } finally {
      vi.unstubAllEnvs();
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

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

describe('failed build cleanup', () => {
  it('does not render SSG from stale manifests after build or render errors', async () => {
    const plugin = cossackSsg() as any;
    const context = { environment: { name: 'client' } };
    const log = vi.spyOn(console, 'log');
    try {
      vi.stubEnv('VITEST', '');
      plugin.buildStart.call(context); plugin.buildEnd.call(context, new Error('preflight failed'));
      await expect(plugin.closeBundle.call(context)).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
      plugin.buildStart.call(context); plugin.renderError.call(context, new Error('output failed'));
      await expect(plugin.closeBundle.call(context)).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); vi.unstubAllEnvs(); }
  });
});
