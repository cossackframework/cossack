// tests/view-transitions.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the environment to be client-side BEFORE anything else is imported
vi.mock('../src/shared/environment', () => ({
  isServer: false,
}));

// Mock the renderer
vi.mock('@cossackframework/renderer', () => {
    const render = vi.fn();
    const renderToString = vi.fn();
    const createContext = <T>(defaultValue: T) => ({ defaultValue, _id: Math.random().toString() });
    class CossackElement {
        render() { return null; }
        requestUpdate() { return Promise.resolve(true); }
        mount(container: any) { render(this.render(), container); }
        updated() {}
        connectedCallback() {}
        disconnectedCallback() {}
        static properties = {};
        autoBindMethods() {}
        consume() { return undefined; }
        provide() {}
        resetRenderState() {}
    }
    return {
        render,
        renderToString,
        html: (strings: any, ...values: any[]) => ({ strings, values }),
        CossackElement,
        createContext,
        isTemplateResult: vi.fn(() => true),
        pushCurrentInstance: vi.fn(),
        popCurrentInstance: vi.fn(),
        instanceStack: [],
    };
});

import { supportsViewTransitions, supportsViewTransitionTypes } from '../src/client/navigation';
import { Cossack } from '../src/shared/cossack';

class TestComponent extends Cossack<{}> {}

describe('supportsViewTransitions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns false when document.startViewTransition is undefined', () => {
    // jsdom doesn't have startViewTransition, so this should be false by default
    expect(supportsViewTransitions()).toBe(false);
  });

  it('returns true when document.startViewTransition is a function', () => {
    // Stub document with startViewTransition
    const doc = { ...(document as any) };
    doc.startViewTransition = vi.fn();
    vi.stubGlobal('document', doc);
    expect(supportsViewTransitions()).toBe(true);
  });
});

describe('supportsViewTransitionTypes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a boolean and never throws (graceful when CSS is absent)', () => {
    vi.stubGlobal('CSS', undefined);
    expect(() => supportsViewTransitionTypes()).not.toThrow();
    expect(typeof supportsViewTransitionTypes()).toBe('boolean');
  });

  it('returns false in environments lacking the VT-type selector', () => {
    // jsdom does not implement view-transition-type, so the detector reports
    // false here (the real feature ships in Chrome 125+).
    expect(supportsViewTransitionTypes()).toBe(false);
  });
});

describe('Cossack.prototype.startViewTransition', () => {
  let component: TestComponent;

  beforeEach(() => {
    component = new TestComponent();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls the callback directly when supportsViewTransitions() is false', async () => {
    // jsdom has no startViewTransition → supportsViewTransitions() is false
    const callback = vi.fn(() => 'result');
    const result = await component.startViewTransition(callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result).toBe('result');
  });

  /**
   * Helper: create a mock startViewTransition that simulates the real browser
   * behavior — it invokes the update callback, waits for it to finish, then
   * resolves transition.updateCallbackDone.
   */
  function mockStartViewTransition() {
    const doc = { ...(document as any) };
    doc.startViewTransition = vi.fn((arg) => {
      const update = typeof arg === 'function' ? arg : arg.update;
      const updateCallbackDone = Promise.resolve().then(update);
      return {
        updateCallbackDone,
        ready: updateCallbackDone.then(() => undefined),
        finished: updateCallbackDone.then(() => undefined),
      };
    });
    vi.stubGlobal('document', doc);
    return doc;
  }

  it('calls document.startViewTransition with the wrapped update when supported', async () => {
    const doc = mockStartViewTransition();

    const callback = vi.fn(() => 'done');
    const result = await component.startViewTransition(callback);

    // startViewTransition should have been called with a function (callback form, no types)
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    const arg = doc.startViewTransition.mock.calls[0][0];
    expect(typeof arg).toBe('function');

    // The callback should have run inside the update
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result).toBe('done');
  });

  it('passes types via the object form when types are provided', async () => {
    const doc = mockStartViewTransition();

    const callback = vi.fn(() => 42);
    const result = await component.startViewTransition(callback, ['nav-forward']);

    // Should use the object form { update, types }
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    const arg = doc.startViewTransition.mock.calls[0][0];
    expect(typeof arg).toBe('object');
    expect(arg.types).toEqual(['nav-forward']);
    expect(typeof arg.update).toBe('function');
    expect(result).toBe(42);
  });

  it('uses the callback form when no types are provided', async () => {
    const doc = mockStartViewTransition();

    await component.startViewTransition(() => {});

    const arg = doc.startViewTransition.mock.calls[0][0];
    // No types → callback form (function, not object)
    expect(typeof arg).toBe('function');
  });

  it('awaits requestUpdate inside the update callback', async () => {
    const doc = { ...(document as any) };
    doc.startViewTransition = vi.fn((updateFn) => {
      const updateCallbackDone = Promise.resolve().then(updateFn);
      return {
        updateCallbackDone,
        ready: updateCallbackDone.then(() => undefined),
        finished: updateCallbackDone.then(() => undefined),
      };
    });
    vi.stubGlobal('document', doc);

    // Spy on component.requestUpdate
    const requestUpdateSpy = vi.spyOn(component, 'requestUpdate').mockResolvedValue(true as any);

    await component.startViewTransition(() => {});
    expect(requestUpdateSpy).toHaveBeenCalled();
  });

  it('does not resolve before the browser runs the update callback', async () => {
    const doc = mockStartViewTransition();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;

    const result = component.startViewTransition(async () => {
      await gate;
      return 'committed';
    }).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(result).resolves.toBe('committed');
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
  });

  it('handles animation readiness rejection when a transition is skipped', async () => {
    const doc = { ...(document as any) };
    const readyCatch = vi.fn().mockReturnValue(Promise.resolve());
    const finishedCatch = vi.fn().mockReturnValue(Promise.resolve());
    doc.startViewTransition = vi.fn((updateFn) => ({
      updateCallbackDone: Promise.resolve().then(updateFn),
      ready: { catch: readyCatch },
      finished: { catch: finishedCatch },
    }));
    vi.stubGlobal('document', doc);

    await expect(component.startViewTransition(() => 'done')).resolves.toBe('done');
    expect(readyCatch).toHaveBeenCalledTimes(1);
    expect(finishedCatch).toHaveBeenCalledTimes(1);
  });
});

describe('Cossack.prototype.redirect with options on client', () => {
  let component: TestComponent;

  beforeEach(() => {
    component = new TestComponent();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes options.types to Cossack._onNavigate and does not push state itself', async () => {
    const onNavigateMock = vi.fn().mockResolvedValue(undefined);
    const originalOnNavigate = Cossack._onNavigate;
    Cossack._onNavigate = onNavigateMock;

    const historySpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});

    component.redirect('/new-page', { types: ['nav-forward'] });

    // redirect() delegates history.pushState to _onNavigate (the SPA entry);
    // it must NOT push state itself (would double up history entries).
    expect(historySpy).not.toHaveBeenCalled();
    expect(onNavigateMock).toHaveBeenCalledTimes(1);
    expect(onNavigateMock.mock.calls[0][0]).toBe('/new-page');
    // Second argument should be options with types
    const passedOptions = onNavigateMock.mock.calls[0][1];
    expect(passedOptions).toEqual({ types: ['nav-forward'] });

    Cossack._onNavigate = originalOnNavigate;
  });

  it('passes undefined options when no types provided', async () => {
    const onNavigateMock = vi.fn().mockResolvedValue(undefined);
    const originalOnNavigate = Cossack._onNavigate;
    Cossack._onNavigate = onNavigateMock;

    vi.spyOn(window.history, 'pushState').mockImplementation(() => {});

    component.redirect('/another-page');

    expect(onNavigateMock).toHaveBeenCalledTimes(1);
    const passedOptions = onNavigateMock.mock.calls[0][1];
    expect(passedOptions).toBeUndefined();

    Cossack._onNavigate = originalOnNavigate;
  });

  it('passes options.scroll to Cossack._onNavigate', () => {
    const onNavigateMock = vi.fn().mockResolvedValue(undefined);
    const originalOnNavigate = Cossack._onNavigate;
    Cossack._onNavigate = onNavigateMock;

    component.redirect('/preserved-page', { scroll: 'preserve' });

    expect(onNavigateMock).toHaveBeenCalledWith('/preserved-page', { scroll: 'preserve' });

    Cossack._onNavigate = originalOnNavigate;
  });
});
