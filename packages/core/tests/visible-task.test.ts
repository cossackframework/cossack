// tests/visible-task.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock environment to be client-side
vi.mock('../src/shared/environment', () => ({
  isServer: false,
}));

import { Cossack } from '../src/shared/cossack';
import { VisibleTask } from '../src/shared/decorators';
import type { TemplateResult } from '@cossackframework/renderer';

vi.mock('@cossackframework/renderer', () => {
    const render = vi.fn();
    const renderToString = vi.fn();
    const createContext = <T>(defaultValue: T) => ({ defaultValue, _id: Math.random().toString() });
    class CossackElement {
        render() { return null; }
        requestUpdate() {}
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

// Captured IntersectionObserver callbacks so tests can fire them manually.
let observerCallbacks: Array<(entries: any[]) => void> = [];
let observerInstances: Array<{
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
}> = [];

class MockIntersectionObserver {
    cb: (entries: any[]) => void;
    opts: any;
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(cb: (entries: any[]) => void, opts?: any) {
        this.cb = cb;
        this.opts = opts;
        observerCallbacks.push(cb);
        observerInstances.push(this);
    }
}

/**
 * Component with a single-element @VisibleTask. The callback records the
 * element and entry it receives.
 */
class SingleTargetComponent extends Cossack<{}> {
    public receivedTarget: any = null;
    public receivedEntry: any = null;
    public callCount = 0;

    @VisibleTask({ threshold: 0 })
    onVisible(target: Element | null, entry: IntersectionObserverEntry | null) {
        this.receivedTarget = target;
        this.receivedEntry = entry;
        this.callCount++;
    }

    render(): TemplateResult {
        return { strings: [], values: [], getHTML: () => '' } as unknown as TemplateResult;
    }
}

/**
 * Component with a selector-based @VisibleTask that matches multiple elements.
 */
class MultiMatchComponent extends Cossack<{}> {
    public hitElements: Element[] = [];

    @VisibleTask({ selector: '.reveal' })
    onReveal(target: Element | null) {
        if (target) this.hitElements.push(target);
    }

    render(): TemplateResult {
        return { strings: [], values: [], getHTML: () => '' } as unknown as TemplateResult;
    }
}

describe('@VisibleTask callback arguments', () => {
    let component: SingleTargetComponent;
    let container: any;

    beforeEach(() => {
        vi.clearAllMocks();
        observerCallbacks = [];
        observerInstances = [];
        (global as any).IntersectionObserver = MockIntersectionObserver;

        container = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelectorAll: vi.fn(() => []),
            querySelector: vi.fn(() => null),
        };

        global.document = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            head: { querySelectorAll: vi.fn(() => []), appendChild: vi.fn() },
            createElement: vi.fn(() => ({ setAttribute: vi.fn() })),
        } as any;

        global.window = {
            __INITIAL_STATE__: {},
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { host: 'localhost' },
        } as any;

        component = new SingleTargetComponent();
    });

    afterEach(() => {
        delete (global as any).IntersectionObserver;
        // @ts-ignore
        delete global.document;
        // @ts-ignore
        delete global.window;
    });

    it('passes the intersecting element as first arg and entry as second', async () => {
        await component.bootstrap({ container: container as any });

        // The observer was created and the container was observed.
        expect(observerInstances.length).toBe(1);
        expect(observerInstances[0].observe).toHaveBeenCalledTimes(1);
        const observedTarget = observerInstances[0].observe.mock.calls[0][0];

        // Fire intersection.
        const fakeEntry = { isIntersecting: true, target: observedTarget, intersectionRatio: 1 };
        observerCallbacks[0]([fakeEntry]);

        expect(component.callCount).toBe(1);
        expect(component.receivedTarget).toBe(observedTarget);
        expect(component.receivedEntry).toBe(fakeEntry);
    });

    it('fires once per element (unobserves after intersecting)', async () => {
        await component.bootstrap({ container: container as any });

        const observedTarget = observerInstances[0].observe.mock.calls[0][0];
        const fakeEntry = { isIntersecting: true, target: observedTarget, intersectionRatio: 1 };

        observerCallbacks[0]([fakeEntry]);
        expect(component.callCount).toBe(1);

        // The production code must call unobserve so the real IntersectionObserver
        // stops delivering callbacks for this element. (Our mock doesn't enforce
        // this internally, so we assert the call directly.)
        expect(observerInstances[0].unobserve).toHaveBeenCalledWith(observedTarget);
    });
});

describe('@VisibleTask with selector matching multiple elements', () => {
    let component: MultiMatchComponent;
    let container: any;

    beforeEach(() => {
        vi.clearAllMocks();
        observerCallbacks = [];
        observerInstances = [];
        (global as any).IntersectionObserver = MockIntersectionObserver;

        const el1 = { tag: 'el1' } as any;
        const el2 = { tag: 'el2' } as any;
        const el3 = { tag: 'el3' } as any;

        container = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelectorAll: vi.fn(() => [el1, el2, el3]),
            querySelector: vi.fn(() => el1),
        };

        global.document = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            head: { querySelectorAll: vi.fn(() => []), appendChild: vi.fn() },
            createElement: vi.fn(() => ({ setAttribute: vi.fn() })),
        } as any;

        global.window = {
            __INITIAL_STATE__: {},
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { host: 'localhost' },
        } as any;

        component = new MultiMatchComponent();
        // Stash the elements so the test can reference them.
        (component as any)._testEls = [el1, el2, el3];
    });

    afterEach(() => {
        delete (global as any).IntersectionObserver;
        // @ts-ignore
        delete global.document;
        // @ts-ignore
        delete global.window;
    });

    it('observes every matched element and fires independently for each', async () => {
        const els: any[] = (component as any)._testEls;
        await component.bootstrap({ container: container as any });

        // One observer, three observed elements.
        expect(observerInstances.length).toBe(1);
        expect(observerInstances[0].observe).toHaveBeenCalledTimes(3);

        // Fire each element independently.
        observerCallbacks[0]([{ isIntersecting: true, target: els[0], intersectionRatio: 1 }]);
        observerCallbacks[0]([{ isIntersecting: true, target: els[1], intersectionRatio: 1 }]);
        observerCallbacks[0]([{ isIntersecting: true, target: els[2], intersectionRatio: 1 }]);

        expect(component.hitElements).toEqual([els[0], els[1], els[2]]);

        // Each element was unobserved after firing.
        expect(observerInstances[0].unobserve).toHaveBeenCalledTimes(3);
    });
});
