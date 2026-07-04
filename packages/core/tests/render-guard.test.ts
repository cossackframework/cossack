import { describe, it, expect, afterEach } from 'vitest';
import {
  enterRender,
  exitRender,
  isRendering,
  assertNotRendering,
} from '../src/shared/server-fn';

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
