/**
 * Unit tests for vite-security-plugin
 * Tests the code stripping functionality to ensure server-only code is properly removed from client bundles.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  transformCossackClass,
  injectAutomaticServerMethodMetadata,
  isClientSafeMethod,
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
    expect(result).toContain('this.__serverResource("users"');
    expect(result).toContain('this.__serverResource("render:0"');
    expect(result).toContain("import { Server as __CossackServerResource } from '@cossackframework/core'");
    expect(result).toContain('@__CossackServerResource({ serverResource: true })');
    expect(result).toContain('return this.find(id)');
  });

  it('requires initial for fields', () => {
    const source = `import { server$ } from '@cossackframework/core'; class A extends Cossack { x = server$(() => 1); }`;
    expect(() => transformServerResources(source, 'a.ts')).toThrow('requires { initial }');
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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    // Create a local version for testing
    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
    });

    it('should mark @Server decorated methods as server-only', () => {
      expect(isClientSafeMethod(['@Server()'], 'myMethod', BUILTIN_METHODS)).toBe(false);
    });

    it('should mark methods without decorators as server-only (secure by default)', () => {
      expect(isClientSafeMethod([], 'myMethod', BUILTIN_METHODS)).toBe(false);
      expect(isClientSafeMethod([], 'init', BUILTIN_METHODS)).toBe(false);
      expect(isClientSafeMethod([], 'get', BUILTIN_METHODS)).toBe(false);
    });
  });

  describe('Transform Methods', () => {
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
          \${{() => 'inline arrow'}}
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
      expect(result).toContain('super()');
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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);
    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);
    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
      const regCount = (result.match(/__registerServerOnlyMethods\?\.\(\)/g) || []).length;
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
      expect(result).toContain('super()');
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
      const regCount = (result.match(/__registerServerOnlyMethods\?\.\(\)/g) || []).length;
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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);
    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);
    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
      if (hasClientDecorator) return true;
      if (builtinMethods.has(methodName)) return true;
      if (decorators.some((d) => /@Server\b/.test(d))) return false;
      return false;
    }

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
  const BUILTIN_METHODS = new Set([
    'render', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'escapeHtml',
    'loadingTemplate', 'toString', 'valueOf', 'clientInit',
    'getError', 'hasError', 'validateProperty', 'validateAll', 'clearErrors',
    'startViewTransition',
  ]);

  function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
    const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d));
    if (hasClientDecorator) return true;
    if (builtinMethods.has(methodName)) return true;
    if (decorators.some((d) => /@Server\b/.test(d))) return false;
    return false;
  }

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

  it('preserves transitive this.foo() chains to the documented depth-3 cap', () => {
    // The preservation closure runs 3 rounds, covering the common chain
    // onMount -> setup -> wire -> listen (3 hops). The deepest helper's body
    // must survive. (Deeper chains are intentionally not guaranteed.)
    const code = `
@Page()
export class Page extends Cossack {
  onMount() { this.setup(); }
  setup() { this.wire(); }
  wire() { this.listen(); }
  listen() { const secret = 'DEEP_SECRET'; return secret; }
  render() { return html\`<p>x</p>\`; }
}`;
    const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
    // The deepest helper's body survives (it was transitively preserved).
    expect(result).toContain('DEEP_SECRET');
    expect(result).toContain('listen()');
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

  it('warns and skips stripping when the source cannot be parsed', () => {
    // Security plugin: a parse failure must NOT silently ship server-only code.
    // It returns the source unchanged (fail-open is unavoidable — we can't strip
    // what we can't parse) but emits a console.warn naming the file.
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      // Intentionally malformed TypeScript that Oxc rejects.
      const code = `export class extends Cossack { @Server() x(`;
      const result = transformCossackClass(code, 'broken.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // Source is returned unchanged.
      expect(result).toBe(code);
      // A warning naming the file was emitted.
      expect(warnings.some((w) => w.includes('broken.ts') && w.includes('SKIPPED'))).toBe(true);
    } finally {
      console.warn = original;
    }
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
