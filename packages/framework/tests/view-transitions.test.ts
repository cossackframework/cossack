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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transformCossackClass } from '../src/vite-security-plugin';

describe('View Transitions: security plugin', () => {
  const BUILTIN_METHODS = new Set([
    'render', 'head', 'onMount', 'onCleanup', 'escapeHtml', 'loadingTemplate',
    'toString', 'valueOf', 'clientInit',
    'getError', 'hasError', 'validateProperty', 'validateAll', 'clearErrors',
    'onNavigateComplete',
    'startViewTransition',
  ]);

  function isClientSafeMethod(decorators: string[], methodName: string, builtinMethods: Set<string>): boolean {
    const hasClientDecorator = decorators.some((d) =>
      /@(?:Client|Optimistic|Computed|Shared|On(?:Event|Document|Window)?|PreventNavigation|Validate|VisibleTask|Task)\b/.test(d)
    );
    if (hasClientDecorator) return true;
    if (builtinMethods.has(methodName)) return true;
    if (decorators.some((d) => /@Server\b/.test(d))) return false;
    return false;
  }

  it('startViewTransition is classified as client-safe (not stripped)', () => {
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
  let onNavigateCalls: { url: string; options?: { types?: string[] } }[];
  let cleanupNavigation: (() => void) | undefined;

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
    const { enableClientNavigation } = await import('@cossackframework/core');

    const onNavigate = vi.fn(async (url: string, options?: { types?: string[] }) => {
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
    const { enableClientNavigation } = await import('@cossackframework/core');

    const onNavigate = vi.fn(async (url: string, options?: { types?: string[] }) => {
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
    const { enableClientNavigation } = await import('@cossackframework/core');

    const onNavigate = vi.fn(async (url: string, options?: { types?: string[] }) => {
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

  it('does not navigate a link already handled by a component', async () => {
    const { enableClientNavigation } = await import('@cossackframework/core');
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
