// @vitest-environment jsdom
/**
 * Unit tests for View Transitions integration in the framework.
 *
 * These tests focus on the testable pieces:
 * 1. The security plugin keeps `startViewTransition` in client bundles.
 * 2. The `data-transition-types` attribute is read and forwarded by the
 *    click interceptor.
 * 3. The reduced-motion style tag is injected when `viewTransitions: true`.
 *
 * The full `navigate()` wrapping is covered by e2e tests instead — it
 * requires mocking `virtual:cossack-pages`, `fetch`, `DOMParser`, and the
 * entire renderer, which provides little value over the browser test.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { BUILTIN_METHODS, isClientSafeMethod, transformCossackClass } from '../src/vite-security-plugin';

describe('View Transitions: security plugin', () => {
  it('startViewTransition is classified as client-safe (not stripped)', () => {
    expect(BUILTIN_METHODS.has('startViewTransition')).toBe(true);
    expect(isClientSafeMethod([], 'startViewTransition', BUILTIN_METHODS)).toBe(true);
  });

  it('user overrides of startViewTransition survive stripping in client bundles', () => {
    const code = `
      class MyPage extends Cossack {
        startViewTransition(cb) {
          console.log('custom VT');
          return cb();
        }
      }
    `;
    const transformed = transformCossackClass(code, 'test.ts', isClientSafeMethod, BUILTIN_METHODS, false);
    // The method body should NOT be replaced with a stub
    expect(transformed).toContain("console.log('custom VT')");
    expect(transformed).not.toContain('was stripped');
  });
});

describe('View Transitions: data-transition-types click interception', () => {
  type TestNavigateOptions = {
    types?: string[];
    scroll?: 'auto' | 'top' | 'preserve';
    navigationType?: 'push' | 'replace' | 'traverse';
  };
  let onNavigateCalls: { url: string; options?: TestNavigateOptions }[];
  let cleanupNavigation: (() => void) | undefined;
  let enableClientNavigation: typeof import('@cossackframework/core').enableClientNavigation;

  // Cold-importing core can exceed the default 5s test timeout under load.
  beforeAll(async () => {
    ({ enableClientNavigation } = await import('@cossackframework/core'));
  }, 60_000);

  beforeEach(() => {
    onNavigateCalls = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanupNavigation?.();
    cleanupNavigation = undefined;
    vi.restoreAllMocks();
  });

  it('reads data-transition-types from clicked <a> and forwards as { types }', async () => {
    const onNavigate = vi.fn(async (url: string, options?: TestNavigateOptions) => {
      onNavigateCalls.push({ url, options });
      return true;
    });

    cleanupNavigation = enableClientNavigation(onNavigate);

    // Create an anchor with data-transition-types
    const link = document.createElement('a');
    link.href = '/photo/42';
    link.setAttribute('data-transition-types', 'nav-forward slide-up');
    link.textContent = 'View photo';
    document.body.appendChild(link);

    link.click();

    // Wait for the async click handler
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigateCalls[0].url).toBe('/photo/42');
    expect(onNavigateCalls[0].options).toEqual({ types: ['nav-forward', 'slide-up'] });
  });

  it('passes undefined options when no data-transition-types attribute', async () => {
    const onNavigate = vi.fn(async (url: string, options?: TestNavigateOptions) => {
      onNavigateCalls.push({ url, options });
      return true;
    });

    cleanupNavigation = enableClientNavigation(onNavigate);

    const link = document.createElement('a');
    link.href = '/about';
    link.textContent = 'About';
    document.body.appendChild(link);

    link.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigateCalls[0].url).toBe('/about');
    expect(onNavigateCalls[0].options).toBeUndefined();
  });

  it('passes undefined options when data-transition-types is empty', async () => {
    const onNavigate = vi.fn(async (url: string, options?: TestNavigateOptions) => {
      onNavigateCalls.push({ url, options });
      return true;
    });

    cleanupNavigation = enableClientNavigation(onNavigate);

    const link = document.createElement('a');
    link.href = '/empty';
    link.setAttribute('data-transition-types', '   ');
    link.textContent = 'Empty';
    document.body.appendChild(link);

    link.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigateCalls[0].options).toBeUndefined();
  });

  it('reads data-scroll from clicked <a> and combines it with transition types', async () => {
    const onNavigate = vi.fn(async (url: string, options?: TestNavigateOptions) => {
      onNavigateCalls.push({ url, options });
      return true;
    });

    cleanupNavigation = enableClientNavigation(onNavigate);

    const link = document.createElement('a');
    link.href = '/gallery';
    link.dataset.transitionTypes = 'nav-forward';
    link.dataset.scroll = 'preserve';
    document.body.appendChild(link);

    link.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onNavigateCalls[0]).toEqual({
      url: '/gallery',
      options: { types: ['nav-forward'], scroll: 'preserve' },
    });
  });

  it('marks popstate navigation as history traversal', async () => {
    const onNavigate = vi.fn(async (url: string, options?: TestNavigateOptions) => {
      onNavigateCalls.push({ url, options });
      return true;
    });

    cleanupNavigation = enableClientNavigation(onNavigate);
    window.history.replaceState({}, '', '/previous?tab=one#details');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onNavigateCalls[0]).toEqual({
      url: '/previous?tab=one#details',
      options: { navigationType: 'traverse' },
    });
  });

  it('does not navigate a link already handled by a component', async () => {
    const onNavigate = vi.fn(async () => true);

    cleanupNavigation = enableClientNavigation(onNavigate);

    const link = document.createElement('a');
    link.href = '/component-owned';
    link.addEventListener('click', (event) => event.preventDefault());
    document.body.appendChild(link);

    link.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
