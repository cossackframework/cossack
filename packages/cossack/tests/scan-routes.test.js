import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeRouteIds } from '@cossackframework/framework/route-ids';
import {
  filePathToHttpRoute,
  classifyRoute,
  scanPagesDir,
  buildRouteModel,
  buildEffectiveRouteModel,
  extractRouteParams,
  extractPageOptions,
  nearestSpecialPage,
  layoutStackForPage,
} from '../src/scan-routes.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-routes-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('filePathToHttpRoute (mirrors router.ts)', () => {
  it('basic page', () => {
    expect(filePathToHttpRoute('/src/pages/contact/index.ts')).toBe('/contact');
  });
  it('root index', () => {
    expect(filePathToHttpRoute('/src/pages/index/index.ts')).toBe('/');
  });
  it('flat index file', () => {
    expect(filePathToHttpRoute('/src/pages/index.ts')).toBe('/');
  });
  it('dynamic param', () => {
    expect(filePathToHttpRoute('/src/pages/hello/[name]/index.ts')).toBe(
      '/hello/:name',
    );
  });
  it('route group stripped', () => {
    expect(filePathToHttpRoute('/src/pages/(auth)/login/index.ts')).toBe(
      '/login',
    );
  });
  it('nested route group', () => {
    expect(
      filePathToHttpRoute('/src/pages/dashboard/(admin)/settings/index.ts'),
    ).toBe('/dashboard/settings');
  });
  it('mdx extension', () => {
    expect(filePathToHttpRoute('/src/pages/blog/post.mdx')).toBe('/blog/post');
  });
});

describe('classifyRoute', () => {
  it('detects 404', () => {
    expect(classifyRoute('/404')).toBe('404');
  });
  it('detects error', () => {
    expect(classifyRoute('/error')).toBe('error');
  });
  it('detects api', () => {
    expect(classifyRoute('/api/hello')).toBe('api');
  });
  it('defaults to page', () => {
    expect(classifyRoute('/contact')).toBe('page');
  });
  it('does not classify ordinary API-prefixed names as API routes', () => {
    expect(classifyRoute('/api-products')).toBe('page');
  });
});

describe('scanPagesDir + buildRouteModel', () => {
  it('collects pages and layouts, excludes loading.ts', () => {
    mk('src/pages/index/index.ts', '');
    mk('src/pages/contact/index.ts', '');
    mk('src/pages/contact/layout.ts', '');
    mk('src/pages/contact/loading.ts', '');
    mk('src/pages/blog/post.mdx', '');
    mk('src/pages/hello/[name]/index.ts', '');

    const model = buildRouteModel(tmp, { includeMarkdown: true });
    const routes = model.pages.map((p) => p.route).sort();
    expect(routes).toEqual(['/', '/blog/post', '/contact', '/hello/:name']);
    expect(model.layouts.map((l) => l.filePath)).toEqual([
      '/src/pages/contact/layout.ts',
    ]);
  });

  it('handles missing pages dir gracefully', () => {
    const model = buildRouteModel(tmp);
    expect(model.pages).toEqual([]);
    expect(model.layouts).toEqual([]);
  });
});

describe('layoutStackForPage', () => {
  it('collects root-first layout chain', () => {
    const layoutKeys = [
      '/src/pages/layout.ts',
      '/src/pages/dashboard/layout.ts',
    ];
    const stack = layoutStackForPage(
      '/src/pages/dashboard/settings/index.ts',
      layoutKeys,
    );
    expect(stack).toEqual([
      '/src/pages/layout.ts',
      '/src/pages/dashboard/layout.ts',
    ]);
  });
  it('returns empty when no layouts', () => {
    expect(layoutStackForPage('/src/pages/x/index.ts', [])).toEqual([]);
  });
});

function mk(rel, content) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}


describe('effective route metadata (RT-07)', () => {
  function write(relative, content) {
    const target = path.join(tmp, 'proj', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  function project() { return path.join(tmp, 'proj'); }

  it('extracts dynamic and catch-all parameters', () => {
    expect(extractRouteParams('/users/:id/posts')).toEqual([{ name: 'id', catchAll: false }]);
    // Framework catch-all form: :name{.+} (Hono multi-segment parameter).
    expect(extractRouteParams('/files/:path{.+}')).toEqual([{ name: 'path', catchAll: true }]);
    expect(extractRouteParams('/plain/route')).toEqual([]);
    // Route derivation mirrors the framework, including catch-alls.
    expect(filePathToHttpRoute('/src/pages/docs/[...path]/index.ts')).toBe('/docs/:path{.+}');
  });

  it('extracts @Page options from source without executing modules', () => {
    expect(extractPageOptions("@Page({ transport: 'sse', ssg: true })\nclass P {}"))
      .toEqual({ transport: 'sse', ssg: true, middlewares: 0, services: [], decoratorLine: 1 });
    expect(extractPageOptions("@Page({ services: [Session, Audit] })\nclass Q {}"))
      .toMatchObject({ services: ['Session', 'Audit'] });
    expect(extractPageOptions("import x;\n@Page({ middlewares: [async (c, n) => { await n(); }, (c) => c.text('x')] })"))
      .toMatchObject({ transport: null, ssg: null, middlewares: 2, decoratorLine: 2 });
    expect(extractPageOptions('class Plain {}')).toEqual({ transport: null, ssg: null, middlewares: 0, services: [], decoratorLine: null });
  });

  it('builds per-page effective metadata: id, params, layouts, boundaries', async () => {
    write('src/pages/layout.ts', 'export default class Layout {}');
    write('src/pages/dashboard/layout.ts', 'export default class DashLayout {}');
    write('src/pages/dashboard/users/[id]/index.ts', "@Page({ transport: 'http' })\nexport default class UserPage {}");
    write('src/pages/dashboard/404/index.ts', 'export default class NotFound {}');
    write('src/pages/docs/[...path]/index.ts', "@Page({ transport: 'http', ssg: true })\nexport default class DocPage {}");

    const model = await buildEffectiveRouteModel(project());
    const user = model.pages.find((page) => page.route === '/dashboard/users/:id');
    expect(user).toMatchObject({
      routeId: expect.stringMatching(/^cmp_/),
      params: [{ name: 'id', catchAll: false }],
      layouts: ['/src/pages/layout.ts', '/src/pages/dashboard/layout.ts'],
      notFoundBoundary: '/src/pages/dashboard/404/index.ts',
      transport: 'http',
    });
    const doc = model.pages.find((page) => page.route === '/docs/:path{.+}');
    expect(doc).toMatchObject({ params: [{ name: 'path', catchAll: true }], ssg: true });
    // Route ids are unique and stable across the sorted index space.
    const ids = model.pages.map((page) => page.routeId);
    expect(new Set(ids).size).toBe(ids.length);
    const runtimeIds = computeRouteIds(model.pages.map(page => page.filePath), model.layouts.map(layout => layout.filePath));
    for (const page of model.pages) {
      expect(page.routeId).toBe(runtimeIds.routePathToIdMap.get(page.filePath));
    }
  });

  it('uses runtime route precedence before assigning IDs', async () => {
    write('src/pages/(fallback)/home/index.ts', 'class Fallback {}');
    write('src/pages/home/index.ts', 'class Home {}');
    write('src/pages/layout.ts', 'class Layout {}');
    const model = await buildEffectiveRouteModel(project());
    expect(model.pages.map(page => page.filePath)).toEqual(['/src/pages/home/index.ts']);
  });

  it('finds the nearest special page without executing it', () => {
    const pages = [
      { filePath: '/src/pages/404/index.ts' },
      { filePath: '/src/pages/dashboard/404/index.ts' },
      { filePath: '/src/pages/dashboard/users/index.ts' },
    ];
    expect(nearestSpecialPage('/src/pages/dashboard/users/index.ts', pages, '404'))
      .toBe('/src/pages/dashboard/404/index.ts');
    expect(nearestSpecialPage('/src/pages/contact/index.ts', pages, '404'))
      .toBe('/src/pages/404/index.ts');
  });
});

describe('AST-backed option extraction (CLI-04/RT-07/RT-12)', () => {
  it('does not invent static facts for spreads, dynamic properties, or invalid syntax', async () => {
    mk('src/pages/spread/index.ts', "@Page({ ...options, transport: 'sse' }) export default class P {}");
    mk('src/pages/property/index.ts', '@Page({ transport: selected }) export default class P {}');
    mk('src/pages/invalid/index.ts', "@Page({ transport: 'sse' }) export default 1;");
    const model = await buildEffectiveRouteModel(tmp);
    for (const page of model.pages) {
      expect(page.extraction.method).toBe('unknown');
      expect(page.transport).toBeNull();
    }
  });

  it.each([
    "ssg: { ...settings }",
    "ssg: { enabled: true, ...settings }",
    "ssg: { [key]: false }",
    "ssg: { enabled: 'false' }",
    "ssg: 'false'",
    "transport: null",
    "transport: 42",
    "middlewares: [, handler]",
  ])('reports unresolved or invalid options honestly: %s', async options => {
    mk('src/pages/options/index.ts', `@Page({ ${options} }) export default class P {}`);
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.extraction.method).toBe('unknown');
    expect(page.ssg).toBeNull();
    expect(page.transport).toBeNull();
  });

  it('uses the final static ssg.enabled property like JavaScript', async () => {
    mk('src/pages/options/index.ts', '@Page({ ssg: { enabled: true, enabled: false } }) export default class P {}');
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.extraction.method).toBe('ast');
    expect(page.ssg).toBe(false);
  });

  it('resolves declared field/prototype precedence from compiler facts', async () => {
    mk('src/shared/base.ts', 'export default class Base extends Cossack { action = () => 1; }');
    mk('src/pages/dispatch/index.ts', "import Base from '../../shared/base.js'; @Page() export default class P extends Base { @Client() action() { return 2; } }");
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.declarationDispatch.status).toBe('resolved');
    expect(page.declarationDispatch.members.find(member => member.name === 'action')).toEqual({ name: 'action', owner: 'Base', source: '/src/shared/base.ts', kind: 'field' });
  });

  it('resolves relative imported bases through aliases and explicit re-exports', async () => {
    mk('src/shared/base.ts', `
      export class Base extends Cossack { @Server() load() { return 'private'; } }
      export default class Parent extends Base { @Client() local() { return 1; } }
    `);
    mk('src/shared/barrel.ts', "export { default as ParentAlias } from './base.js';");
    mk('src/pages/imported/index.ts', `
      import { ParentAlias as Imported } from '../../shared/barrel.js';
      @Page() export default class P extends Imported { render() { return 1; } }
    `);
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.inheritance).toEqual({ status: 'resolved', bases: ['Parent', 'Base'] });
    expect(page.inheritedDeclarations.map(d => d.className)).toEqual(['Parent', 'Base']);
    expect(page.inheritedDeclarations[1].members).toContainEqual({ name: 'load', kind: 'method', static: false, private: false });
    expect(page.members).toContainEqual({ name: 'render', kind: 'method', static: false, private: false });
    expect(page.inheritedDeclarations[1].methods[0]).toMatchObject({ name: 'load', rpc: 'explicit', source: { file: '/src/shared/base.ts' } });
  });

  it('keeps cyclic re-exports and package bases unresolved without importing them', async () => {
    mk('src/shared/a.ts', "export { Base } from './b.js';");
    mk('src/shared/b.ts', "export { Base } from './a.js';");
    mk('src/pages/cycle/index.ts', "import { Base } from '../../shared/a.js'; @Page() export default class P extends Base {}");
    mk('src/pages/package/index.ts', "import Base from 'not-installed'; @Page() export default class P extends Base {}");
    const model = await buildEffectiveRouteModel(tmp);
    expect(model.pages.every(page => page.inheritance.status === 'unresolved')).toBe(true);
  });

  it('includes local base declarations with their declaring class and source', async () => {
    mk('src/pages/inherited/index.ts', `
      class Parent extends Cossack { @Server() load() { return 1; } }
      @Page() export default class P extends Parent { render() { return 2; } }
    `);
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.inheritance).toEqual({ status: 'resolved', bases: ['Parent'] });
    expect(page.inheritedDeclarations[0]).toMatchObject({ className: 'Parent', methods: [
      { name: 'load', rpc: 'explicit', source: { file: page.filePath, line: 2 } },
    ] });
    expect(page.serverMethods).toEqual([]);
  });

  it('uses namespace decorators consistently for options and compiler methods', async () => {
    mk('src/pages/namespace/index.ts', `
      import * as Core from '@cossackframework/core';
      @Core.Page({ transport: 'sse' }) export default class P {
        @Core.Client() local() { return 1; }
        @Core.Server() remote = () => 2;
      }`);
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.methodExtraction.method).toBe('compiler');
    expect(page.transport).toBe('sse');
    expect(page.serverMethods.map(m => m.name)).toEqual(['remote']);
    expect(page.clientMethods.map(m => m.name)).toEqual(['local']);
  });

  it('uses compiler facts for helpers, automatic RPC, retained fields, and stripped methods', async () => {
    mk('src/pages/compiler/index.ts', `
      @Page() export default class P {
        render() { this.helper(); return html\`<button @click=\"\${this.save}\">Save</button>\`; }
        helper() { return 1; }
        save() { return 2; }
        unused() { return 3; }
        field = () => 4;
      }`);
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.methodExtraction.method).toBe('compiler');
    expect(page.serverMethods.map(m => m.name)).toEqual(['save']);
    expect(page.clientMethods.map(m => m.name)).toEqual(['render', 'helper', 'field']);
    expect(page.strippedMethods.map(m => m.name)).toEqual(['unused']);
    expect(page.serverMethods[0]).toMatchObject({ rpc: 'automatic', source: { file: page.filePath } });
  });

  it.each(['export default Actual;', 'export { Actual as default };'])('selects an indirect default export: %s', async exportStatement => {
    mk('src/pages/selected/index.ts', `
      @Page({ transport: 'http' }) export class Helper { @Server() wrong() {} }
      @Page({ transport: 'sse' }) class Actual { @Server() correct() {} }
      ${exportStatement}`);
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page.transport).toBe('sse');
    expect(page.serverMethods.map(method => method.name)).toEqual(['correct']);
  });

  it.each(['export default class Actual {}', 'export default factory();', "export { Actual as default } from './other';"])(
    'does not substitute a decorated helper for an unresolved default: %s', async exportStatement => {
      mk('src/pages/unknown/index.ts', `@Page({ transport: 'sse' }) class Helper { @Server() wrong() {} } ${exportStatement}`);
      const page = (await buildEffectiveRouteModel(tmp)).pages[0];
      expect(page.extraction.method).toBe('unknown');
      expect(page.methodExtraction.method).toBe('unknown');
      expect(page.serverMethods).toEqual([]);
    });

  it('inspects the exported page, quoted keys, and only that page’s methods', async () => {
    mk('src/pages/scoped/index.ts', `
      @Page({ transport: 'http' }) class Helper { @Server() hidden() {} }
      @Page({ 'transport': 'sse', ssg: { enabled: true }, services: [Services.Users] })
      export default class P {
        @Server() @Shared() local() {}
        @Server() remote() {}
      }`);
    const page = (await buildEffectiveRouteModel(tmp)).pages[0];
    expect(page).toMatchObject({ transport: 'sse', ssg: true, services: ['Services.Users'] });
    expect(page.serverMethods.map(m => m.name)).toEqual(['remote']);
    expect(page.clientMethods.map(m => m.name)).toEqual(['local']);
  });
  function write(relative, content) {
    const target = path.join(tmp, 'proj2', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  function project() { return path.join(tmp, 'proj2'); }

  it('ignores comments, strings, nested objects, and trailing commas', async () => {
    write('package.json', '{}');
    write('src/pages/tricky/index.ts', [
      "// transport: 'durable-object' inside a comment",
      "const note = \"text with transport: 'no' inside a string\";",
      "@Page({ transport: 'sse', ssg: true, cache: { transport: 'not-this' }, middlewares: [async (c, next) => { await next(); }], })",
      'export default class Tricky {}',
    ].join('\n'));
    const model = await buildEffectiveRouteModel(project());
    const tricky = model.pages.find(page => page.route === '/tricky');
    expect(tricky).toMatchObject({ transport: 'sse', ssg: true, middlewares: 1 });
    expect(tricky.extraction.method).toBe('ast');
    expect(tricky.services).toEqual([]);
  });

  it('follows aliased Page imports from core', async () => {
    write('package.json', '{}');
    write('src/pages/aliased/index.ts', [
      "import { Page as Route } from '@cossackframework/core';",
      "@Route({ transport: 'http', services: [Audit] })",
      'export default class Aliased {}',
    ].join('\n'));
    const model = await buildEffectiveRouteModel(project());
    const aliased = model.pages.find(page => page.route === '/aliased');
    expect(aliased).toMatchObject({ transport: 'http' });
    expect(aliased.services).toEqual(['Audit']);
  });

  it('reports dynamic option objects as unknown with a reason', async () => {
    write('package.json', '{}');
    write('src/pages/dynamic/index.ts', [
      'const options = { transport: \'http\' };',
      '@Page(options)',
      'export default class Dynamic {}',
    ].join('\n'));
    const model = await buildEffectiveRouteModel(project());
    const dynamic = model.pages.find(page => page.route === '/dynamic');
    expect(dynamic.extraction.method).toBe('unknown');
    expect(dynamic.transport).toBeNull();
    expect(dynamic.extraction.reason).toContain('identifier options');
    expect(dynamic.extraction.reason).toContain('cannot be resolved statically');
  });
});
it('reports static stateful options and leaves dynamic durability unknown', async () => {
  const directory = path.join(tmp, 'src/pages/live');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'index.ts');
  fs.writeFileSync(file, "@Page({ transport: 'durable-object', stateful: true }) export default class Live {}");
  expect((await buildEffectiveRouteModel(tmp)).pages[0]).toMatchObject({ stateful: true, extraction: { method: 'ast' } });
  fs.writeFileSync(file, "@Page({ transport: 'durable-object', stateful: computeDurability() }) export default class Live {}");
  expect((await buildEffectiveRouteModel(tmp)).pages[0]).toMatchObject({ stateful: null, extraction: { method: 'unknown' } });
});
