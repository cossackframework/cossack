// tests/lifecycle.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock environment to be client-side
vi.mock('../src/shared/environment', () => ({
  isServer: false,
}));

import { Cossack } from '../src/shared/cossack';
import { Task, VisibleTask } from '../src/shared/decorators';
import * as renderer from '@cossackframework/renderer';
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

class LifecycleComponent extends Cossack<{}> {
    public taskRunCount = 0;
    public visibleTaskRunCount = 0;
    public renderCount = 0;

    @Task()
    runTask() {
        this.taskRunCount++;
    }

    @VisibleTask({ strategy: 'intersection-observer', threshold: 0.5 })
    runVisible() {
        this.visibleTaskRunCount++;
        return () => {
            // cleanup
        };
    }

    render(): TemplateResult {
        this.renderCount++;
        const strings = [`Rendered`];
        return {
            strings,
            values: [],
            getHTML: () => strings.join(''),
        } as unknown as TemplateResult;
    }
}

describe('Lifecycle Hooks', () => {
    let component: LifecycleComponent;
    let observerMock: any;
    let observerCallback: IntersectionObserverCallback;

    beforeEach(() => {
        vi.clearAllMocks();
        global.window = {
            __INITIAL_STATE__: {},
            location: { host: 'localhost' },
        } as any;
        global.document = {
            head: {
                querySelectorAll: vi.fn(() => []),
                appendChild: vi.fn(),
            },
            createElement: vi.fn(() => ({
                setAttribute: vi.fn(),
            })),
        } as any;

        observerMock = {
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        };

        global.IntersectionObserver = vi.fn(function (cb) {
            observerCallback = cb;
            return observerMock;
        }) as any;

        component = new LifecycleComponent();
    });

    afterEach(() => {
        // @ts-ignore
        delete global.window;
        // @ts-ignore
        delete global.document;
        // @ts-ignore
        delete global.IntersectionObserver;
    });

    describe('@Task', () => {
        it('should execute tasks during bootstrap', async () => {
            await component.bootstrap();
            expect(component.taskRunCount).toBe(1);
        });

        it('should execute tasks during render', async () => {
            await component.bootstrap(); // runs once
            component.taskRunCount = 0;
            
            // Calling _render directly simulates a re-render
            component._render();
            expect(component.taskRunCount).toBe(1);
        });
    });

    describe('@VisibleTask', () => {
        it('should setup intersection observer on mount', async () => {
            const container = { innerHTML: '' };
            await component.bootstrap({ container: container as any });
            
            expect(global.IntersectionObserver).toHaveBeenCalled();
            expect(observerMock.observe).toHaveBeenCalledWith(container);
        });

        it('should setup intersection observer with selector', async () => {
            const mockElement = { id: 'target' };
            const container = {
                innerHTML: '',
                querySelectorAll: vi.fn().mockReturnValue([mockElement])
            };

            class SelectorComponent extends Cossack {
                @VisibleTask({ selector: '.my-target' })
                run() {}
            }
            const selComponent = new SelectorComponent();

            await selComponent.bootstrap({ container: container as any });

            expect(container.querySelectorAll).toHaveBeenCalledWith('.my-target');
            expect(global.IntersectionObserver).toHaveBeenCalled();
            expect(observerMock.observe).toHaveBeenCalledWith(mockElement);
        });

        it('should execute visible task when intersecting', async () => {
            const container = { innerHTML: '' };
            await component.bootstrap({ container: container as any });
            
            // Simulate intersection
            const entry: IntersectionObserverEntry = {
                isIntersecting: true,
                target: container as any,
                // other props
                boundingClientRect: {} as any,
                intersectionRatio: 1,
                intersectionRect: {} as any,
                rootBounds: null,
                time: 0,
            };

            observerCallback([entry], observerMock);

            expect(component.visibleTaskRunCount).toBe(1);
            // The new implementation unobserves the element after firing (so
            // selector-matched siblings can fire independently), rather than
            // disconnecting the whole observer.
            expect(observerMock.unobserve).toHaveBeenCalledWith(container);
        });

        it('should NOT execute visible task when NOT intersecting', async () => {
            const container = { innerHTML: '' };
            await component.bootstrap({ container: container as any });
            
            const entry: IntersectionObserverEntry = {
                isIntersecting: false,
                target: container as any,
                boundingClientRect: {} as any,
                intersectionRatio: 0,
                intersectionRect: {} as any,
                rootBounds: null,
                time: 0,
            };

            observerCallback([entry], observerMock);

            expect(component.visibleTaskRunCount).toBe(0);
            expect(observerMock.disconnect).not.toHaveBeenCalled();
            expect(observerMock.unobserve).not.toHaveBeenCalled();
        });
    });
});
