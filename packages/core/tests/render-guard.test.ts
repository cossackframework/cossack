import 'reflect-metadata';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  enterRender,
  exitRender,
  isRendering,
  assertNotRendering,
} from '../src/shared/server-fn';
import { composeHead, mergeHead } from '../src/shared/head';
import type { HeadContext, HeadValue } from '../src/shared/head';
import { Cossack } from '../src/shared/cossack';
import { Page } from '../src/shared/decorators';
import type { TemplateResult } from '@cossackframework/renderer';

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
    vi.unstubAllEnvs();
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
    vi.stubEnv('DEV', true);
    enterRender();
    expect(() => assertNotRendering()).toThrowError(/render phase/);
    exitRender();
  });

  it('assertNotRendering warns (not throws) in production when rendering', () => {
    vi.stubEnv('DEV', false);
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      enterRender();
      expect(() => assertNotRendering()).not.toThrow();
      expect(warnings.some((w) => w.includes('render phase'))).toBe(true);
      exitRender();
    } finally {
      console.warn = original;
    }
  });

  it('warns instead of throwing in a production browser bundle (no NODE_ENV)', () => {
    // Browsers have no process.env; the Vite build flag decides the mode.
    vi.stubEnv('DEV', false);
    vi.stubEnv('NODE_ENV', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      enterRender();
      expect(() => assertNotRendering()).not.toThrow();
      expect(() => new (class extends Cossack<{}> {})().__cossackAssertNotRendering('load')).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(2);
      exitRender();
    } finally {
      warn.mockRestore();
    }
  });

  it('throws in development even when NODE_ENV is production', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('NODE_ENV', 'production');
    enterRender();
    expect(() => assertNotRendering()).toThrowError(/render phase/);
    expect(() => new (class extends Cossack<{}> {})().__cossackAssertNotRendering('load')).toThrowError(/render phase/);
    exitRender();
  });

  it('assertNotRendering is a no-op when not rendering', () => {
    vi.stubEnv('DEV', true);
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
    vi.unstubAllEnvs();
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
    vi.stubEnv('DEV', true);
    const page = {
      head(_ctx: HeadContext): HeadValue {
        assertNotRendering();
        return {};
      },
    };
    expect(() => composeHead(page, [], { head: () => ({}) })).toThrowError(/render phase/);
  });

  it('guards direct _getWrappedTemplate() calls (router/ssg/client composition paths)', () => {
    // Regression: the framework composes the HTML tree by calling
    // `_getWrappedTemplate()` directly (router.ts / ssg-renderer.ts / client
    // app.ts), bypassing `_render()`. The guard must live in
    // `_getWrappedTemplate` itself so those paths are covered, not just the
    // `_render`/`performUpdate` internal calls. This test exercises the real
    // chokepoint by calling `_getWrappedTemplate` on a Cossack instance and
    // observing the render flag from inside `render()`.
    vi.stubEnv('DEV', true);

    let observedDuringRender: boolean | null = null;
    @Page({})
    class GuardProbe extends Cossack<{}> {
      render(): TemplateResult | null {
        observedDuringRender = isRendering();
        return null;
      }
    }
    const instance = new GuardProbe();

    // Before: not rendering.
    expect(isRendering()).toBe(false);

    // Direct call to the composition chokepoint (not _render()).
    instance._getWrappedTemplate();

    // During render(), the flag was observed true.
    expect(observedDuringRender).toBe(true);
    // After: balanced back to false (the try/finally exited the window).
    expect(isRendering()).toBe(false);
  });
});

describe('head development diagnostics', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  const emptyContext = () => ({ title: '', description: '', image: '', meta: [], links: [], scripts: [], tags: [] });

  it('warns about misplaced tags in a development browser bundle (no NODE_ENV)', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('NODE_ENV', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mergeHead(emptyContext(), { meta: [{ tag: 'link', attributes: { rel: 'canonical', href: '/' } }] });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('stays silent in production', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mergeHead(emptyContext(), { meta: [{ tag: 'link', attributes: { rel: 'canonical', href: '/' } }] });
    expect(warn).not.toHaveBeenCalled();
  });
});
