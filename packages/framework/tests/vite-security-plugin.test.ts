/**
 * Unit tests for vite-security-plugin
 * Tests the code stripping functionality to ensure server-only code is properly removed from client bundles.
 */

import { describe, it, expect } from 'vitest';
import { transformCossackClass, isClientSafeMethod } from '../src/vite-security-plugin';

describe('vite-security-plugin', () => {
  describe('isClientSafeMethod', () => {
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    // Create a local version for testing
    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|OnEvent)\b/.test(d));
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

    it('should mark built-in methods as client-safe', () => {
      expect(isClientSafeMethod([], 'render', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'head', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'onMount', BUILTIN_METHODS)).toBe(true);
      expect(isClientSafeMethod([], 'onCleanup', BUILTIN_METHODS)).toBe(true);
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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|OnEvent)\b/.test(d));
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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|OnEvent)\b/.test(d));
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


    it('should register server-only methods in metadata', () => {
      const code = `
@Page()
export class TestPage extends Cossack {
    async init() {
      return 'server-only';
    }
}`;

      const result = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, true);
      // Should inject __registerServerOnlyMethods
      expect(result).toContain('__registerServerOnlyMethods()');
      expect(result).toContain('["init"]');
      expect(result).toContain("channel: 'global'");
    });
  });

  describe('Security Tests', () => {
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|OnEvent)\b/.test(d));
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
    const BUILTIN_METHODS = new Set(['render', 'head', 'onMount', 'onCleanup', 'escapeHtml', 'loadingTemplate', 'toString', 'valueOf']);

    function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
      const hasClientDecorator = decorators.some((d) => /@(?:Client|Optimistic|Computed|Shared|OnEvent)\b/.test(d));
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

    it('should handle the lifecycle demo pattern', () => {
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

      // init should be stubbed
      expect(result).toContain('init() {');
      expect(result).toContain("__cossack_proxies?.get('init')");
      expect(result).not.toContain('setTimeout');

      // reload should be preserved
      expect(result).toContain('reload() {');
      expect(result).toContain('await this.init()');

      // render should be preserved
      expect(result).toContain('render() {');
      expect(result).toContain('html`');
    });
  });
});
