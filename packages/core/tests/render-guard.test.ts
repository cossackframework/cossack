import 'reflect-metadata';
import { describe, it, expect, afterEach } from 'vitest';
import {
  enterRender,
  exitRender,
  isRendering,
  assertNotRendering,
} from '../src/shared/server-fn';
import { composeHead } from '../src/shared/head';
import type { HeadContext, HeadValue } from '../src/shared/head';

/**
 * Coverage for the runtime render-phase guard retained after the
 * `Server(() => ...)` feature revert. The guard is what makes a stripped
 * `@Server` method (or any server call) invoked during `render()` fail loudly
 * instead of rendering as "[object Promise]" or leaking server-only code.
 */
describe('render-phase guard', () => {
  afterEach(() => {
    // Never let the render-depth flag leak between tests.
    while (isRendering()) exitRender();
    (globalThis as any).process = (globalThis as any).process || {};
    (globalThis as any).process.env = (globalThis as any).process.env || {};
    (globalThis as any).process.env.NODE_ENV = 'test';
  });

  it('enterRender/exitRender nest and report isRendering correctly', () => {
    expect(isRendering()).toBe(false);
    enterRender();
    expect(isRendering()).toBe(true);
    enterRender();
    expect(isRendering()).toBe(true);
    exitRender();
    expect(isRendering()).toBe(true);
    exitRender();
    expect(isRendering()).toBe(false);
  });

  it('exitRender does not underflow past zero', () => {
    exitRender();
    exitRender();
    expect(isRendering()).toBe(false);
  });

  it('assertNotRendering throws in development when rendering', () => {
    (globalThis as any).process.env.NODE_ENV = 'development';
    enterRender();
    expect(() => assertNotRendering()).toThrowError(/during render/);
    exitRender();
  });

  it('assertNotRendering warns (not throws) in production when rendering', () => {
    (globalThis as any).process.env.NODE_ENV = 'production';
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      enterRender();
      expect(() => assertNotRendering()).not.toThrow();
      expect(warnings.some((w) => w.includes('during render'))).toBe(true);
      exitRender();
    } finally {
      console.warn = original;
    }
  });

  it('assertNotRendering is a no-op when not rendering', () => {
    (globalThis as any).process.env.NODE_ENV = 'development';
    expect(() => assertNotRendering()).not.toThrow();
  });
});

/**
 * Coverage for the extended render-phase guard: `head()` is also synchronous,
 * so a `@Server` method invoked from it must trip the guard just like one
 * invoked from `render()`. The guard wraps the `head()` invocation in both the
 * SSR path (`composeHead`) and the client path (`updateHead`).
 */
describe('render-phase guard — head()', () => {
  afterEach(() => {
    while (isRendering()) exitRender();
    (globalThis as any).process = (globalThis as any).process || {};
    (globalThis as any).process.env = (globalThis as any).process.env || {};
    (globalThis as any).process.env.NODE_ENV = 'test';
  });

  it('isRendering is true while composeHead runs head() on the server', () => {
    // A head() hook that observes the render flag. composeHead must enter the
    // render window around each instance.head(ctx) call.
    let observed: boolean | null = null;
    const page = {
      head(_ctx: HeadContext): HeadValue {
        observed = isRendering();
        return {};
      },
    };
    composeHead(page, [], { head: () => ({}) });
    expect(observed).toBe(true);
  });

  it('isRendering is false again after composeHead completes', () => {
    composeHead({ head: () => ({}) }, [], { head: () => ({}) });
    expect(isRendering()).toBe(false);
  });

  it('a @Server stub invoked from head() trips the guard during composeHead', () => {
    // The security plugin's client stubs call `this.__cossackAssertNotRendering`;
    // here we simulate that by calling assertNotRendering() directly from head().
    // In dev it throws, which is the loud-failure behaviour we want.
    (globalThis as any).process.env.NODE_ENV = 'development';
    const page = {
      head(_ctx: HeadContext): HeadValue {
        assertNotRendering();
        return {};
      },
    };
    expect(() => composeHead(page, [], { head: () => ({}) })).toThrowError(/during render/);
  });
});
