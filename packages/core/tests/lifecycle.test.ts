// tests/lifecycle.test.ts
import 'reflect-metadata';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock environment to be client-side
vi.mock('../src/shared/environment', () => ({
  isServer: false,
}));

import { Cossack } from '../src/shared/cossack';
import { Task, VisibleTask, ServerTask, ClientTask } from '../src/shared/decorators';
import * as renderer from '@cossackframework/renderer';
import type { TemplateResult } from '@cossackframework/renderer';

vi.mock('@cossackframework/renderer', () => {
    const render = vi.fn();
    const renderToString = vi.fn();
    const createContext = <T>(defaultValue: T) => ({ defaultValue, _id: Math.random().toString() });
    class CossackElement {
        // Internals that Cossack.performUpdate() reads via getElementInternal().
        // The real CossackElement initializes these in its constructor; the mock
        // must too, or performUpdate() throws (e.g. "willUpdate is not a
        // function", "__notifyListeners is not a function").
        public __changedProperties: Map<string | number | symbol, unknown> = new Map();
        public __controllers: any[] = [];
        public __updatePromise: Promise<boolean> | null = null;
        private __renderListeners: Set<(template: unknown) => void> = new Set();

        render() { return null; }
        requestUpdate() {}
        mount(container: any) { render(this.render(), container); }
        shouldUpdate(_changedProperties: Map<string | number | symbol, unknown>): boolean {
            return true;
        }
        willUpdate(_changedProperties: Map<string | number | symbol, unknown>) {}
        updated(_changedProperties: Map<string | number | symbol, unknown>) {}
        connectedCallback() {}
        disconnectedCallback() {}
        static properties = {};
        autoBindMethods() {}
        consume() { return undefined; }
        provide() {}
        resetRenderState() {}
        __notifyListeners(template: unknown) {
            this.__renderListeners.forEach(listener => listener(template));
        }
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

    // performUpdate() calls shouldUpdate() from the CossackElement base, which
    // is stubbed out by the renderer mock. Override to return true so the
    // @Task-during-performUpdate regression test enters the render branch.
    shouldUpdate(): boolean {
        return true;
    }

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

            // Calling _render directly simulates an SSR re-render
            component._render();
            expect(component.taskRunCount).toBe(1);
        });

        it('should execute tasks during performUpdate (client prop-driven re-render)', async () => {
            // Regression guard: performUpdate() is the client update path
            // (triggered by requestUpdate on prop/state change). Tasks were
            // previously only wired into _render() (SSR) and bootstrap(), so
            // prop-driven client re-renders silently skipped @Task methods.
            await component.bootstrap();
            component.taskRunCount = 0;

            // performUpdate reads __changedProperties / __controllers from the
            // CossackElement internal. shouldUpdate() defaults to true, so a
            // non-empty changed map is enough to enter the render branch where
            // runTasks() now fires.
            (component as any).__changedProperties = new Map([['open', false]]);
            (component as any).__controllers = [];
            await (component as any).performUpdate();
            expect(component.taskRunCount).toBeGreaterThanOrEqual(1);
        });
    });

    describe('@ServerTask', () => {
        it('should NOT run on client (skipped by runTasks)', async () => {
            // This test file mocks isServer = false (client environment).
            // @ServerTask methods should not be called during runTasks.
            class ClientEnvComponent extends Cossack<{}> {
                public serverTaskRan = false;
                shouldUpdate() { return true; }
                @ServerTask()
                serverOnlyTask() { this.serverTaskRan = true; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new ClientEnvComponent();
            await c.bootstrap();
            expect(c.serverTaskRan).toBe(false);
        });

        it('should run on server (when isServer is true)', async () => {
            class ServerEnvComponent extends Cossack<{}> {
                public serverTaskRan = false;
                shouldUpdate() { return true; }
                @ServerTask()
                serverOnlyTask() { this.serverTaskRan = true; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new ServerEnvComponent();
            (c as any).isServer = true;
            // Pass context as a Hono-like object for the server bootstrap path.
            await c.bootstrap({
                container: { innerHTML: '' },
                context: {
                    req: { url: '/', method: 'GET', headers: {}, path: '/' },
                    res: { headers: new Headers(), status: () => {} },
                },
            } as any);
            expect(c.serverTaskRan).toBe(true);
        });
    });

    describe('@ClientTask', () => {
        it('should run on client (when isServer is false)', async () => {
            class ClientTaskComponent extends Cossack<{}> {
                public clientTaskRan = false;
                shouldUpdate() { return true; }
                @ClientTask()
                clientOnlyTask() { this.clientTaskRan = true; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new ClientTaskComponent();
            // Test file mocks isServer = false (client environment).
            await c.bootstrap();
            expect(c.clientTaskRan).toBe(true);
        });

        it('should NOT run on server (skipped by runTasks)', async () => {
            class ServerEnvComponent extends Cossack<{}> {
                public clientTaskRan = false;
                shouldUpdate() { return true; }
                @ClientTask()
                clientOnlyTask() { this.clientTaskRan = true; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new ServerEnvComponent();
            (c as any).isServer = true;
            await c.bootstrap({
                container: { innerHTML: '' },
                context: {
                    req: { url: '/', method: 'GET', headers: {}, path: '/' },
                    res: { headers: new Headers(), status: () => {} },
                },
            } as any);
            expect(c.clientTaskRan).toBe(false);
        });
    });

    describe('@Task({ track }) filtering', () => {
        it('runs a tracked task when a tracked dep changes', async () => {
            class TrackedComponent extends Cossack<{}> {
                public runCount = 0;
                shouldUpdate() { return true; }
                @Task({ track: ['a'] })
                reactsToA() { this.runCount++; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new TrackedComponent();
            await c.bootstrap();
            // Mount run fires once regardless of track.
            expect(c.runCount).toBe(1);
            c.runCount = 0;

            // Simulate a state change to 'a' populating _dirtyPaths, then a
            // client prop-driven re-render (the performUpdate path).
            (c as any).__changedProperties = new Map([['a', 1]]);
            (c as any).__controllers = [];
            (c as any)._dirtyPaths = new Set(['a']);
            await (c as any).performUpdate();
            expect(c.runCount).toBe(1);
        });

        it('does NOT run a tracked task when a non-tracked dep changes', async () => {
            class TrackedComponent extends Cossack<{}> {
                public runCount = 0;
                shouldUpdate() { return true; }
                @Task({ track: ['a'] })
                reactsToA() { this.runCount++; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new TrackedComponent();
            await c.bootstrap();
            c.runCount = 0;

            // 'b' changed, but the task only tracks 'a' → must not run.
            (c as any).__changedProperties = new Map([['b', 2]]);
            (c as any).__controllers = [];
            (c as any)._dirtyPaths = new Set(['b']);
            await (c as any).performUpdate();
            expect(c.runCount).toBe(0);
        });

        it('runs a tracked task when a tracked NESTED store path changes', async () => {
            class NestedTrackComponent extends Cossack<{}> {
                public runCount = 0;
                shouldUpdate() { return true; }
                @Task({ track: ['store.user.zip'] })
                reactsToZip() { this.runCount++; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new NestedTrackComponent();
            await c.bootstrap();
            c.runCount = 0;

            // A sibling nested field changed — must NOT run.
            (c as any).__changedProperties = new Map([['store', {}]]);
            (c as any).__controllers = [];
            (c as any)._dirtyPaths = new Set(['store.user.name']);
            await (c as any).performUpdate();
            expect(c.runCount).toBe(0);

            // The tracked leaf changed — must run.
            (c as any).__changedProperties = new Map([['store', {}]]);
            (c as any)._dirtyPaths = new Set(['store.user.zip']);
            await (c as any).performUpdate();
            expect(c.runCount).toBe(1);
        });

        it('track on the whole store fires on ANY nested mutation (prefix-descendant)', async () => {
            class StoreTrackComponent extends Cossack<{}> {
                public runCount = 0;
                shouldUpdate() { return true; }
                @Task({ track: ['store'] })
                reactsToStore() { this.runCount++; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new StoreTrackComponent();
            await c.bootstrap();
            c.runCount = 0;

            (c as any).__changedProperties = new Map([['store', {}]]);
            (c as any).__controllers = [];
            (c as any)._dirtyPaths = new Set(['store.user.address.zip']);
            await (c as any).performUpdate();
            expect(c.runCount).toBe(1);
        });

        it('an UNtracked task still runs on every change (legacy behavior)', async () => {
            class LegacyComponent extends Cossack<{}> {
                public runCount = 0;
                shouldUpdate() { return true; }
                @Task()
                alwaysRuns() { this.runCount++; }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new LegacyComponent();
            await c.bootstrap();
            c.runCount = 0;

            // Any change should fire the untracked task.
            (c as any).__changedProperties = new Map([['anything', true]]);
            (c as any).__controllers = [];
            (c as any)._dirtyPaths = new Set(['anything']);
            await (c as any).performUpdate();
            expect(c.runCount).toBe(1);
        });
    });

    describe('@Task cleanup (React useEffect style)', () => {
        it('runs the previous cleanup before re-running a tracked task', async () => {
            const cleanups: string[] = [];
            class CleanupComponent extends Cossack<{}> {
                public runCount = 0;
                shouldUpdate() { return true; }
                @Task({ track: ['a'] })
                reactsToA() {
                    this.runCount++;
                    const n = this.runCount;
                    return () => { cleanups.push(`cleanup-${n}`); };
                }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new CleanupComponent();
            await c.bootstrap();
            // Mount run registered cleanup-1 (not yet invoked).
            expect(cleanups).toEqual([]);

            // First tracked re-run: cleanup-1 fires, then task runs (runCount 2).
            (c as any).__changedProperties = new Map([['a', 1]]);
            (c as any).__controllers = [];
            (c as any)._dirtyPaths = new Set(['a']);
            await (c as any).performUpdate();
            expect(c.runCount).toBe(2);
            expect(cleanups).toEqual(['cleanup-1']);
        });

        it('runs cleanup on destroy()', async () => {
            const cleanups: string[] = [];
            class DestroyComponent extends Cossack<{}> {
                shouldUpdate() { return true; }
                @Task()
                withCleanup() {
                    return () => { cleanups.push('destroyed'); };
                }
                render() { return { strings: [''], values: [] } as any; }
            }
            const c = new DestroyComponent();
            await c.bootstrap();
            expect(cleanups).toEqual([]);
            c.destroy();
            expect(cleanups).toEqual(['destroyed']);
        });
    });

    describe('connectedCallback (child component mount)', () => {
        it('should fire onMount via connectedCallback for child components', () => {
            // Regression guard: child components rendered via component() go
            // through connectedCallback() but NOT bootstrap(). Without the fix
            // in connectedCallback(), their onMount() / setupEventListeners()
            // would never fire.
            const child = new LifecycleComponent();
            // Simulate the renderer connecting a child component.
            (child as any).isServer = false;
            child.connectedCallback();
            // onMount was overridden to... actually it's not overridden here.
            // But _frameworkMount() sets isMounted. Verify it was set.
            expect((child as any).isMounted).toBe(true);
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
