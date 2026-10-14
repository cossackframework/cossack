import 'reflect-metadata';
import { transformWithOxc } from 'vite';
/**
 * Unit tests for vite-security-plugin
 * Tests the code stripping functionality to ensure server-only code is properly removed from client bundles.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  transformCossackClass,
  inspectCompilerMethods,
  injectAutomaticServerMethodMetadata,
  isClientSafeMethod,
  BUILTIN_METHODS,
  stripSsgGenerateStaticParams,
  isServerOnlyModule,
  generateServerOnlyStub,
  readImportSources,
  moduleLabelFromId,
  transformServerResources,
  stripClientServerOnlyImports,
  cossackSecurityPlugin,
  generateClientOnlyServerStub,
  isClientOnlyModuleId,
} from '../src/vite-security-plugin';

describe('ORM and session server-only imports', () => {
  const paths: string[] = [];
  let sequence = 0;

  afterEach(() => {
    for (const path of paths.splice(0)) rmSync(path, { force: true });
  });

  const fixture = (source: string) => {
    const path = join(tmpdir(), `cossack-orm-security-${sequence++}.ts`);
    writeFileSync(path, source, 'utf8');
    paths.push(path);
    return path;
  };

  it('classifies direct, subpath, re-export, and framework session imports', () => {
    expect(isServerOnlyModule(fixture(
      `import { BaseEntity } from '@cossackframework/database'; export { BaseEntity };`,
    ))).toBe(true);
    expect(isServerOnlyModule(fixture(
      `export { ormMiddleware } from '@cossackframework/database/cossack';`,
    ))).toBe(true);
    expect(isServerOnlyModule(fixture(
      `import { session } from '@cossackframework/framework/session'; export { session };`,
    ))).toBe(true);
  });

  it('removes stripped ORM imports and rejects client-safe leaks', () => {
    const safe = stripClientServerOnlyImports(`
      import { User } from './models/User';
      import { sql } from '@cossackframework/database';
      class Page {
        render() { return User.name; }
      }
    `, '/src/page.ts');
    expect(safe).not.toContain('@cossackframework/database');

    expect(() => stripClientServerOnlyImports(`
      import { sql } from '@cossackframework/database';
      export const leaked = sql;
    `, '/src/leak.ts')).toThrow(/server-only import/);
  });

  it('ignores type-only imports and type positions when checking server-only references', () => {
    const source = `
      import type { Generated } from '@cossackframework/database';
      import { type Selectable, Model } from '@cossackframework/database';
      import type * as Db from '@cossackframework/database/types';
      class State {}
      export class Page {
        @State() user: Generated<number> | null = null;
        rows: Array<Selectable<Db.Row>> = [];
        cast(value: unknown) { return value as Selectable<{ id: Generated<number> }>; }
        load<T extends Db.Row>(input: T): Generated<T['id']> { return input.id satisfies Db.Id; }
      }
      export type Alias = Selectable<Db.Row>;
      export interface Shape { id: Generated<number> }
    `;
    const result = stripClientServerOnlyImports(source, '/src/pages/users/index.ts');
    expect(result).not.toMatch(/\bModel\b/);
    expect(result).toContain('user: Generated<number> | null');
    // A runtime value referenced next to type-only names still fails.
    expect(() => stripClientServerOnlyImports(`
      import { type Selectable, Model } from '@cossackframework/database';
      export const leaked: Selectable<{}> = Model;
    `, '/src/leak.ts')).toThrow(/server-only import.*\(Model\)/);
    // The full client transform accepts a page using database types in @State.
    const page = `
      import { Cossack, Page, State, Server } from '@cossackframework/core';
      import type { Generated } from '@cossackframework/database';
      import { type Selectable, Model } from '@cossackframework/database';
      @Page()
      export default class UsersPage extends Cossack {
        @State() user: Generated<number> | null = null;
        @State() rows: Selectable<{ id: number }>[] = [];
        @Server() async load() { return Model.all(); }
        render() { return String(this.user); }
      }
    `;
    const transformed = (cossackSecurityPlugin().transform as Function)
      .call({ environment: { name: 'client' } }, page, '/src/pages/users/index.ts');
    expect(transformed.code).not.toMatch(/\bModel\b/);
    // Enums are runtime code.
    expect(() => stripClientServerOnlyImports(`
      import { Model } from '@cossackframework/database';
      export enum Kind { A = Model.kind }
    `, '/src/leak.ts')).toThrow(/server-only import/);
  });

  it('preserves authorization factories used by page decorators while stripping auth operations', () => {
    const source = `
      import { createAuthorizer as authorize, createAuth } from '@cossackframework/auth';
      export const guard = authorize({ hasRole: () => true });
    `;
    const plugin = cossackSecurityPlugin();
    const result = (plugin.transform as Function).call({ environment: { name: 'client' } }, source, '/src/services/rbac.ts');
    expect(result.code).toContain('createAuthorizer as authorize');
    expect(result.code).toContain('guard = authorize(');
    expect(result.code).not.toMatch(/\bcreateAuth\b/);
  });

  it.each([
    `import { createAuthorizer, createAuth } from '@cossackframework/auth'; export const leaked = createAuth;`,
    `import * as auth from '@cossackframework/auth'; export const leaked = auth.createAuth;`,
  ])('still rejects auth operations referenced by client code', (source) => {
    expect(() => stripClientServerOnlyImports(source, '/src/leak.ts')).toThrow(/server-only import/);
  });
});

describe('client-only modules', () => {
  const paths: string[] = [];
  let seq = 0;
  const fixture = (source: string, extension = '.client.ts') => {
    const path = join(tmpdir(), `cossack-client-only-${seq++}${extension}`);
    writeFileSync(path, source, 'utf8');
    paths.push(path);
    return path;
  };

  afterEach(() => {
    for (const path of paths.splice(0)) rmSync(path, { force: true });
  });

  it('matches .client.ts and .client.mts after query/hash suffixes only', () => {
    expect(isClientOnlyModuleId('/src/stores.client.ts?import#x')).toBe(true);
    expect(isClientOnlyModuleId('C:\\src\\browser.client.mts?v=1')).toBe(true);
    expect(isClientOnlyModuleId('/src/client.ts')).toBe(false);
    expect(isClientOnlyModuleId('/src/stores.ts')).toBe(false);
  });

  it('generates named/default stubs and ignores type-only exports', () => {
    const path = fixture(`
      export const value = window.location.href;
      export let count = 0;
      export function run() {}
      export class BrowserThing {}
      export enum Mode { Light, Dark }
      const local = 1;
      export { local as renamed };
      export type Shape = { value: string };
      export interface Contract { run(): void }
      export default document;
    `);
    const stub = generateClientOnlyServerStub(`${path}?import#hash`, 'stores.client');
    for (const name of ['value', 'count', 'run', 'BrowserThing', 'Mode', 'renamed']) {
      expect(stub).toContain(`export const ${name} = __clientOnly`);
    }
    expect(stub).toContain("export default __clientOnly('default')");
    expect(stub).not.toContain('Shape');
    expect(stub).not.toContain('Contract');
    expect(stub).not.toContain('window.location');
  });

  it('supports explicit runtime re-exports and rejects runtime export star', () => {
    const explicit = fixture(`export { value as browserValue, default } from './browser';`);
    const stub = generateClientOnlyServerStub(explicit);
    expect(stub).toContain('export const browserValue');
    expect(stub).toContain('export default');

    const star = fixture(`export * from './browser';`);
    expect(() => generateClientOnlyServerStub(star)).toThrow('runtime "export *"');
    const typeStar = fixture(`export type * from './types';`, '.client.mts');
    expect(() => generateClientOnlyServerStub(typeStar)).not.toThrow();
  });

  it('keeps module evaluation safe but throws on access, call, and construction', async () => {
    const path = fixture(`export const browserApi = window.api;`);
    const stub = generateClientOnlyServerStub(path, 'browser.client');
    const module = await import(`data:text/javascript,${encodeURIComponent(stub)}`);
    expect(module.browserApi).toBeTruthy();
    const message = /Client-only export "browserApi".*onMount\(\).*clientInit\(\).*@Client/;
    expect(() => module.browserApi.value).toThrow(message);
    expect(() => module.browserApi()).toThrow(message);
    expect(() => new module.browserApi()).toThrow(message);
  });

  it('loads original source in the client environment and stubs it during SSR', async () => {
    const path = fixture(`window.__client_only_loaded = true; export const store = document;`);
    const plugin = cossackSecurityPlugin();
    const load = plugin.load as any;
    expect(await load.call({ environment: { name: 'client' } }, `${path}?import`)).toBeUndefined();
    const ssr = await load.call({ environment: { name: 'ssr' } }, `${path}#x`);
    expect(ssr).toContain('export const store');
    expect(ssr).not.toContain('window.__client_only_loaded');
  });
});

describe('server$ compiler macro', () => {
  it('extracts aliased field and inline loaders with stable generated methods', () => {
    const source = `
      import { server$ as resource } from '@cossackframework/core';
      class Users extends Cossack {
        userId = 1;
        users = resource((id) => this.find(id), { deps: () => [this.userId] as const, initial: [] });
        render() { return resource(() => this.title()); }
      }`;
    const result = transformServerResources(source, '/src/pages/users/index.ts');
    expect(result).toContain('get users()');
    expect(result).toContain('static readonly __cossackResourceFields = ["users"]');
    expect(result).toContain('this.__serverResource("users"');
    expect(result).toContain('this.__serverResource("render:0"');
    expect(result).toContain("import { Server as __CossackServerResource } from '@cossackframework/core'");
    expect(result).toContain('@__CossackServerResource({ serverResource: true })');
    expect(result).toContain('return this.find(id)');
    expect(result).toContain('return this.__serverResourceResult("users", await');
  });

  it('requires initial for fields', () => {
    const source = `import { server$ } from '@cossackframework/core'; class A extends Cossack { x = server$(() => 1); }`;
    expect(() => transformServerResources(source, 'a.ts')).toThrow('requires { initial }');
  });

  it('rejects a resource compiler registry collision instead of overwriting application members', () => {
    const source = `import { server$ } from '@cossackframework/core'; class A extends Cossack {
      static __cossackResourceFields = ['other'];
      x = server$(() => 1, { initial: 0 });
    }`;
    expect(() => transformServerResources(source, 'a.ts')).toThrow('__cossackResourceFields is reserved');
  });

  it('rejects generator resource loaders with an authored resource diagnostic', () => {
    const source = `import { server$ } from '@cossackframework/core'; class A extends Cossack {
      items = server$(async function*() { yield 1; }, { initial: [] });
    }`;
    expect(() => transformServerResources(source, 'a.ts')).toThrow('items loader must return data; use @Server for generators');
  });

  it('rejects calls in arbitrary methods and ignores unrelated names', () => {
    const bad = `import { server$ } from '@cossackframework/core'; class A extends Cossack { foo() { return server$(() => 1); } }`;
    expect(() => transformServerResources(bad, 'a.ts')).toThrow('only valid');
    const unrelated = `const server$ = () => 1; class A extends Cossack { render() { return server$(); } }`;
    expect(transformServerResources(unrelated, 'a.ts')).toBe(unrelated);
  });

  it('removes loader-only database imports from the client module', () => {
    const source = `
      import { server$ } from '@cossackframework/core';
      import { sql } from '@cossackframework/database';
      class Users extends Cossack {
        users = server$(() => sql.selectFrom('users').selectAll().execute(), { initial: [] });
        render() { return this.users.length; }
      }`;
    const macro = transformServerResources(source, '/src/pages/users/index.ts');
    const stripped = transformCossackClass(
      macro,
      '/src/pages/users/index.ts',
      isClientSafeMethod,
      new Set(['render']),
      true,
    );
    const result = stripClientServerOnlyImports(stripped, '/src/pages/users/index.ts');
    expect(result).not.toContain("from '@cossackframework/database'");
    expect(result).not.toContain("selectFrom('users')");
  });

  it('fails when a server-only import remains in client-safe code', () => {
    const source = `
      import { sql } from '@cossackframework/database';
      class Users extends Cossack { render() { return sql; } }`;
    expect(() => stripClientServerOnlyImports(source, '/src/pages/users/index.ts'))
      .toThrow('references server-only import "@cossackframework/database" from client-safe code (sql)');
  });
});

describe('vite-security-plugin', () => {
  describe('isClientSafeMethod', () => {


    it('should mark @Client decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@Client()'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark @Optimistic decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@Optimistic(action)'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark @Computed decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@Computed()'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark @Shared decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@Shared()'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark @OnEvent decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@OnEvent("test")'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark @On decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@On("click")'], 'myMethod', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod(["@On('mount')"], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark @OnDocument decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@OnDocument("keydown")'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark @OnWindow decorated methods as client-safe', () => {
      expect(isClientSafeMethod(['@OnWindow("resize")'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should not confuse @On with @OnEvent (word boundary)', () => {
      // The regex must match @On but should also still match @OnEvent via the alternation
      expect(isClientSafeMethod(['@OnEvent("foo")'], 'myMethod', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod(['@On("foo")'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark built-in methods as client-safe', () => {
      expect(isClientSafeMethod([], 'render', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'head', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'onMount', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'onCleanup', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'onNavigateComplete', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'escapeHtml', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'loadingTemplate', BUILTIN_METHODS)).toBe(true);
      for (const name of ['clientInit', 'getError', 'hasError', 'validateProperty', 'validateAll', 'clearErrors', 'startViewTransition']) {
        expect(isClientSafeMethod([], name, BUILTIN_METHODS)).toBe(true);
      }
    });

    it('should mark @Server decorated methods as server-only', () => {
      expect(isClientSafeMethod(['@Server()'], 'myMethod', BUILTIN_METHODS)).toBe(false);
      expect(isClientSafeMethod(['@ServerTask()'], 'myMethod', BUILTIN_METHODS)).toBe(false);
      expect(isClientSafeMethod(['@ClientTask()'], 'myMethod', BUILTIN_METHODS)).toBe(true);
    });

    it('should mark methods without decorators as server-only (secure by default)', () => {
      expect(isClientSafeMethod([], 'myMethod', BUILTIN_METHODS)).toBe(false);
      expect(isClientSafeMethod([], 'init', BUILTIN_METHODS)).toBe(false);
      expect(isClientSafeMethod([], 'get', BUILTIN_METHODS)).toBe(false);
    });
  });

  describe('Transform Methods', () => {


    it('should keep @Client decorated methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    clientMethod() {
      return 'client';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('clientMethod() {');
      expect(result).toContain("return 'client'");
    });

    it('should keep @On decorated methods (regression: previously stripped)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @On('click')
    handleClick() {
      this.count++;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('handleClick() {');
      expect(result).toContain('this.count++');
      expect(result).not.toContain('__cossack_proxies');
    });

    it('should keep @OnDocument decorated methods (regression: previously stripped)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @OnDocument('keydown')
    handleKeydown(event) {
      console.log(event.key);
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('handleKeydown(event) {');
      expect(result).toContain('console.log(event.key)');
    });

    it('should keep @OnWindow decorated methods (regression: previously stripped)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @OnWindow('resize')
    handleResize() {
      this.width = window.innerWidth;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('handleResize() {');
      expect(result).toContain('this.width = window.innerWidth');
    });

    it('should keep onNavigateComplete overrides (regression: previously stripped)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    onNavigateComplete(pathname) {
      console.log('navigated to', pathname);
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('onNavigateComplete(pathname) {');
      expect(result).toContain("console.log('navigated to'");
    });

    it('should keep @Optimistic decorated methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Optimistic('action')
    optimisticHandler() {
      return 'optimistic';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('optimisticHandler() {');
      expect(result).toContain("return 'optimistic'");
    });

    it('should keep @Computed decorated getters', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Computed()
    get computedGetter() {
      return 'computed';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('get computedGetter()');
      expect(result).toContain("return 'computed'");
    });

    it('should keep @Shared decorated methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Shared()
    sharedMethod() {
      return 'shared';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('sharedMethod() {');
      expect(result).toContain("return 'shared'");
    });

    it('should keep built-in lifecycle methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    render() {
      return 'html';
    }
    head() {
      return {};
    }
    onMount() {}
    onCleanup() {}
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('render() {');
      expect(result).toContain("return 'html'");
      expect(result).toContain('head() {');
      expect(result).toContain('onMount() {}');
      expect(result).toContain('onCleanup() {}');
    });

    it('should stub @Server decorated methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    async serverMethod() {
      const apiKey = 'SECRET_KEY';
      return apiKey;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('serverMethod() {');
      expect(result).toContain("__cossack_proxies?.get('serverMethod')");
      expect(result).not.toContain('SECRET_KEY');
    });

    it('should stub methods without decorators', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    async init() {
      const apiKey = 'SECRET_KEY';
      return apiKey;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('init() {');
      expect(result).toContain("__cossack_proxies?.get('init')");
      expect(result).not.toContain('SECRET_KEY');
    });

    it('should keep methods with public access modifier', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    public publicMethod() {
      return 'public';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('publicMethod() {');
      expect(result).toContain("return 'public'");
    });

    it('should stub methods with private access modifier', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    private privateMethod() {
      return 'private';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('privateMethod() {');
      expect(result).toContain("__cossack_proxies?.get('privateMethod')");
      expect(result).not.toContain('return "private"');
    });

    it('should keep async methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    async asyncClientMethod() {
      await Promise.resolve('async');
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('asyncClientMethod() {');
      expect(result).toContain('await Promise.resolve');
    });

    it('should handle methods with return type annotations', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    methodWithType(): string {
      return 'typed';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('methodWithType(): string {');
      expect(result).toContain("return 'typed'");
    });

    it('should keep methods with generic type parameters', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    genericMethod<T>(input: T): T {
      return input;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('genericMethod<T>(input: T): T {');
      expect(result).toContain('return input');
    });

    it('preserves undecorated arrow-function class fields (common event-handler pattern)', () => {
      // Arrow-function class fields are commonly used as event handlers
      // (e.g. @click=${this.handler}) and the transitive-preservation pass
      // can't see bare template references, so undecorated arrow fields are
      // preserved by default to avoid breaking apps. Only @Server arrow
      // fields are stripped (see the member-kind suite below).
      const code = `
@Page()
export class TestPage extends Cossack {
    handler = () => {
      return 'KEPT';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('handler = () =>');
      expect(result).toContain("'KEPT'");
      expect(result).not.toContain('__cossack_proxies');
    });

    it('strips @Server arrow-function class fields (explicit server-only)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    dbQuery = async () => {
      return 'SECRET_SHOULD_BE_STRIPPED';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // @Server arrow field is stubbed with a rest-param signature (class
      // field initializers forbid `arguments`).
      expect(result).toContain('dbQuery = async (...args) =>');
      expect(result).not.toContain('SECRET_SHOULD_BE_STRIPPED');
      expect(result).toContain("__cossack_proxies?.get('dbQuery')");
    });

    it('should NOT stub property getters/setters', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    private _value: string = '';
    get value(): string {
      return this._value;
    }
    set value(v: string) {
      this._value = v;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('get value(): string');
      expect(result).toContain('return this._value');
      expect(result).toContain('set value(v: string)');
    });
  });

  describe('Edge Cases', () => {


    it('should handle deeply nested code blocks correctly', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    outerMethod() {
      if (true) {
        if (true) {
          // This should not be treated as a separate method
          const inner = () => {
            return 'nested';
          };
        }
      }
      return 'outer';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('outerMethod() {');
      expect(result).toContain("return 'outer'");
    });

    it('should handle template literals with braces correctly', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    render() {
      return html\`
        <div>
          \${this.nestedCall()}
          \${{handler: () => 'inline arrow'}}
        </div>
      \`;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('render() {');
      // Should preserve the template literal content
      expect(result).toContain('<div>');
      expect(result).toContain('${this.nestedCall()}');
    });

    it('should handle string literals with braces correctly', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    methodWithString() {
      const str = "String with { braces } inside";
      return str;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('methodWithString() {');
      expect(result).toContain('return str');
    });

    it('should handle comment blocks correctly', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    methodWithComment() {
      // This is a comment with { braces }
      /* Multi-line comment with { braces } */
      return 'value';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('methodWithComment() {');
      expect(result).toContain("return 'value'");
    });

    it('should not stub constructor', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    constructor() {
      super();
      this.value = 'init';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // Constructor should be preserved
      expect(result).toContain('constructor() {');
      expect(result).toMatch(/super\(/);
      expect(result).toContain("this.value = 'init'");
    });

    it('should handle multiple decorators on same method', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    @Shared()
    conflictingMethod() {
      return 'conflict';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // @Shared should take precedence (appears later in decorator order)
      expect(result).toContain('conflictingMethod() {');
      expect(result).toContain("return 'conflict'");
    });

    it('should handle methods with complex signatures', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    complexMethod<T extends Record<string, any>>(obj: T, key: keyof T): any {
      return obj[key];
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('complexMethod<T extends Record<string, any>>(obj: T, key: keyof T)');
      expect(result).toContain("__cossack_proxies?.get('complexMethod')");
    });


    it('should register @Server methods in metadata, but NOT undecorated helpers', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    async loadData() {
      return 'server-only';
    }

    async init() {
      return 'also server-only, but no @Server decorator';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // @Server method should be registered for RPC proxying
      expect(result).toContain('__registerServerOnlyMethods()');
      expect(result).toContain('["loadData"]');
      expect(result).toContain("channel: 'global'");
      // Undecorated init must NOT be registered — its stub should throw, not RPC.
      expect(result).not.toContain('init"');
    });

    it('should NOT inject metadata registration when no @Server methods exist', () => {
      // A class with only undecorated helpers (no @Server) should not get a
      // __registerServerOnlyMethods constructor — those helpers fail loudly.
      const code = `
@Page()
export class TestPage extends Cossack {
    async init() {
      return 'server-only';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('__registerServerOnlyMethods()');
    });

    it('registers undecorated methods exposed as render handlers for automatic RPC', () => {
      const code = `
@Page({ transport: 'http' })
export class CounterPage extends Cossack {
    increment() {
      this.count += 1;
    }

    private unreachableHelper() {
      return 'server-only helper';
    }

    render() {
      return html\`<button @click=\${this.increment}>+</button>\`;
    }
}`;

      const result = transformCossackClass(code, 'counter.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('["increment"]');
      expect(result).toContain("__cossack_proxies?.get('increment')");
      expect(result).not.toContain('["unreachableHelper"]');
    });

    it('registers undecorated methods used as component handler properties', () => {
      const code = `
@Page({ transport: 'http' })
export class CounterPage extends Cossack {
    increment() {
      this.count += 1;
    }

    render() {
      return component(Button, { '@click': this.increment });
    }
}`;

      const result = transformCossackClass(code, 'counter.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('["increment"]');
      expect(result).toContain("__cossack_proxies?.get('increment')");
    });

    it('injects the same automatic RPC allowlist into the server build without stripping bodies', () => {
      const code = `
@Page({ transport: 'http' })
export class CounterPage extends Cossack {
    increment() {
      localStorage.setItem('count', '1');
    }

    private unreachableHelper() {
      return 'not remotely callable';
    }

    render() {
      return html\`<button @click=\${this.increment}>+</button>\`;
    }
}`;

      const result = injectAutomaticServerMethodMetadata(
        code,
        'counter.ts',
        isClientSafeMethod,
        BUILTIN_METHODS,
      );
      expect(result).toContain('["increment"]');
      expect(result).toContain("localStorage.setItem('count', '1')");
      expect(result).toContain("return 'not remotely callable'");
      expect(result).not.toContain('["unreachableHelper"]');
    });

    it('does not authorize unrelated bare method references as RPC endpoints', () => {
      const code = `
@Page({ transport: 'http' })
export class CounterPage extends Cossack {
    sensitiveHelper() {
      return 'server-only';
    }

    render() {
      const reference = this.sensitiveHelper;
      return html\`<p>safe</p>\`;
    }
}`;

      const clientResult = transformCossackClass(
        code,
        'counter.ts',
        isClientSafeMethod,
        BUILTIN_METHODS,
        true,
      );
      const serverResult = injectAutomaticServerMethodMetadata(
        code,
        'counter.ts',
        isClientSafeMethod,
        BUILTIN_METHODS,
      );

      expect(clientResult).not.toContain('["sensitiveHelper"]');
      expect(serverResult).not.toContain('["sensitiveHelper"]');
    });
  });

  describe('Security Tests', () => {


    it('should remove database query strings from client bundle', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    async getUserData() {
      const result = await sql.select().from('users').where('id', '=', userId);
      return result;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('sql.select()');
      expect(result).not.toContain('.from(\'users\')');
    });

    it('should remove API key strings from client bundle', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    async fetchData() {
      const apiKey = process.env.API_KEY;
      return fetch(\`https://api.example.com?key=\${apiKey}\`);
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('process.env.API_KEY');
      expect(result).not.toContain('https://api.example.com?key=');
    });

    it('should remove business logic from client bundle', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Server()
    calculateSecret(input: number) {
      const SECRET_MULTIPLIER = 12345;
      return input * SECRET_MULTIPLIER;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('SECRET_MULTIPLIER');
      expect(result).not.toContain('12345');
    });

    it('should keep pure validation logic in @Shared methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Shared()
    validateEmail(email: string): boolean {
      return /^[^\\s@]+@[\\s@]+\\.[^\\s@]+$/.test(email);
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('validateEmail(email: string): boolean');
      expect(result).toContain('return /^[^\\s@]+@[\\s@]+\\.[^\\s@]+$/.test(email)');
    });
  });

  describe('Real-world Patterns', () => {


    it('should handle the counter-http pattern', () => {
      const code = `
import { Cossack, Page, Server, State } from "@cossackframework/core";
import { html } from "@cossackframework/renderer";

@Page({
    transport: 'http'
})
export class CounterHttp extends Cossack {
    @State()
    count = 0;

    public head() {
        return { title: 'Counter (HTTP)' }
    }

    async init() {
        this.count = 0;
    }

    @Server()
    increment() {
        this.count++;
    }

    @Server()
    decrement() {
        this.count--;
    }

    render() {
        return html\`<p>Count: \${this.count}</p>\`;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);

      // init should be stubbed (no decorator = server-only)
      expect(result).toContain('init() {');
      expect(result).toContain("__cossack_proxies?.get('init')");
      expect(result).not.toContain('this.count = 0');

      // increment and decrement should be stubbed
      expect(result).toContain('increment() {');
      expect(result).toContain("__cossack_proxies?.get('increment')");
      expect(result).not.toContain('this.count++');

      // head and render should be preserved
      expect(result).toContain('head() {');
      expect(result).toContain('return { title:');
      expect(result).toContain('render() {');
      expect(result).toContain('Count:');
    });

    it('stubs get()/init() on a pure API route (no @Server required)', () => {
      // Mirrors src/pages/api/class-based.ts: a class with no render() and an
      // undecorated get(). get() must be stripped (server-only) — but because
      // bootstrap() no longer invokes get()/init() on the client, no RPC proxy
      // is needed and the user does not have to decorate it with @Server().
      const code = `
import { Cossack, Page } from '@cossackframework/core';

@Page({ transport: 'http' })
export class ClassBasedApi extends Cossack {
    async get() {
        return this.c.json({ message: 'Hello from class!' });
    }

    async post() {
        const body = await this.c.req.json();
        return this.c.json({ echo: body }, 201);
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);

      // get()/post() should be stubbed (no client-safe decorator)
      expect(result).toContain('get() {');
      expect(result).toContain("__cossack_proxies?.get('get')");
      expect(result).not.toContain("Hello from class!");

      expect(result).toContain('post() {');
      expect(result).toContain("__cossack_proxies?.get('post')");
      expect(result).not.toContain('this.c.req.json()');
    });

    it('should handle the optimistic-counter pattern', () => {
      const code = `
import { Cossack, Page, Server, State, ClientState, Optimistic, Computed, Client } from '@cossackframework/core';

@Page({
    transport: 'durable-object',
})
export class OptimisticCounter extends Cossack {
    @State()
    private count: number = 0;

    @ClientState()
    private showDetails: boolean = false;

    @ClientState()
    private optimisticCount: number = 0;

    @Computed()
    get displayCount() {
        return (this.loading['increment'] > 0) ? this.optimisticCount : this.count;
    }

    @Server()
    async increment() {
        await new Promise(resolve => setTimeout(resolve, 500));
        this.count++;
    }

    @Optimistic('increment')
    applyOptimisticIncrement() {
        if (!this.loading['increment']) {
            this.optimisticCount = this.count;
        }
        this.optimisticCount++;
    }

    @Client()
    toggleDetails = () => {
        this.showDetails = !this.showDetails;
    }

    render() {
        return html\`<p>Count: \${this.displayCount}</p>\`;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);

      // @Computed getter should be preserved
      expect(result).toContain('get displayCount()');
      expect(result).toContain('return (this.loading[\'increment\'] > 0)');

      // @Optimistic method should be preserved
      expect(result).toContain('applyOptimisticIncrement() {');
      expect(result).toContain('this.optimisticCount++');

      // @Client arrow function property should be preserved
      expect(result).toContain('toggleDetails = () => {');
      expect(result).toContain('this.showDetails = !this.showDetails');

      // @Server method should be stubbed
      expect(result).toContain('increment() {');
      expect(result).toContain("__cossack_proxies?.get('increment')");
      expect(result).not.toContain('await new Promise');
      expect(result).not.toContain('this.count++');
    });

    it('should handle the lifecycle demo pattern (transitive preservation)', () => {
      const code = `
import { Client, Cossack, Page, State, html } from '@cossackframework/core';

@Page()
export default class LifecycleDemo extends Cossack {
    @State()
    data: string[] = [];

    async init() {
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    @Client()
    async reload() {
        await this.init();
        this.data = ['Cossack', 'Hono', 'Cloudflare', 'Durable Objects'];
    }

    render() {
        return html\`<h1>Data Loaded!</h1>\`;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);

      // init is called from @Client reload(), so it is transitively preserved
      // (full body kept) — not stubbed.
      expect(result).toContain('init() {');
      expect(result).toContain('setTimeout');
      expect(result).not.toContain("__cossack_proxies?.get('init')");

      // reload should be preserved
      expect(result).toContain('reload() {');
      expect(result).toContain('await this.init()');

      // render should be preserved
      expect(result).toContain('render() {');
      expect(result).toContain('html`');
    });
  });

  describe('transitive preservation / loud failure', () => {


    it('preserves a helper called from onMount (transitive, depth 1)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    onMount() {
        this.setupReveal();
    }

    private setupReveal() {
        const observer = new IntersectionObserver(() => {});
        return observer;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // setupReveal body must be preserved (no stub, no proxy lookup)
      expect(result).toContain('setupReveal() {');
      expect(result).toContain('new IntersectionObserver');
      expect(result).not.toContain("__cossack_proxies?.get('setupReveal')");
    });

    it('preserves helpers called transitively to depth 3 (A -> B -> C, from onMount)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    onMount() {
        this.a();
    }

    private a() {
        this.b();
    }
    private b() {
        this.c();
    }
    private c() {
        return 'deep';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain("return 'deep'");
      expect(result).not.toContain("__cossack_proxies?.get('a')");
      expect(result).not.toContain("__cossack_proxies?.get('b')");
      expect(result).not.toContain("__cossack_proxies?.get('c')");
    });

    it('still stubs genuine @Server methods even when other helpers are preserved', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    onMount() {
        this.helper();
    }

    private helper() {
        return 'kept';
    }

    @Server()
    fetchData() {
        const apiKey = 'SECRET';
        return apiKey;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // helper is preserved
      expect(result).toContain("return 'kept'");
      // @Server method is stubbed and secret is stripped
      expect(result).toContain("__cossack_proxies?.get('fetchData')");
      expect(result).not.toContain('SECRET');
    });

    it('does NOT register a stripped undecorated helper in cossack:server-methods metadata', () => {
      // An undecorated, unreachable helper is stubbed, but it must not be
      // registered as an RPC method — so its stub throws loudly.
      const code = `
@Page()
export class TestPage extends Cossack {
    render() {
        return null;
    }

    private unreachableHelper() {
        return 'never called from client-safe code';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // No metadata injection at all (no @Server methods).
      expect(result).not.toContain('__registerServerOnlyMethods');
      // The helper is stubbed.
      expect(result).toContain("__cossack_proxies?.get('unreachableHelper')");
    });

    it('preserves a @Client-decorated method used as an escape hatch (body kept, no stub)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    @Client()
    private draw() {
        return 'client plumbing';
    }

    render() {
        return null;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('draw() {');
      expect(result).toContain("return 'client plumbing'");
      expect(result).not.toContain("__cossack_proxies?.get('draw')");
    });

    it('a stripped, unreachable helper throws (stub contains throw, not just proxy.apply)', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    render() {
        return null;
    }

    private unreachableHelper() {
        return 'stripped';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // The dev stub must contain a throw with guidance text.
      expect(result).toContain('throw new Error');
      expect(result).toContain('stripped from the client bundle');
    });
  });
});

describe('SSG generateStaticParams stripping', () => {
  it('strips a block-body arrow function', () => {
    const code = `@Page({
  ssg: {
    generateStaticParams: async () => {
      const apiKey = 'SECRET_KEY';
      const rows = await sql.select().from('users');
      return rows;
    }
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('SECRET_KEY');
    expect(result).not.toContain('sql.select');
    expect(result).not.toContain("from('users')");
  });

  it('strips a concise-body arrow function', () => {
    const code = `@Page({
  ssg: {
    generateStaticParams: async () => [{ id: '1' }, { id: '2' }]
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain("{ id: '1' }");
  });

  it('strips an identifier reference', () => {
    const code = `@Page({
  ssg: {
    generateStaticParams: myDbHelper
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('myDbHelper');
  });

  it('preserves the `enabled` flag alongside generateStaticParams', () => {
    const code = `@Page({
  ssg: {
    enabled: true,
    generateStaticParams: async () => {
      return sql.query('SELECT ...');
    }
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('enabled: true');
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('sql.query');
  });

  it('preserves other @Page options', () => {
    const code = `@Page({
  transport: 'http',
  ssg: {
    generateStaticParams: async () => {
      return fetch('/secret');
    }
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain("transport: 'http'");
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('fetch(');
  });

  it('boolean `ssg: true` is a no-op', () => {
    const code = `@Page({ ssg: true })
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toBe(code);
  });

  it('`ssg: { enabled: true }` with no generateStaticParams is a no-op', () => {
    const code = `@Page({ ssg: { enabled: true } })
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toBe(code);
  });

  it('`@Page()` with no ssg at all is a no-op', () => {
    const code = `@Page()
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toBe(code);
  });

  it('strips @Component just like @Page (alias coverage)', () => {
    const code = `@Component({
  ssg: {
    generateStaticParams: async () => {
      return sql.list();
    }
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('sql.list');
  });

  it('does not touch string/template-literal occurrences of generateStaticParams', () => {
    const code = `@Page({
  ssg: {
    generateStaticParams: async () => []
  }
})
export class P extends Cossack {
  render() {
    return html\`<pre>generateStaticParams: async () => { return SECRET; }</pre>\`;
  }
}`;

    const result = stripSsgGenerateStaticParams(code);
    // Decorator value was stripped...
    expect(result).toContain('generateStaticParams: async () => []');
    // ...but the template-literal copy is preserved verbatim.
    expect(result).toContain('generateStaticParams: async () => { return SECRET; }');
  });

  it('processes multiple @Page decorators in the same file independently', () => {
    const code = `@Page({
  ssg: { generateStaticParams: async () => sql.a() }
})
export class A extends Cossack {}

@Page({
  ssg: { generateStaticParams: async () => sql.b() }
})
export class B extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).not.toContain('sql.a');
    expect(result).not.toContain('sql.b');
    expect((result.match(/generateStaticParams: async \(\) => \[\]/g) || []).length).toBe(2);
  });

  it('integration: real ssg-demo/users/[username] shape — class methods stripped AND generateStaticParams stripped', () => {

    const code = `
import { Cossack, Page, State } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';

@Page({
  ssg: {
    enabled: true,
    generateStaticParams: async () => {
      const apiKey = process.env.SECRET_DB_KEY;
      const users = await sql.select().from('users');
      return users.map(u => ({ username: u.name }));
    }
  },
  transport: 'http'
})
export class UserProfile extends Cossack {
  @State() username: string = '';

  head() {
    return { title: 'User Profile' };
  }

  async init() {
    const secret = 'SHOULD_BE_STRIPPED';
    this.username = 'default';
  }

  render() {
    return html\`<h1>User Profile</h1>\`;
  }
}`;

    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);

    // generateStaticParams body stripped
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('SECRET_DB_KEY');
    expect(result).not.toContain('sql.select');
    // Other decorator options preserved
    expect(result).toContain('enabled: true');
    expect(result).toContain("transport: 'http'");
    // Class-body stripping still works (init stubbed)
    expect(result).toContain("__cossack_proxies?.get('init')");
    expect(result).not.toContain('SHOULD_BE_STRIPPED');
    // render preserved
    expect(result).toContain('render() {');
    expect(result).toContain('User Profile');
  });

  describe('constructor metadata injection (no duplicate constructor)', () => {

    /**
     * Count top-level `constructor(` occurrences in the transformed class body.
     * A class with a duplicate constructor is a syntax error, so this must
     * always be exactly 1 (or 0) when @Server methods are present.
     */
    function countTopLevelConstructors(result: string): number {
      const classBodyStart = result.indexOf('{', result.indexOf('class'));
      // Match `constructor` at brace depth 0 of the class body, followed by (.
      let depth = 0;
      let count = 0;
      for (let i = classBodyStart; i < result.length; i++) {
        const c = result[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
        else if (depth === 1 && c === 'c' && result.slice(i, i + 11) === 'constructor') {
          const after = result[i + 11];
          if (after === undefined || /[\s(]/.test(after)) count++;
        }
      }
      return count;
    }

    it('does not produce a duplicate constructor when the class declares one AND has @Server methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  constructor() {
    super();
    console.log('custom ctor');
  }

  @Server()
  async save() {
    await sql.insert();
  }

  render() { return html\`<p>hi</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      const count = countTopLevelConstructors(result);
      expect(count).toBe(1);
      // The existing constructor body must be preserved.
      expect(result).toContain("console.log('custom ctor')");
      // The registration call must be injected (once).
      const regCount = (result.match(/new\.target as any\)\.__registerServerOnlyMethods\?\.\(\)/g) || []).length;
      expect(regCount).toBe(1);
    });

    it('injects a new constructor when the class has @Server methods but no constructor', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  @Server()
  async save() {
    await sql.insert();
  }

  render() { return html\`<p>hi</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // Exactly one constructor injected.
      expect(countTopLevelConstructors(result)).toBe(1);
      expect(result).toMatch(/super\(/);
      expect(result).toContain('__registerServerOnlyMethods');
    });

    it('injects a constructor WITHOUT super() for @Service classes that do not extend', () => {
      const code = `
@Service()
export class CounterService {
  @Server()
  increment() {
    this.count++;
  }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(countTopLevelConstructors(result)).toBe(1);
      // No super() since the class does not extend anything.
      expect(result).not.toMatch(/super\s*\(/);
    });

    it('still registers server-only methods when splicing into an existing constructor', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  private x = 1;
  constructor(public foo: string) {
    super();
  }

  @Server()
  doThing() { this.x = 2; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(countTopLevelConstructors(result)).toBe(1);
      // The __registerServerOnlyMethods call must run inside the constructor.
      expect(result).toContain('doThing'); // method name listed in registration
      const regCount = (result.match(/new\.target as any\)\.__registerServerOnlyMethods\?\.\(\)/g) || []).length;
      expect(regCount).toBe(1);
      // Constructor params preserved.
      expect(result).toContain('public foo: string');
    });

    it('produces no constructor when there are no @Server methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  @Client()
  click() { this.x++; }

  render() { return html\`<p>hi</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('__registerServerOnlyMethods');
      expect(result).not.toMatch(/constructor\s*\(/);
    });
  });

  describe('regex literals in method bodies (no brace corruption)', () => {

    it('strips a server method whose body contains a regex with a closing brace', () => {
      // The `}` inside /}/ previously decremented the method's brace depth,
      // truncating the body and leaking the rest (incl. the secret + a later method).
      const code = `
@Page()
export class TestPage extends Cossack {
  validate(x) {
    const closingBrace = /}/;
    const secret = 'LEAK_ME';
    return closingBrace.test(x);
  }

  render() { return html\`<p>hi</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // The secret in the server-only (undecorated) method must be stripped.
      expect(result).not.toContain('LEAK_ME');
      // The render() method (after the regex-containing method) must still be intact.
      expect(result).toContain('render() {');
      expect(result).toContain('<p>hi</p>');
      // And validate must have been stubbed (proxied).
      expect(result).toContain("__cossack_proxies?.get('validate')");
    });

    it('strips a server method with a quantified regex like /^\\d{3}-\\d{4}$/', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  phone(input) {
    const re = /^\\d{3}-\\d{4}$/;
    const apiKey = 'SHOULD_NOT_LEAK';
    return re.test(input);
  }

  @Client()
  handle() { this.x++; }

  render() { return html\`<p>phone</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('SHOULD_NOT_LEAK');
      // The @Client method after must be preserved (proves the boundary wasn't corrupted).
      expect(result).toContain('handle() {');
      expect(result).toContain('this.x++');
      expect(result).toContain('render() {');
    });

    it('does not treat a division operator as a regex (preserves client methods)', () => {
      // Ensure the regex/division heuristic doesn\'t misfire on plain division
      // inside a preserved (@Client) method.
      const code = `
@Page()
export class TestPage extends Cossack {
  @Client()
  compute() {
    const half = this.total / 2;
    return half;
  }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('this.total / 2');
      expect(result).toContain('return half');
    });

    it('handles a character class containing a brace in a regex', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  lint(src) {
    const braceClass = /[}{]/g;
    const secret = 'SENSITIVE';
    return braceClass.test(src);
  }
  render() { return html\`<p>lint</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('SENSITIVE');
      expect(result).toContain('render() {');
      expect(result).toContain("<p>lint</p>");
    });
  });

  describe('member-kind stripping (generators, fields, computed names)', () => {

    it('strips generator methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  *streamSecrets() {
    const apiKey = 'GEN_SECRET';
    yield 1;
  }
  render() { return html\`<p>g</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('GEN_SECRET');
      expect(result).toContain('render() {');
      expect(result).toContain('__cossack_proxies?.get(\'streamSecrets\')');
    });

    it('strips async generator methods', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  async *streamAsync() {
    const secret = 'AGEN_SECRET';
    yield 1;
  }
  render() { return html\`<p>a</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('AGEN_SECRET');
      expect(result).toContain('render() {');
    });

    it('strips a @Server arrow-function class field holding server secrets', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  @Server()
  dbQuery = async () => {
    const apiKey = process.env.DB_KEY;
    return await sql.query(apiKey);
  };
  render() { return html\`<p>q</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('DB_KEY');
      expect(result).not.toContain('sql.query');
      // Async arrow stub uses rest params (class fields forbid `arguments`).
      expect(result).toContain('dbQuery = async (...args) =>');
      expect(result).toContain("__cossack_proxies?.get('dbQuery')");
      expect(result).toContain('proxy.apply(this, args)');
      // Following render() intact (boundary not corrupted).
      expect(result).toContain('render() {');
    });

    it('preserves a @Client arrow-function class field', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  @Client()
  handler = () => {
    this.x++;
  };
  render() { return html\`<p>c</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('handler = () =>');
      expect(result).toContain('this.x++');
      expect(result).not.toContain('__cossack_proxies');
    });

    it('leaves non-function data fields untouched', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  count = 0;
  label = 'hello';
  render() { return html\`<p>d</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('count = 0');
      expect(result).toContain("label = 'hello'");
    });

    it('does not corrupt parsing for a computed-name method', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  ['computed']() {
    const secret = 'COMP_SECRET';
    return secret;
  }
  render() { return html\`<p>cmp</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // render() after the computed-name method must remain intact (no corruption).
      expect(result).toContain('render() {');
      expect(result).toContain('<p>cmp</p>');
    });

    it('strips a @Server function-expression class field', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
  @Server()
  helper = function (x) {
    const secret = 'FN_SECRET';
    return x + secret;
  };
  render() { return html\`<p>f</p>\`; }
}`;
      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('FN_SECRET');
      expect(result).toContain('render() {');
    });
  });
});

// Cases that the previous regex/brace scanner mishandled; the AST-driven
// rewrite fixes them. These guard against regressions if the discovery logic
// ever moves back to text scanning.
describe('vite-security-plugin — AST-driven bug fixes', () => {


  it('stubs a single-statement @Server method body', () => {
    // Previously: a one-line body like `{ this.count++; }` was not detected
    // by the brace scanner, so `increment` was neither stubbed nor registered.
    const code = `
@Page()
export class Counter extends Cossack {
  @Server() increment() { this.count++; }
  render() { return html\`<p>x</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    expect(result).toContain("__cossack_proxies?.get('increment')");
    expect(result).not.toContain('this.count++');
  });

  it('stubs a @Server method declared after a @State field', () => {
    // Previously: a `@State() field = value;` before a `@Server` method broke
    // the brace scanner, so the method was not stubbed. The AST is immune to
    // field/method ordering.
    const code = `
@Page()
export class Counter extends Cossack {
  @State() count = 0;
  @Server()
  async increment() { this.count++; }
  render() { return html\`<p>\${this.count}</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    expect(result).toContain("__cossack_proxies?.get('increment')");
    expect(result).not.toContain('this.count++');
  });

  it('preserves deep client chains and cycles without traversing server boundaries', () => {
    const code = `
@Page()
export class Page extends Cossack {
  onMount() { this.first(); }
  first() { this.second(); }
  second() { this.third(); }
  third() { this.fourth(); }
  fourth() { this.fifth(); }
  fifth() { this.second(); this.save(); return 'DEEP_CLIENT_BODY'; }
  @Server() save() { return this.secretHelper(); }
  secretHelper() { return 'SERVER_ONLY_BODY'; }
  render() { return html\`<p>x</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    expect(result).toContain('DEEP_CLIENT_BODY');
    for (const name of ['first', 'second', 'third', 'fourth', 'fifth']) {
      expect(result).not.toContain(`__cossack_proxies?.get('${name}')`);
    }
    expect(result).toContain("__cossack_proxies?.get('save')");
    expect(result).not.toContain('return this.secretHelper()');
    expect(result).not.toContain('SERVER_ONLY_BODY');
  });

  it('handles @Server with options object', () => {
    const code = `
@Page()
export class Page extends Cossack {
  @Server({ channel: 'admin', provider: 'session' })
  doAdmin() { const key = 'ADMIN_KEY'; return key; }
  render() { return html\`<p>x</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    expect(result).toContain("__cossack_proxies?.get('doAdmin')");
    expect(result).not.toContain('ADMIN_KEY');
  });

  it('does not treat a server-call comment as a real call edge', () => {
    // A `// this.serverOnly()` comment must NOT pull serverOnly into the
    // preserved set. The AST ignores comment text entirely.
    const code = `
@Page()
export class Page extends Cossack {
  onMount() {
    // this.serverOnly();
    this.realHelper();
  }
  realHelper() { return 'kept'; }
  serverOnly() { const secret = 'COMMENT_SECRET'; return secret; }
  render() { return html\`<p>x</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    // serverOnly was not preserved (the comment is not a call), so it's stubbed
    // and its secret does not leak.
    expect(result).not.toContain('COMMENT_SECRET');
    expect(result).toContain("__cossack_proxies?.get('serverOnly')");
    expect(result).toContain("'kept'");
  });

  it('registers @Server methods for RPC even when the class declares a constructor', () => {
    // Regression: the metadata-injection pass must append BOTH the registration
    // CALL into the existing constructor AND the static
    // __registerServerOnlyMethods() definition. Previously the static method was
    // skipped when a constructor existed, so @Server methods were never
    // registered for RPC proxying and the client stub 403'd.
    const code = `
@Page()
export class Page extends Cossack {
  constructor() { super(); }
  @Server()
  async save() { const key = 'SAVE_KEY'; return key; }
  render() { return html\`<p>x</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    // The registration CALL is in the constructor...
    expect(result).toMatch(/__registerServerOnlyMethods\?\.\(\)/);
    // ...AND the static method definition is present (this is the regression).
    expect(result).toMatch(/static\s+__registerServerOnlyMethods\(\)/);
    // Exactly one constructor (no duplicate).
    expect((result.match(/constructor\s*\(/g) || []).length).toBe(1);
    expect(result).not.toContain('SAVE_KEY');
  });

  it('walks function-valued class fields when computing transitive preservation', () => {
    // Regression: a preserved function field (e.g. a @Client handler) that
    // calls a helper must pull that helper into the preserved set. Previously
    // only MethodDefinition bodies were walked, so the helper was stubbed and
    // its secret leaked.
    const code = `
@Page()
export class Page extends Cossack {
  @Client()
  handler = () => { this.helper(); };
  helper() { const secret = 'FIELD_HELPER_SECRET'; return secret; }
  render() { return html\`<p>x</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    // helper() was reached from the preserved field, so it survives.
    expect(result).toContain('FIELD_HELPER_SECRET');
    expect(result).not.toContain("__cossack_proxies?.get('helper')");
  });

  it('does not preserve an explicit @Server method called by a @Client method', () => {
    const code = `
@Page()
export class Page extends Cossack {
  @Client()
  openMenu(event) {
    event.preventDefault();
    this.showNativeMenu(event.clientX, event.clientY);
  }

  @Server()
  async showNativeMenu(x, y) {
    const { Menu } = await import('@cossackframework/desktop');
    Menu.buildFromTemplate([]).popup({ window: this.env.COSSACK_DESKTOP.window, x, y });
  }

  render() { return html\`<main @contextmenu=\"\${this.openMenu}\"></main>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);

    expect(result).toContain("__cossack_proxies?.get('showNativeMenu')");
    expect(result).not.toContain('@cossackframework/desktop');
    expect(result).not.toContain('Menu.buildFromTemplate');
  });

  it.each([
    `class SecretPage extends Cossack { @Server() get secret() { return 'private'; } }`,
    `class SecretPage extends Cossack { @Server() [Symbol.for('secret')]() { return 'private'; } }`,
  ])('rejects unsupported server members instead of leaking them: %s', (code) => {
    expect(() => transformCossackClass(code, 'secret.ts', isClientSafeMethod, BUILTIN_METHODS, true))
      .toThrow('@Server requires');
  });

  it('fails the client build when source cannot be parsed', () => {
    const code = `export class extends Cossack { @Server() x(`;
    expect(() => transformCossackClass(code, 'broken.ts', isClientSafeMethod, BUILTIN_METHODS, true))
      .toThrow(/Could not parse broken.ts.*refusing/);
  });

  it.each([
    `import { Cossack, Server as Remote } from '@cossackframework/core'; export class SecretPage extends Cossack { @Remote() secret = () => 'DO_NOT_SHIP'; }`,
    `export class SecretPage extends ImportedBase { @Server() secret() { return 'DO_NOT_SHIP'; } }`,
    `import { Cossack as Base } from '@cossackframework/core'; export class SecretPage extends Base { @Server() secret() { return 'DO_NOT_SHIP'; } }`,
    `import * as Core from '@cossackframework/core'; export class SecretPage extends Core.Cossack { @Server() secret() { return 'DO_NOT_SHIP'; } }`,
    `@Page() export class SecretPage extends ImportedBase { @Server() secret() { return 'DO_NOT_SHIP'; } }`,
    `class Base extends Cossack {} export class SecretPage extends Base { @Server() secret() { return 'DO_NOT_SHIP'; } }`,
    `export class SecretPage extends\n Cossack { @Server() secret() { return 'DO_NOT_SHIP'; } }`,
  ])('strips secrets regardless of aliases and formatting: %s', (code) => {
    const plugin = cossackSecurityPlugin();
    const result = (plugin.transform as Function).call({ environment: { name: 'client' } }, code, '/src/page.ts?import');
    expect(result.code).not.toContain('DO_NOT_SHIP');
    expect(result.code).toContain('secret');
  });

});

// ---------------------------------------------------------------------------
// Server-only module detection & stubbing
// ---------------------------------------------------------------------------
// Regression for the `node:async_hooks` leak: a user service module that does
// `import { sql } from '@cossackframework/database'` pulls ALS into the client
// bundle. The security plugin must auto-detect such modules and stub their
// named exports on the client (same pattern as src/auth.ts).
describe('server-only module detection', () => {
  // Unique counter so every temp file path is distinct across tests (avoids any
  // cross-test contamination from same-named files).
  let seq = 0;
  /** Write a temp .ts file and return its path. Cleaned up via afterEach. */
  function tempFile(name: string, contents: string): string {
    const path = join(tmpdir(), `cossack-sec-${seq++}-${name}`);
    writeFileSync(path, contents, 'utf-8');
    return path;
  }

  const createdPaths: string[] = [];
  const track = (p: string) => {
    createdPaths.push(p);
    return p;
  };

  // Best-effort cleanup of temp files created across tests.
  afterEach(() => {
    for (const p of createdPaths.splice(0)) {
      try { rmSync(p, { force: true }); } catch { /* ignore */ }
    }
  });

  describe('readImportSources()', () => {
    it('collects static import sources', () => {
      const p = track(tempFile('static.ts', `import { sql } from '@cossackframework/database';\nimport { x } from './local';\n`));
      expect(readImportSources(p).sort()).toEqual(['./local', '@cossackframework/database']);
    });

    it('collects re-export sources', () => {
      const p = track(tempFile('reexport.ts', `export { sql } from '@cossackframework/database';\nexport * from './other';\n`));
      expect(readImportSources(p).sort()).toEqual(['./other', '@cossackframework/database']);
    });

    it('returns an empty array when the file cannot be read', () => {
      expect(readImportSources('/does/not/exist.ts')).toEqual([]);
    });
  });

  describe('isServerOnlyModule()', () => {
    it('flags a module importing from @cossackframework/database', () => {
      const p = track(tempFile('svc.ts', `import { sql } from '@cossackframework/database';\nexport const listUsers = () => sql.selectFrom('users');\n`));
      expect(isServerOnlyModule(p)).toBe(true);
    });

    it('does NOT flag a module importing only from @cossackframework/auth (guard must run on client)', () => {
      // The auth package is pure TypeScript (hono type imports only, no Node
      // built-ins). createAuthorizer / `guard` must run on the client so
      // `@Page({ middlewares: [guard.requireRole('admin')] })` can evaluate at
      // module load. (A file that uses the server-only createAuth + sql is caught
      // by the @cossackframework/database rule or the src/auth.ts special-case.)
      const p = track(tempFile('rbac.ts', `import { createAuthorizer } from '@cossackframework/auth';\nexport const guard = createAuthorizer({ hasRole: () => true });\n`));
      expect(isServerOnlyModule(p)).toBe(false);
    });

    it('flags a module importing a node: builtin', () => {
      const p = track(tempFile('fs.ts', `import { readFileSync } from 'node:fs';\n`));
      expect(isServerOnlyModule(p)).toBe(true);
    });

    it('does NOT flag a type-only import from @cossackframework/database', () => {
      // `import type` erases at compile time and never pulls runtime code.
      const p = track(tempFile('model.ts', `import type { BaseEntity } from '@cossackframework/database';\nexport interface User { id: BaseEntity<string>; }\n`));
      expect(isServerOnlyModule(p)).toBe(false);
    });

    it('does NOT flag a plain module with no server-only imports', () => {
      const p = track(tempFile('util.ts', `import { html } from '@cossackframework/renderer';\nexport const greet = () => 'hi';\n`));
      expect(isServerOnlyModule(p)).toBe(false);
    });
  });

  describe('generateServerOnlyStub()', () => {
    it('stubs each named export as a throwing function', () => {
      const p = track(tempFile('users.ts', `import { sql } from '@cossackframework/database';\nexport const listUsers = () => [];\nexport async function deleteUser(id: string) {}\n`));
      const stub = generateServerOnlyStub(p, 'services/users');
      expect(stub).toContain('// [cossack-security] services/users is server-only');
      expect(stub).toContain("export const listUsers = stub('listUsers');");
      expect(stub).toContain("export const deleteUser = stub('deleteUser');");
      // The throwing error references the module label.
      expect(stub).toContain("'services/users.' + name + ' is server-only");
    });

    it('skips type-only exports (no runtime binding)', () => {
      const p = track(tempFile('types.ts', `import { sql } from '@cossackframework/database';\nexport const listUsers = () => [];\nexport type User = { id: string };\n`));
      const stub = generateServerOnlyStub(p, 'svc');
      expect(stub).toContain("export const listUsers = stub('listUsers');");
      // `export type User` must NOT produce a runtime stub binding.
      expect(stub).not.toContain("export const User");
    });

    it('falls back to a throwing Proxy when exports cannot be parsed', () => {
      const stub = generateServerOnlyStub('/does/not/exist.ts', 'svc');
      expect(stub).toContain('Proxy');
      expect(stub).toContain('throw');
    });
  });

  describe('moduleLabelFromId()', () => {
    it('derives the tail after /src/', () => {
      expect(moduleLabelFromId('/home/me/app/src/services/users.ts')).toBe('services/users');
    });

    it('strips a vite query suffix before deriving', () => {
      expect(moduleLabelFromId('/app/src/sql/config.ts?v=abc')).toBe('sql/config');
    });

    it('handles backslash paths', () => {
      expect(moduleLabelFromId('C:\\app\\src\\services\\users.ts')).toBe('services/users');
    });
  });
});

describe('client result typing (RT-01)', () => {
  const transform = (code: string) => transformCossackClass(code, 'page.ts', isClientSafeMethod, BUILTIN_METHODS, false);
  const callType = (type: string, name = 'RpcCall') => `${name}<import('@cossackframework/core').RpcResult<${type}>, import('@cossackframework/core').RpcYield<${type}>>`;

  it('parses nested generic arguments and removes async generator modifiers', () => {
    const result = transform(`import { Cossack, Server } from '@cossackframework/core';
      class Sample extends Cossack {
        @Server() /* async * annotation comment */ async *stream(): AsyncGenerator<Record<string, number>, { ok: boolean }, void> { yield {}; return { ok: true }; }
      }`);
    expect(result).toContain('stream(): ' + callType('AsyncGenerator<Record<string, number>, { ok: boolean }, void>'));
    expect(result).not.toContain('async *stream');
    expect(result).toContain('/* async * annotation comment */');
  });

  it('reuses an aliased RpcCall import and leaves function fields syntactically intact', () => {
    const result = transform(`import { Cossack, Server, type RpcCall as Call } from '@cossackframework/core';
      class Sample extends Cossack {
        @Server() async value(): Promise<number> { return 1; }
        @Server() load = async (): Promise<number> => 1;
      }`);
    expect(result).toContain('value(): ' + callType('Promise<number>', 'Call'));
    expect(result).not.toContain('import type { RpcCall }');
    expect(result).toContain('load = async (...args) =>');
    expect(result).not.toContain('=> 1');
  });

  it('removes server-only validation closures from client decorators', () => {
    const result = transform(`import { Cossack, Server as Action } from '@cossackframework/core';
      class Sample extends Cossack {
        @Action({ timeout: 30, input: { title: { validate: () => "SECRET_VALIDATOR" } } })
        async value(): Promise<number> { return 1; }
      }`);
    expect(result).not.toContain('SECRET_VALIDATOR');
    expect(result).toContain('timeout: 30');
    expect(result).toContain('input: undefined');
  });

  it('rewrites generator signatures to RpcCall<Return, Yield>', () => {
    const result = transform(`
      import { Cossack, Server } from '@cossackframework/core';
      export class Page extends Cossack {
        @Server()
        async *stream(): AsyncGenerator<string, number> { yield 'a'; return 1; }
      }
    `);
    expect(result).toContain('stream(): ' + callType('AsyncGenerator<string, number>'));
    expect(result).toContain("import type { RpcCall } from '@cossackframework/core'");
    expect(result).not.toContain('async *stream');
  });

  it('maps one-argument generators, async iterables, and promises', () => {
    const result = transform(`
      import { Cossack, Server } from '@cossackframework/core';
      export class Page extends Cossack {
        @Server() async *one(): AsyncGenerator<string> { yield 'a'; }
        @Server() async *iter(): AsyncIterableIterator<string> { yield 'a'; }
        @Server() async plain(): Promise<boolean> { return true; }
      }
    `);
    expect(result).toContain('one(): ' + callType('AsyncGenerator<string>'));
    expect(result).toContain('iter(): ' + callType('AsyncIterableIterator<string>'));
    expect(result).toContain('plain(): ' + callType('Promise<boolean>'));
  });

  it('leaves unrecognized or missing annotations untouched', () => {
    const result = transform(`
      import { Cossack, Server } from '@cossackframework/core';
      export class Page extends Cossack {
        @Server() async custom(): CustomResult { return result(); }
        @Server() async untyped() { return 1; }
      }
    `);
    expect(result).toContain('custom(): CustomResult');
    expect(result).toContain('untyped()');
    expect(result).not.toContain('RpcCall<any');
  });
});


describe('compiler inspection facts', () => {
  it.each([['server', 'implicit'], ['server', 'explicit'], ['client', 'implicit'], ['client', 'explicit']])('executes %s inherited automatic RPC registration with %s constructors', async (target, mode) => {
    const code = `
      class Parent extends Cossack {
        parentAction() { return 1; }
        render() { return html\`<button @click=\"\${this.parentAction}\"></button>\`; }
      }
      class Child extends Parent {
        ${mode === 'explicit' ? 'constructor(value) { super(value); }' : ''}
        childAction() { return 2; }
        render() { return html\`<button @click=\"\${this.childAction}\"></button>\`; }
      }
    `;
    const transformed = target === 'server'
      ? injectAutomaticServerMethodMetadata(code, 'inheritance.ts', isClientSafeMethod, new Set(['render']))
      : transformCossackClass(code, 'inheritance.ts', isClientSafeMethod, new Set(['render']), false);
    const js = await transformWithOxc(transformed, 'inheritance.ts');
    class Root {
      args: unknown[];
      metadata: Record<string, unknown>;
      constructor(...args: unknown[]) {
        this.args = args;
        this.metadata = Reflect.getMetadata('cossack:server-methods', this.constructor) ?? {};
      }
    }
    const classes = new Function('Cossack', `${js.code}; return { Parent, Child };`)(Root);
    Reflect.defineMetadata('cossack:server-methods', { parentAction: { timeout: 42, channel: 'private', provider: 'page' } }, classes.Parent);
    const child = new classes.Child('dependency');
    expect(child.args).toEqual(['dependency']);
    expect(Object.keys(child.metadata).sort()).toEqual(['childAction', 'parentAction']);
    expect(child.metadata.parentAction).toMatchObject({ timeout: 42, channel: 'private' });
    if (target === 'client') child.__cossack_proxies = new Map([['parentAction', () => 10], ['childAction', () => 20]]);
    expect(child.parentAction()).toBe(target === 'client' ? 10 : 1);
    expect(child.childAction()).toBe(target === 'client' ? 20 : 2);
    const parent = new classes.Parent('parent dependency');
    expect(parent.args).toEqual(['parent dependency']);
    expect(Object.keys(parent.metadata)).toEqual(['parentAction']);
  });

  it('excludes erased declare fields and marks constructor parameter properties incomplete', () => {
    const result = inspectCompilerMethods('@Page() class Demo { declare value: string; constructor(public value2: string) {} }', 'members.ts');
    expect(result.classes[0].members).toEqual([]);
    expect(result.classes[0].membersComplete).toBe(false);
  });

  it('records fields, accessors, static and private members needed for dispatch resolution', () => {
    const result = inspectCompilerMethods(`@Page() class Demo {
      value = 1;
      handler = () => 2;
      get display() { return this.value; }
      set display(value) { this.value = value; }
      static factory() { return 3; }
      #hidden() { return 4; }
      [dynamic]() { return 5; }
    }`, 'members.ts');
    expect(result.diagnostics).toEqual([]);
    expect(result.classes[0].members).toEqual([
      { name: 'value', kind: 'field', static: false, private: false },
      { name: 'handler', kind: 'field', static: false, private: false },
      { name: 'display', kind: 'get', static: false, private: false },
      { name: 'display', kind: 'set', static: false, private: false },
      { name: 'factory', kind: 'method', static: true, private: false },
      { name: 'hidden', kind: 'method', static: false, private: true },
      { name: null, kind: 'method', static: false, private: false },
    ]);
  });

  it('reports local inheritance declarations without flattening runtime dispatch', () => {
    const result = inspectCompilerMethods(`import { Cossack as Base } from '@cossackframework/core';
      class Parent extends Base { @Server() inherited() { return 1; } }
      @Page() class Child extends Parent { @Client() own() { return 2; } }
      @Page() class External extends ImportedBase { render() { return 3; } }
      @Page() class Dynamic extends mixin(Parent) { render() { return 4; } }
    `, 'inheritance.ts');
    expect(result.diagnostics).toEqual([]);
    const child = result.classes.find(c => c.name === 'Child');
    expect(child?.inheritance).toEqual({ status: 'resolved', bases: ['Parent'] });
    expect(child?.methods.map(m => m.name)).toEqual(['own']);
    expect(result.classes.find(c => c.name === 'Parent')?.methods[0]?.rpc).toBe('explicit');
    expect(result.classes.find(c => c.name === 'External')?.inheritance).toEqual({ status: 'unresolved', bases: ['ImportedBase'] });
    expect(result.classes.find(c => c.name === 'Dynamic')?.inheritance.status).toBe('unresolved');
  });

  it('maps expanded resource methods and following methods to authored bodies', () => {
    const code = `import { server$ as resource } from '@cossackframework/core';
@Page() class Demo {
  data = resource(() => 'PRIVATE_LOADER', { initial: '' });
  render() { return resource(() => 42); }
  @Client() after() { return 'CLIENT_AFTER'; }
}`;
    const result = inspectCompilerMethods(code, 'resource.ts');
    expect(result.diagnostics).toEqual([]);
    expect(result.classes[0].members).toContainEqual({ name: 'data', kind: 'get', static: false, private: false });
    const methods = result.classes[0].methods;
    expect(methods.find(m => m.resource === 'data')).toMatchObject({
      clientBody: 'stripped', rpc: 'explicit', source: { file: 'resource.ts', line: 3, column: 25 },
    });
    expect(methods.find(m => m.resource === 'render:0')).toMatchObject({ source: { line: 4 } });
    expect(methods.find(m => m.name === 'after')).toMatchObject({ source: { line: 5, column: 21 } });
    const expanded = transformServerResources(code, 'resource.ts');
    const client = transformCossackClass(expanded, 'resource.ts', isClientSafeMethod, new Set(['render']), false);
    expect(client).not.toContain('PRIVATE_LOADER');
    expect(client).toContain('CLIENT_AFTER');
    for (const fact of methods.filter(m => m.resource)) expect(client).toContain(`__cossack_proxies?.get('${fact.name}')`);
  });

  it('does not mistake server$ text in comments for resource syntax', () => {
    const result = inspectCompilerMethods('@Page() class Demo { /* server$ */ render() { return 1; } }', 'text.ts');
    expect(result.diagnostics).toEqual([]);
    expect(result.classes[0].methods[0].name).toBe('render');
  });

  it('classifies namespace decorators and strips server function fields and validators', () => {
    const code = `
import * as Core from '@cossackframework/core';
@Core.Page()
class Demo extends Core.Cossack {
  @Core.Client() local() { return 'CLIENT_NAMESPACE'; }
  @Core.Server({ input: Core.input.string().refine(() => 'SECRET_VALIDATOR' === '') }) remote = (value:string) => 'SECRET_NAMESPACE';
  @Core.Server() regular() { return 'SECRET_REGULAR'; }
  render() { return 'view'; }
}`;
    const result = inspectCompilerMethods(code, 'namespace.ts');
    expect(result.diagnostics).toEqual([]);
    expect(result.classes[0].methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'local', clientBody: 'retained', rpc: null }),
      expect.objectContaining({ name: 'remote', clientBody: 'stripped', rpc: 'explicit' }),
      expect.objectContaining({ name: 'regular', clientBody: 'stripped', rpc: 'explicit' }),
    ]));
    const transformed = transformCossackClass(code, 'namespace.ts', isClientSafeMethod, new Set(['render']), false);
    expect(transformed).toContain('CLIENT_NAMESPACE');
    expect(transformed).not.toContain('SECRET_NAMESPACE');
    expect(transformed).not.toContain('SECRET_VALIDATOR');
    expect(transformed).not.toContain('SECRET_REGULAR');
    expect(transformed).toContain("__cossack_proxies?.get('remote')");
    expect(transformed).toContain("__cossack_proxies?.get('regular')");
  });

  it('removes private schema declarations and transitive callbacks while preserving shared form rules', async () => {
    const code = `import { Cossack, Page, Server, input, storeRules, type InputOf } from '@cossackframework/core';
const shared = storeRules({name:{required:true}});
const SECRET = 'PRIVATE_VALIDATOR_TOKEN', visible = 'VIEW';
function check(value:string) { return value !== SECRET; }
const contract = input.object({name:input.string(shared.name).refine(check)});
type Data = InputOf<typeof contract>;
@Page() class Demo extends Cossack {
  @Server({input:contract as typeof contract}) save(value:Data) { return value.name; }
  render() { return visible + String(shared.name.required); }
}`;
    const client = transformCossackClass(code, 'schema.ts', isClientSafeMethod, new Set(['render']), false);
    expect(client).not.toContain('PRIVATE_VALIDATOR_TOKEN'); expect(client).not.toContain('function check');
    expect(client).not.toContain('const contract'); expect(client).not.toContain('input.object');
    expect(client).toContain('visible'); expect(client).toContain('storeRules'); expect(client).toContain('shared.name.required');
    const emitted = await transformWithOxc(client, 'schema.ts', {target:'es2022'});
    expect(emitted.code).not.toContain('PRIVATE_VALIDATOR_TOKEN'); expect(emitted.code).not.toContain('contract');
  });

  it.each([
    'export const contract = input.string().refine(() => true);',
    'const contract = input.string().refine(() => true); export {contract};',
    'const contract = input.string().refine(() => true);',
  ])('rejects exported or client-reachable schema contracts (%#)', declaration => {
    const code = `import { input, Page, Server } from '@cossackframework/core';
${declaration}
@Page() class Demo { @Server({input:contract}) save(value:string) {return value;} render() {return contract;} }`;
    expect(() => transformCossackClass(code, 'schema.ts', isClientSafeMethod, new Set(['render']), false))
      .toThrow(/Server input binding/);
  });

  it('retains shared form rules without reintroducing a private action schema', () => {
    const code = `import {storeRules, input, Page, Server} from '@cossackframework/core';
const rules = storeRules({name:{required:true}});
const contract=input.object({name:input.string(rules.name)});
@Page() class Demo { @Server({input:contract}) save(value:{name:string}) {return value;} render(){return rules.name.required;} }`;
    const client = transformCossackClass(code, 'rules.ts', isClientSafeMethod, new Set(['render']), false);
    expect(client).toContain('storeRules'); expect(client).toContain('rules.name.required');
    expect(client).not.toContain('input.object');
  });
  it('removes wholly private imports and rejects a foreign contract module also retained by the client', () => {
    const privateOnly = `import {contract} from './server-contract';
@Page() class Demo { @Server({input:contract}) save(value:string) {return value;} render(){return 'view';} }`;
    const client=transformCossackClass(privateOnly, 'imports.ts', isClientSafeMethod, new Set(['render']), false);
    expect(client).not.toContain('./server-contract');
    for(const retained of [
      "import {label} from './server-contract';",
      "import './server-contract';",
    ]) {
      const source=privateOnly.replace("@Page()", `${retained}\n@Page()`).replace("return 'view'", 'return label');
      expect(()=>transformCossackClass(source,'imports.ts',isClientSafeMethod,new Set(['render']),false)).toThrow(/Server input module/);
    }
  });
  it.each([
    "import {contract,persist,type Data as SchemaData} from './private-contract';",
    "import {contract,persist} from './private-contract';import type {Data as SchemaData} from './private-contract';",
    "import {contract,persist} from './private-contract';import {type Data as SchemaData} from './private-contract';",
    "import {contract,persist,type/* annotation */Data as SchemaData} from './private-contract';",
  ])('does not retain a private contract module through type-only imports (%#)',async declaration=>{
    const source=`import {Page,Server,Client} from '@cossackframework/core';
${declaration}
import {type Other} from './client-initializer';
@Page()class Demo{
  @Server({input:contract})save=(value:SchemaData)=>persist(value);
  @Client()local(value:SchemaData){return value;}
  render(){return 'view';}
}`;
    const client=transformCossackClass(source,'private-types.ts',isClientSafeMethod,new Set(['render']),false);
    expect(client).toContain('import type {');expect(client).toContain('Data as SchemaData');
    const emitted=await transformWithOxc(client,'private-types.ts',{target:'es2022',tsconfig:{compilerOptions:{verbatimModuleSyntax:true}}});
    expect(emitted.code).not.toContain('./private-contract');expect(emitted.code).not.toContain('persist(value)');
    expect(emitted.code).toContain('./client-initializer');
  });
  it('does not keep a private schema alive through unrelated local parameters or variables', () => {
    const source=`import {input,Page,Server,Client} from '@cossackframework/core';
const contract=input.string().refine(value=>value!=='PRIVATE_SHADOWED_SCHEMA');
@Page() class Demo {
  @Server({input:contract}) save(value:string){return value;}
  @Client() local(contract:string){return contract;}
  render(){const contract='public';return contract;}
}`;
    const client=transformCossackClass(source,'shadow.ts',isClientSafeMethod,new Set(['render']),false);
    expect(client).not.toContain('PRIVATE_SHADOWED_SCHEMA'); expect(client).not.toContain('input.string');
    expect(client).toContain("const contract='public'"); expect(client).toContain('return contract');
  });
  it('removes destructured private contracts together and rejects a client-retained sibling', () => {
    const source=`import {input,Page,Server} from '@cossackframework/core';
function make(){return {contract:input.string().refine(()=>false,'PRIVATE_DESTRUCTURED_VALIDATOR'),label:'public'};}
const {contract,label}=make();
@Page() class Demo { @Server({input:contract}) save(value:string){return value;} render(){return 'view';} }`;
    const client=transformCossackClass(source,'destructure.ts',isClientSafeMethod,new Set(['render']),false);
    expect(client).not.toContain('PRIVATE_DESTRUCTURED_VALIDATOR'); expect(client).not.toContain('make()');
    expect(()=>transformCossackClass(source.replace("return 'view'",'return label'),'destructure.ts',isClientSafeMethod,new Set(['render']),false))
      .toThrow(/Server input binding/);
  });
  it('fails closed for private runtime TypeScript dependencies it cannot safely strip', () => {
    const source=`import {input,Page,Server} from '@cossackframework/core';
enum Private {Value='PRIVATE_ENUM_SENTINEL'}
const contract=input.string().refine(value=>value!==Private.Value);
@Page() class Demo { @Server({input:contract}) save(value:string){return value;} render(){return 'view';} }`;
    expect(()=>transformCossackClass(source,'enum.ts',isClientSafeMethod,new Set(['render']),false))
      .toThrow(/runtime TypeScript declaration/);
  });

  it('rejects unsupported server accessors behind namespace aliases', () => {
    const code = `import * as Core from '@cossackframework/core';
      @Core.Page() class Demo { @Core.Server() get value() { return 'SECRET'; } }`;
    expect(inspectCompilerMethods(code, 'namespace.ts').diagnostics).toHaveLength(1);
    expect(() => transformCossackClass(code, 'namespace.ts', isClientSafeMethod, new Set(['render']), false))
      .toThrow('@Server requires');
  });

  it('matches client bodies and RPC registration without executing source', () => {
    const code = `
@Page()
class Demo extends Cossack {
  constructor() { throw new Error('must not run'); }
  render() { this.helper(); return html\`<button @click=\"\${this.save}\">Save</button>\`; }
  helper() { return 'CLIENT_HELPER'; }
  save() { return 'AUTOMATIC_SERVER'; }
  @Server() explicit() { return 'EXPLICIT_SERVER'; }
  unused() { return 'UNREACHABLE_SERVER'; }
  field = () => 'RETAINED_FIELD';
}`;
    const facts = inspectCompilerMethods(code, 'demo.ts');
    expect(facts.diagnostics).toEqual([]);
    const methods = Object.fromEntries(facts.classes[0].methods.map((m) => [m.name, m]));
    expect(methods.helper).toMatchObject({ clientBody: 'retained', rpc: null });
    expect(methods.save).toMatchObject({ clientBody: 'stripped', rpc: 'automatic' });
    expect(methods.explicit).toMatchObject({ clientBody: 'stripped', rpc: 'explicit' });
    expect(methods.unused).toMatchObject({ clientBody: 'stripped', rpc: null });
    expect(methods.field).toMatchObject({ clientBody: 'retained', rpc: null });
    expect(methods.helper.source).toEqual({ file: 'demo.ts', line: 6, column: 12 });
    const transformed = transformCossackClass(code, 'demo.ts', isClientSafeMethod, new Set(['render']), false);
    expect(transformed).toContain('CLIENT_HELPER');
    expect(transformed).toContain('RETAINED_FIELD');
    for (const body of ['AUTOMATIC_SERVER', 'EXPLICIT_SERVER', 'UNREACHABLE_SERVER']) {
      expect(transformed).not.toContain(body);
    }
  });

  it.each([
    'class Broken {',
    '@Page() class Demo { @Server() get secret() { return 1; } }',
    "import { server$ } from '@cossackframework/core'; @Page() class Demo { value = server$(() => 1); }",
  ])('reports unknown input without partial facts or source excerpts', (source) => {
    const result = inspectCompilerMethods(source, 'demo.ts');
    expect(result.classes).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: 'COSSACK_COMPILER_INSPECTION_UNKNOWN', file: 'demo.ts',
    })]);
  });
});

describe('cross-file base class warning', () => {
  const run = (source: string, id: string) => {
    const warn = vi.fn();
    const result = (cossackSecurityPlugin().transform as Function).call({ environment: { name: 'client' }, warn }, source, id);
    return { warn, code: result.code as string };
  };
  const subclass = (decorator = '') => `
    import { BasePage } from '../../lib/base-page';
    ${decorator}
    export default class ReportPage extends BasePage {
      render() { return 'report'; }
      async loadSecrets() { return process.env.SECRET; }
      get title() { return 'Report'; }
    }
  `;

  it.each(['/src/pages/reports/index.ts', '/src/components/report.ts'])('warns for an undecorated subclass of an imported base in %s', id => {
    const { warn, code } = run(subclass(), id);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('ReportPage');
    expect(message).toContain('BasePage');
    expect(message).toContain('loadSecrets');
    expect(message).not.toMatch(/\brender\b|\btitle\b/);
    expect(message).toMatch(/@Page|@Component/);
    expect(message).toContain('docs/client-bundle.md#build-failures-and-class-discovery');
    // Stripping semantics are unchanged: the class is not transformed.
    expect(code).toContain('process.env.SECRET');
  });

  it.each([
    ['decorated with @Page', `import { Page } from '@cossackframework/core';\n${subclass('@Page()')}`, '/src/pages/reports/index.ts'],
    ['outside pages and components', subclass(), '/src/lib/report.ts'],
    ['only built-in methods', `import { BasePage } from './base'; export default class P extends BasePage { render() { return ''; } }`, '/src/pages/p.ts'],
    ['a local base class', `class BasePage {} export default class P extends BasePage { load() {} }`, '/src/pages/p.ts'],
    ['a framework base', `import { Cossack } from '@cossackframework/core'; export default class P extends Cossack { load() {} }`, '/src/pages/p.ts'],
  ])('does not warn for %s', (_label, source, id) => {
    expect(run(source, id).warn).not.toHaveBeenCalled();
  });
});
