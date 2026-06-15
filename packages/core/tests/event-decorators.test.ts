// tests/event-decorators.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock environment to be client-side
vi.mock('../src/shared/environment', () => ({
  isServer: false,
}));

import { Cossack } from '../src/shared/cossack';
import { On, OnDocument, OnWindow } from '../src/shared/decorators';
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

class EventComponent extends Cossack<{}> {
    public domClickCount = 0;
    public docKeyCount = 0;
    public windowResizeCount = 0;

    @On('click')
    handleClick() {
        this.domClickCount++;
    }

    @OnDocument('keydown')
    handleKeydown() {
        this.docKeyCount++;
    }

    @OnWindow('resize')
    handleResize() {
        this.windowResizeCount++;
    }

    render(): TemplateResult {
        return { strings: [], values: [], getHTML: () => '' } as unknown as TemplateResult;
    }
}

class LifecycleEventComponent extends Cossack<{}> {
    public mountCalls: string[] = [];
    public navigateCalls: string[] = [];
    public domClickCount = 0;

    @On('mount')
    firstMount() {
        this.mountCalls.push('first');
    }

    @On('mount')
    secondMount() {
        this.mountCalls.push('second');
    }

    @On('navigate-complete')
    onNavigate(pathname: string) {
        this.navigateCalls.push(pathname);
    }

    @On('click')
    handleClick() {
        this.domClickCount++;
    }

    render(): TemplateResult {
        return { strings: [], values: [], getHTML: () => '' } as unknown as TemplateResult;
    }
}

describe('Event Decorators', () => {
    let component: EventComponent;
    let container: any;
    let domListeners: Record<string, Function> = {};
    let docListeners: Record<string, Function> = {};
    let windowListeners: Record<string, Function> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        domListeners = {};
        docListeners = {};
        windowListeners = {};

        // Mock container
        container = {
            addEventListener: vi.fn((event, handler) => {
                domListeners[event] = handler;
            }),
            removeEventListener: vi.fn((event, handler) => {
                delete domListeners[event];
            }),
        };

        // Mock document
        global.document = {
            addEventListener: vi.fn((event, handler) => {
                docListeners[event] = handler;
            }),
            removeEventListener: vi.fn((event, handler) => {
                delete docListeners[event];
            }),
            head: { querySelectorAll: vi.fn(() => []), appendChild: vi.fn() },
            createElement: vi.fn(() => ({ setAttribute: vi.fn() })),
        } as any;

        // Mock window
        global.window = {
            __INITIAL_STATE__: {},
            addEventListener: vi.fn((event, handler) => {
                windowListeners[event] = handler;
            }),
            removeEventListener: vi.fn((event, handler) => {
                delete windowListeners[event];
            }),
            location: { host: 'localhost' },
        } as any;

        component = new EventComponent();
    });

    afterEach(() => {
        // @ts-ignore
        delete global.document;
        // @ts-ignore
        delete global.window;
    });

    it('should attach @On listener to component container', async () => {
        await component.bootstrap({ container: container as any });
        
        expect(container.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        
        // Trigger event
        domListeners['click']();
        expect(component.domClickCount).toBe(1);
    });

    it('should attach @OnDocument listener to document', async () => {
        await component.bootstrap({ container: container as any });
        
        expect(global.document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        
        // Trigger event
        docListeners['keydown']();
        expect(component.docKeyCount).toBe(1);
    });

    it('should attach @OnWindow listener to window', async () => {
        await component.bootstrap({ container: container as any });
        
        expect(global.window.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        
        // Trigger event
        windowListeners['resize']();
        expect(component.windowResizeCount).toBe(1);
    });

    it('should remove listeners on destroy', async () => {
        await component.bootstrap({ container: container as any });

        component.destroy();

        expect(container.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        expect(global.document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        expect(global.window.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});

describe('Lifecycle Event Decorators (@On mount / navigate-complete)', () => {
    let component: LifecycleEventComponent;
    let container: any;
    let domListeners: Record<string, Function> = {};

    beforeEach(() => {
        vi.clearAllMocks();
        domListeners = {};

        container = {
            addEventListener: vi.fn((event, handler) => {
                domListeners[event] = handler;
            }),
            removeEventListener: vi.fn((event, handler) => {
                delete domListeners[event];
            }),
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

        component = new LifecycleEventComponent();
    });

    afterEach(() => {
        // @ts-ignore
        delete global.document;
        // @ts-ignore
        delete global.window;
    });

    it('should fire all @On("mount") handlers during bootstrap', async () => {
        await component.bootstrap({ container: container as any });

        expect(component.mountCalls).toEqual(['first', 'second']);
    });

    it('should NOT attach @On("mount") handlers to the container as DOM listeners', async () => {
        await component.bootstrap({ container: container as any });

        expect(container.addEventListener).not.toHaveBeenCalledWith('mount', expect.any(Function));
    });

    it('should NOT attach @On("navigate-complete") handlers to the container', async () => {
        await component.bootstrap({ container: container as any });

        expect(container.addEventListener).not.toHaveBeenCalledWith('navigate-complete', expect.any(Function));
    });

    it('should fire @On("navigate-complete") handler with pathname when onNavigateComplete is called', async () => {
        await component.bootstrap({ container: container as any });

        component._frameworkNavigateComplete('/about');

        expect(component.navigateCalls).toEqual(['/about']);
    });

    it('should fire @On("navigate-complete") handler on every navigation', async () => {
        await component.bootstrap({ container: container as any });

        component._frameworkNavigateComplete('/about');
        component._frameworkNavigateComplete('/contact');

        expect(component.navigateCalls).toEqual(['/about', '/contact']);
    });

    it('should NOT register cleanup functions for lifecycle event handlers (no double-remove)', async () => {
        await component.bootstrap({ container: container as any });

        // Destroy should not throw, and lifecycle handlers are not tracked in
        // eventCleanupFns (they aren't real DOM listeners).
        expect(() => component.destroy()).not.toThrow();
        expect(container.removeEventListener).not.toHaveBeenCalledWith('mount', expect.any(Function));
        expect(container.removeEventListener).not.toHaveBeenCalledWith('navigate-complete', expect.any(Function));
    });

    it('should still attach regular @On("click") alongside lifecycle events', async () => {
        await component.bootstrap({ container: container as any });

        expect(container.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));

        domListeners['click']();
        expect(component.domClickCount).toBe(1);
    });
});
