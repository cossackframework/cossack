// @vitest-environment node
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { SsgPublicRouteError } from '../src/ssg-request';
const fixture = vi.hoisted(() => ({ pages: {} as Record<string, unknown>, routes: [] as any[], render: vi.fn(), params: vi.fn() }));
vi.mock('virtual:cossack-pages', () => ({ default: { pages: fixture.pages, layouts: {} } }));
vi.mock('virtual:cossack-config', () => ({ default: {}, requirements: {} }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-lang', () => ({ supportedLocales: [], defaultLocale: 'en', loadCatalog: vi.fn() }));
vi.mock('../src/ssg-renderer.js', () => ({ collectSsgRoutes: () => fixture.routes, getStaticParams: fixture.params, renderSsgPage: fixture.render }));
import { drainRenderedHtml, runSsg } from '../src/ssg-entry';
const args = { manifest: { filePathToId: {} } as any, outDir: '/tmp/cossack-ssg-report' };
function route(routePath: string, filePath: string, params: unknown = [{}]) {
  const value = { routePath, filePath, component: class {}, pageOptions: { ssg: true, params } };
  fixture.routes.push(value); fixture.pages[filePath] = {}; return value;
}
afterEach(() => { fixture.routes.length = 0; for (const key of Object.keys(fixture.pages)) delete fixture.pages[key]; fixture.render.mockReset(); fixture.params.mockReset(); drainRenderedHtml(); vi.restoreAllMocks(); });
function defaults() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixture.params.mockImplementation(async options => options.params);
  fixture.render.mockResolvedValue('<html>public</html>');
}
it('reports a mixed render, disabled, empty-parameter and protected fixture with source and output context', async () => {
  defaults(); route('/public/:id', '/src/pages/public/[id]/index.ts', [{ id: 'one' }, { id: 'two' }]);
  route('/empty/:id', '/src/pages/empty/[id]/index.ts', []);
  route('/private', '/src/pages/private/index.ts'); fixture.pages['/src/pages/disabled/index.ts'] = {};
  fixture.render.mockImplementation(async (_component, url) => { if (url === '/private') throw new SsgPublicRouteError(url, 'private sentinel'); return `<html>${url}</html>`; });
  const result = await runSsg(args);
  expect(result.rendered).toEqual(['/public/one', '/public/two']);
  expect(result.outcomes.map(item => item.status)).toEqual(['skipped', 'rendered', 'rendered', 'skipped', 'failed']);
  expect(result.outcomes).toContainEqual(expect.objectContaining({ routePath: '/public/one', sourceFile: '/src/pages/public/[id]/index.ts', params: { id: 'one' }, outputPath: '/tmp/cossack-ssg-report/public/one/index.html', durationMs: expect.any(Number) }));
  expect(result.outcomes.find(item => item.routePath === '/private')?.diagnostic?.code).toBe('COSSACK_SSG_NOT_PUBLIC');
  expect(result.outcomes.every(item => Number.isFinite(item.durationMs) && item.durationMs >= 0)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private sentinel'); expect(drainRenderedHtml()).toEqual([]);
});
it.each([null, {}, [null], [{ id: 2 }], [{}], [{ id: '../outside' }], [{ id: 'x?secret' }]])('rejects malformed static params %j before any render', async params => {
  defaults(); route('/valid', '/src/pages/valid/index.ts'); route('/bad/:id', '/src/pages/bad/[id]/index.ts', params);
  const result = await runSsg(args);
  expect(result.failed).toHaveLength(1); expect(result.outcomes.find(item => item.status === 'failed')).toMatchObject({ sourceFile: '/src/pages/bad/[id]/index.ts', diagnostic: { code: 'COSSACK_SSG_INVALID_PARAMS' } });
  expect(fixture.render).not.toHaveBeenCalled(); expect(drainRenderedHtml()).toEqual([]);
});
it('rejects duplicate parameter outputs before rendering', async () => {
  defaults(); route('/same/:id', '/src/pages/same/[id]/index.ts', [{ id: 'duplicate' }, { id: 'duplicate/' }]);
  const result = await runSsg(args);
  expect(result.failed).toHaveLength(2); expect(result.outcomes.filter(item => item.diagnostic?.code === 'COSSACK_SSG_DUPLICATE_OUTPUT')).toHaveLength(2);
  expect(fixture.render).not.toHaveBeenCalled(); expect(drainRenderedHtml()).toEqual([]);
});
it('drains all successful public outputs once and resets between runs', async () => {
  defaults(); route('/one', '/src/pages/one/index.ts');
  const result = await runSsg(args); expect(result.failed).toEqual([]); expect(result.outcomes[0].status).toBe('rendered');
  expect(drainRenderedHtml()).toEqual([{ routePath: '/one', html: '<html>public</html>' }]); expect(drainRenderedHtml()).toEqual([]);
  await runSsg(args); expect(drainRenderedHtml()).toHaveLength(1);
});

it('publishes aliases from one canonical render and rejects alias collisions before rendering', async () => {
  defaults(); route('/article', '/src/pages/article.md');
  fixture.routes[0].frontmatter = { aliases: ['/docs'], canonical: '/article' };
  const result = await runSsg(args);
  expect(result.failed).toEqual([]); expect(fixture.render).toHaveBeenCalledTimes(1);
  const pages = drainRenderedHtml();
  expect(pages.map(page => page.routePath)).toEqual(['/article', '/docs']);
  expect(pages[0].html).toBe(pages[1].html); expect(pages[1].canonicalUrl).toContain('/article');
  fixture.routes.length = 0; for (const key of Object.keys(fixture.pages)) delete fixture.pages[key]; fixture.render.mockClear();
  route('/article', '/src/pages/article.md');
  fixture.routes[0].frontmatter = { aliases: ['/docs'] }; route('/docs', '/src/pages/docs.ts');
  const collision = await runSsg(args);
  expect(collision.failed).toHaveLength(2); expect(fixture.render).not.toHaveBeenCalled(); expect(drainRenderedHtml()).toEqual([]);
});
