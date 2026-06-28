/**
 * Unit tests for vite-security-plugin
 * Tests the code stripping functionality to ensure server-only code is properly removed from client bundles.
 */

import { describe, it, expect } from 'vitest';
import { transformCossackClass, isClientSafeMethod, stripSsgGenerateStaticParams } from '../src/vite-security-plugin';

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

    it('should handle arrow function properties', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    arrowProperty = () => {
      return 'arrow';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).toContain('arrowProperty = () =>');
      expect(result).toContain("return 'arrow'");
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
      const result = await db.select().from('users').where('id', '=', userId);
      return result;
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      expect(result).not.toContain('db.select()');
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
      const rows = await db.select().from('users');
      return rows;
    }
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('SECRET_KEY');
    expect(result).not.toContain('db.select');
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
      return db.query('SELECT ...');
    }
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('enabled: true');
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('db.query');
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
      return db.list();
    }
  }
})
export class P extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).toContain('generateStaticParams: async () => []');
    expect(result).not.toContain('db.list');
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
  ssg: { generateStaticParams: async () => db.a() }
})
export class A extends Cossack {}

@Page({
  ssg: { generateStaticParams: async () => db.b() }
})
export class B extends Cossack {}`;

    const result = stripSsgGenerateStaticParams(code);
    expect(result).not.toContain('db.a');
    expect(result).not.toContain('db.b');
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
      const users = await db.select().from('users');
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
    expect(result).not.toContain('db.select');
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
    await db.insert();
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
    await db.insert();
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
});
