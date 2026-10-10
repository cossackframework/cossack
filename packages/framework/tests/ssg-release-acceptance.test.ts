// @vitest-environment node
import 'reflect-metadata';
import { it, expect, vi } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { cossackPages, cossackLang, cossackMiddlewares, cossackConfig } from '../src/vite-plugin';
import { cossackSecurityPlugin } from '../src/vite-security-plugin';
import { cossackSsg } from '../src/vite-ssg-plugin';

function fixture() {
  const root = mkdtempSync(path.join(process.cwd(), '.rt21-production-'));
  const write = (file: string, content: string) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  write('package.json', '{"type":"module"}');
  write('tsconfig.json', JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }));
  write('src/client/entry-client.ts', 'console.log("SSG production acceptance");');
  write('src/pages/public/index.ts', page('true', '<main>Public SSG artifact</main>'));
  write('src/pages/live/index.ts', page('false', '<main>Live page</main>'));
  return { root, write, outDir: path.join(root, 'dist/client') };
}
function page(ssg: string, content: string, body = '') {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
@Page({ssg: ${ssg}, transport:'http'})
export default class AcceptancePage extends Cossack {
${body}
render() { return html\`${content}\`; }
}`;
}
async function productionBuild(root: string) {
  return build({ root, configFile: false, logLevel: 'silent',
    plugins: [cossackSecurityPlugin(), cossackPages(), cossackLang(), cossackMiddlewares(), cossackConfig(),
      cossackSsg({ baseUrl: 'https://release.example.test' })],
    build: { outDir: 'dist/client', manifest: true, target: 'esnext',
      rolldownOptions: { input: path.join(root, 'src/client/entry-client.ts') } },
  });
}
it('builds real public HTML, accurate skip reports and public sitemap URLs with the supported compiler baseline', async () => {
  const { root, outDir } = fixture();
  try {
    vi.stubEnv('VITEST', '');
    await productionBuild(root);
    const html = readFileSync(path.join(outDir, 'public/index.html'), 'utf8');
    expect(html).toContain('Public SSG artifact');
    const manifest = JSON.parse(readFileSync(path.join(outDir, '.vite/manifest.json'), 'utf8'));
    expect(html).toContain(`src="/${manifest['src/client/entry-client.ts'].file}"`);
    expect(existsSync(path.join(outDir, manifest['src/client/entry-client.ts'].file))).toBe(true);
    expect(existsSync(path.join(outDir, 'live/index.html'))).toBe(false);
    const sitemap = readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('https://release.example.test/public');
    expect(sitemap).not.toContain('/live');
    expect(JSON.parse(readFileSync(path.join(outDir, 'routes.json'), 'utf8'))).toEqual(['/public']);
    const report = JSON.parse(readFileSync(path.join(outDir, 'cossack-ssg-report.json'), 'utf8'));
    expect(report.version).toBe(1);
    expect(report.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ routePath: '/public', sourceFile: '/src/pages/public/index.ts', status: 'rendered',
        outputPath: path.join(outDir, 'public/index.html'), durationMs: expect.any(Number) }),
      expect.objectContaining({ routePath: '/live', sourceFile: '/src/pages/live/index.ts', status: 'skipped' }),
    ]));
  } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
}, 60_000);

it.each(['invalid parameters', 'duplicate output', 'protected output'])('rejects %s without publishing partial HTML or a sitemap', async failure => {
  const { root, outDir, write } = fixture();
  const code = failure === 'invalid parameters' ? 'COSSACK_SSG_INVALID_PARAMS'
    : failure === 'duplicate output' ? 'COSSACK_SSG_DUPLICATE_OUTPUT' : 'COSSACK_SSG_NOT_PUBLIC';
  const source = failure === 'protected output' ? 'src/pages/protected/index.ts' : 'src/pages/items/[id]/index.ts';
  write(source, failure === 'protected output'
    ? page('true', '<main>Private sentinel must not publish</main>', 'async init() { this.c.header("Set-Cookie", "secret=private"); }')
    : page(`{generateStaticParams: async () => ${failure === 'invalid parameters' ? '[{id:"../escape"}]' : '[{id:"same"},{id:"same"}]'}}`, '<main>Dynamic output</main>'));
  try {
    vi.stubEnv('VITEST', '');
    const error = await productionBuild(root).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(code);
    expect(error.message).toContain('/' + source);
    expect(existsSync(path.join(outDir, 'public/index.html'))).toBe(false);
    expect(existsSync(path.join(outDir, 'protected/index.html'))).toBe(false);
    expect(existsSync(path.join(outDir, 'items/same/index.html'))).toBe(false);
    expect(existsSync(path.join(outDir, 'sitemap.xml'))).toBe(false);
    expect(existsSync(path.join(outDir, 'routes.json'))).toBe(false);
    const report = JSON.parse(readFileSync(path.join(outDir, 'cossack-ssg-report.json'), 'utf8'));
    expect(report.outcomes).toEqual(expect.arrayContaining([expect.objectContaining({
      sourceFile: '/' + source, status: 'failed', diagnostic: expect.objectContaining({ code }),
    })]));
    expect(report.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ routePath: '/live', status: 'skipped' }),
      expect.objectContaining({ routePath: '/public', status: failure === 'protected output' ? 'rendered' : 'skipped' }),
    ]));
    expect(JSON.stringify(report)).not.toContain('secret=private');
    expect(JSON.stringify(report)).not.toContain('Private sentinel');
  } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
}, 60_000);

// A global bootstrap middleware that redirects the anonymous request (for
// example to a login page) makes the public route non-public. The real build
// fails before any HTML or sitemap is published, and the previous successful
// output is cleared rather than surviving as a deployable stale page.
it('rejects a route redirected by global bootstrap middleware without publishing HTML or a sitemap', async () => {
  const { root, outDir, write } = fixture();
  vi.stubEnv('VITEST', '');
  try { await productionBuild(root); } finally { vi.unstubAllEnvs(); }
  expect(existsSync(path.join(outDir, 'public/index.html'))).toBe(true);
  expect(existsSync(path.join(outDir, 'sitemap.xml'))).toBe(true);
  write('src/bootstrap/middlewares.ts', `export default [async (c: any, next: () => Promise<void>) => {
  if (c.req.path === '/public') return c.redirect('/login');
  await next();
}];`);
  try {
    vi.stubEnv('VITEST', '');
    const error = await productionBuild(root).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('COSSACK_SSG_NOT_PUBLIC');
    expect(error.message).toContain('/src/pages/public/index.ts');
    expect(existsSync(path.join(outDir, 'public/index.html'))).toBe(false);
    expect(existsSync(path.join(outDir, 'sitemap.xml'))).toBe(false);
    const report = JSON.parse(readFileSync(path.join(outDir, 'cossack-ssg-report.json'), 'utf8'));
    expect(report.outcomes).toEqual(expect.arrayContaining([expect.objectContaining({
      sourceFile: '/src/pages/public/index.ts', status: 'failed', diagnostic: expect.objectContaining({ code: 'COSSACK_SSG_NOT_PUBLIC' }),
    })]));
  } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
}, 60_000);
