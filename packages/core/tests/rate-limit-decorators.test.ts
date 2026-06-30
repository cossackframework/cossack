// tests/rate-limit-decorators.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock environment to be client-side
vi.mock('../src/shared/environment', () => ({
  isServer: false,
}));

import { Cossack } from '../src/shared/cossack';
import { Debounce, Throttle } from '../src/shared/decorators';
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

class RateLimitComponent extends Cossack<{}> {
    public debounceCalls: any[][] = [];
    public throttleCalls: any[][] = [];

    @Debounce(500)
    debouncedSearch(query: string) {
        this.debounceCalls.push([query]);
    }

    @Throttle(200)
    throttledScroll(pos: number) {
        this.throttleCalls.push([pos]);
    }

    render(): TemplateResult {
        return { strings: [], values: [], getHTML: () => '' } as unknown as TemplateResult;
    }
}

describe('@Debounce / @Throttle runtime behavior', () => {
    let component: RateLimitComponent;
    let container: any;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        container = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
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

        component = new RateLimitComponent();
    });

    afterEach(() => {
        // @ts-ignore
        delete global.document;
        // @ts-ignore
        delete global.window;
        vi.useRealTimers();
    });

    it('coalesces rapid calls into a single trailing invocation with the latest args', async () => {
        await component.bootstrap({ container: container as any });

        component.debouncedSearch('a');
        component.debouncedSearch('b');
        component.debouncedSearch('c');

        // Not yet — within the debounce window.
        expect(component.debounceCalls).toEqual([]);

        vi.advanceTimersByTime(499);
        expect(component.debounceCalls).toEqual([]);

        vi.advanceTimersByTime(1); // total 500ms elapsed
        expect(component.debounceCalls).toEqual([['c']]);
    });

    it('resets the timer on every call', async () => {
        await component.bootstrap({ container: container as any });

        component.debouncedSearch('first');
        vi.advanceTimersByTime(400);

        component.debouncedSearch('second'); // resets the 500ms window
        vi.advanceTimersByTime(400);
        expect(component.debounceCalls).toEqual([]);

        vi.advanceTimersByTime(100); // 400 + 100 = 500 since last call
        expect(component.debounceCalls).toEqual([['second']]);
    });

    it('throttle runs the first call immediately and ignores the rest within the window', async () => {
        await component.bootstrap({ container: container as any });

        component.throttledScroll(1);
        expect(component.throttleCalls).toEqual([[1]]);

        component.throttledScroll(2);
        component.throttledScroll(3);
        expect(component.throttleCalls).toEqual([[1]]); // ignored

        vi.advanceTimersByTime(201); // window elapses
        component.throttledScroll(4);
        expect(component.throttleCalls).toEqual([[1], [4]]);
    });

    it('keeps per-instance timers independent', async () => {
        const a = new RateLimitComponent();
        const b = new RateLimitComponent();
        await a.bootstrap({ container: container as any });
        await b.bootstrap({ container: container as any });

        a.debouncedSearch('a');
        b.debouncedSearch('b');

        vi.advanceTimersByTime(500);

        expect(a.debounceCalls).toEqual([['a']]);
        expect(b.debounceCalls).toEqual([['b']]);
    });

    it('returns void (deferred execution loses the return value)', async () => {
        await component.bootstrap({ container: container as any });
        const result = component.debouncedSearch('x');
        expect(result).toBeUndefined();
    });
});
