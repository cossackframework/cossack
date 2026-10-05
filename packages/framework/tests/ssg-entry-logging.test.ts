// @vitest-environment node
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { SsgPublicRouteError } from '../src/ssg-request';
const fixture = vi.hoisted(() => ({ routes: [] as any[], render: vi.fn(), params: vi.fn() }));
vi.mock('virtual:cossack-pages', () => ({ default: { pages: {}, layouts: {} } }));
vi.mock('virtual:cossack-config', () => ({ default: {}, requirements: {} }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-lang', () => ({ supportedLocales: [], defaultLocale: 'en', loadCatalog: vi.fn() }));
vi.mock('../src/ssg-renderer.js', () => ({ collectSsgRoutes: () => fixture.routes, getStaticParams: fixture.params, renderSsgPage: fixture.render }));
import { drainRenderedHtml, runSsg } from '../src/ssg-entry';
afterEach(() => { fixture.render.mockReset(); fixture.params.mockReset(); drainRenderedHtml(); vi.restoreAllMocks(); });
const args = { manifest: { filePathToId: {} } as any, outDir: '/unused' };
it.each(['error', 'arbitrary object', 'proxy', 'public route'])('redacts %s failures in logs and SSG results', async kind => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  fixture.routes = [{ routePath: '/authored', filePath: '/src/pages/authored/index.ts', component: class {}, pageOptions: { ssg: true } }];
  fixture.params.mockResolvedValue([{}]);
  const failure = kind === 'error' ? new Error('PRIVATE_SSG_EXCEPTION_SENTINEL')
    : kind === 'public route' ? new SsgPublicRouteError('/PRIVATE_SSG_PATH_SENTINEL', 'PRIVATE_SSG_EXCEPTION_SENTINEL')
    : kind === 'proxy' ? new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE_PROXY_SENTINEL'); } })
    : { toString() { throw new Error('PRIVATE_SSG_TOSTRING_SENTINEL'); }, secret: 'PRIVATE_SSG_EXCEPTION_SENTINEL' };
  fixture.render.mockRejectedValue(failure);
  const result = await runSsg(args);
  expect(result).toEqual({ rendered: [], failed: [{ routePath: '/authored', error: kind === 'public route'
    ? 'COSSACK_SSG_NOT_PUBLIC: Static HTML requires a public request-independent route.'
    : 'COSSACK_RUNTIME_FAILED: Static HTML rendering failed.' }] });
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'cossack.runtime.failure', runtime: 'node', stage: 'dispatch' }));
  expect(JSON.stringify([result, spy.mock.calls])).not.toMatch(/PRIVATE_SSG_/);
  expect(drainRenderedHtml()).toEqual([]);
});
it('reports parameter-generation failures without serializing callback exceptions', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  fixture.routes = [{ routePath: '/authored/:id', filePath: '/src/pages/authored/[id]/index.ts', component: class {}, pageOptions: { ssg: true } }];
  fixture.params.mockRejectedValue(new Error('PRIVATE_STATIC_PARAMS_SENTINEL'));
  const result = await runSsg(args);
  expect(result.failed[0].error).toBe('COSSACK_RUNTIME_FAILED: Static HTML rendering failed.');
  expect(fixture.render).not.toHaveBeenCalled();
  expect(JSON.stringify([result, spy.mock.calls])).not.toContain('PRIVATE_STATIC_PARAMS_SENTINEL');
});
