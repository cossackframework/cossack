import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Cossack, CossackService, Page, Service, Inject, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { renderSsgPage } from '../src/ssg-renderer';
// CLI is a JavaScript package; these integration-only imports have no declarations.
// @ts-expect-error JS CLI entry point
import { buildEffectiveRouteModel } from 'cossack/src/scan-routes.js';
// @ts-expect-error JS CLI entry point
import { inspectCommand, checkCommand } from 'cossack/src/commands/inspect.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

it('matches inspected layout declarations with executed service sharing, shadowing, state, and disposal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-service-inspection-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  const disposed: string[] = [];
  @Service()
  class Counter extends CossackService {
    @State() label = 'fresh';
    @State() count = 0;
    onDispose() { disposed.push(this.label); }
  }
  @Service()
  class PageOnly extends CossackService { constructor() { super(); throw new Error('page declarations must not instantiate'); } }
  const sources = {
    '/src/pages/layout.ts': `@Page({ services: [Counter] })
      class Root extends Cossack {
        @Inject(Counter) counter!: Counter;
        init() { this.counter.label = 'root'; }
        render() { return html\`<aside>\${this.counter.label}:\${this.counter.count}</aside>\${this.children}\`; }
      }`,
    '/src/pages/(account)/layout.ts': `@Page({ services: [Counter] })
      class Inner extends Cossack {
        @Inject(Counter) counter!: Counter;
        init() { this.counter.label = 'inner'; }
        render() { return html\`<section>\${this.children}</section>\`; }
      }`,
    '/src/pages/(account)/users/[id]/index.ts': `@Page({ ssg: true })
      class Users extends Cossack {
        @Inject(Counter) counter!: Counter;
        init() { this.counter.count++; }
        render() { return html\`<main>\${this.counter.label}:\${this.counter.count}</main>\`; }
      }`,
  };
  const classes: Record<string, any> = {};
  for (const [file, source] of Object.entries(sources)) {
    const name = source.match(/class (\w+)/)![1];
    const absolute = path.join(root, file.slice(1));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, `${source}\nexport default ${name};`);
  }
  // Emit these source fixtures with real legacy decorators. Runtime dependencies
  // are supplied below so both inspection and rendering use the same declarations.
  const require = createRequire(import.meta.url);
  const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc');
  await promisify(execFile)(process.execPath, [tsc, '--noCheck', '--experimentalDecorators', '--useDefineForClassFields', 'false',
    '--target', 'ES2022', '--module', 'commonjs', '--rootDir', path.join(root, 'src'), '--outDir', path.join(root, 'compiled'),
    ...Object.keys(sources).map(file => path.join(root, file.slice(1))) ], { cwd: root }).catch(error => { throw new Error(String(error.stdout || error.stderr || error)); });
  for (const file of Object.keys(sources)) {
    const js = await fs.readFile(path.join(root, 'compiled', file.slice('/src/'.length).replace(/\.ts$/, '.js')), 'utf8');
    classes[file] = new Function('Cossack', 'Page', 'Inject', 'Counter', 'html', 'exports', `${js}; return exports.default;`)(Cossack, Page, Inject, Counter, html, {});
  }
  const model = await buildEffectiveRouteModel(root);
  const page = model.pages[0];
  expect(page.route).toBe('/users/:id');
  expect(page.layouts).toEqual(['/src/pages/layout.ts', '/src/pages/(account)/layout.ts']);
  const layouts = Object.fromEntries(page.layouts.map((file: string) => [file, { default: classes[file] }]));
  const routeIds = Object.fromEntries(model.layouts.map((layout: any) => [layout.filePath, layout.routeId]));
  const output = await renderSsgPage(classes[page.filePath], '/users/[id]', { id: 'alice' }, layouts,
    'https://example.test', undefined, undefined, page.filePath, page.routeId, undefined, undefined, routeIds);
  expect(output.replace(/<!--[\s\S]*?-->/g, '')).toContain('<main>inner:1</main>');
  const state = JSON.parse(output.match(/window\.__INITIAL_STATE__\s*=\s*(.*?)<\/script>/s)![1]);
  expect(state._layout_stack.map((entry: any) => entry.componentRouteId)).toEqual(page.layouts.map((file: string) => routeIds[file]));
  expect(state._layout_stack.map((entry: any) => entry.state.services['0'])).toEqual([
    { label: 'root', count: 0 }, { label: 'inner', count: 1 },
  ]);
  for (const layout of model.layouts) expect(layout.services).toEqual(['Counter']);
  expect(disposed).toEqual(['inner', 'root']);

  const ctx = { cwd: root, flags: { json: true } };
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await checkCommand(['routes'], ctx)).toBe(0);
  expect(await inspectCommand(['routes', '/users/:id'], ctx)).toBe(0);
  expect(JSON.parse(String(log.mock.calls.at(-1)![0])).data.reasons.join(' ')).toContain('Counter (/src/pages/(account)/layout.ts)');

  // A page option is syntactically valid but does not establish a service scope.
  Page({ ssg: true, services: [PageOnly] })(classes[page.filePath]);
  const pagePath = path.join(root, page.filePath.slice(1));
  await fs.writeFile(pagePath, (await fs.readFile(pagePath, 'utf8')).replace('ssg: true', 'ssg: true, services: [PageOnly]'));
  await expect(renderSsgPage(classes[page.filePath], '/users/[id]', { id: 'alice' }, layouts,
    'https://example.test', undefined, undefined, page.filePath)).resolves.toContain('inner');
  expect(await checkCommand(['routes'], ctx)).toBe(1);
  expect(JSON.parse(String(log.mock.calls.at(-1)![0])).diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'COSSACK_PAGE_SERVICES_UNSUPPORTED', source: expect.stringContaining(page.filePath) }),
  ]));
  expect(await inspectCommand(['routes', '/users/:id'], ctx)).toBe(0);
  expect(JSON.parse(String(log.mock.calls.at(-1)![0])).data.reasons.join(' ')).toContain('not owned at runtime: PageOnly');
});
