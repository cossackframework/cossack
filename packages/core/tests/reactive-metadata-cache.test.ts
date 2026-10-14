// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'hono';
import { html } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { ClientState, ClientTask, Server, ServerTask, State, Store, Task } from '../src/shared/decorators';
import { collectReactiveMetadata, collectTaskRegistrations } from '../src/shared/reactive-metadata';

afterEach(() => { vi.restoreAllMocks(); });

const settle = async (turns = 20) => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

/**
 * Counts how often each metadata key is read from `target` itself. Install it
 * after the class is defined: decorators read their own key while declaring.
 */
function watchOwnMetadataReads() {
    const read = vi.spyOn(Reflect, 'getOwnMetadata');
    return (key: string, target: Function) => read.mock.calls.filter(([k, t]) => k === key && t === target).length;
}

/** Field names declared below Cossack itself. */
const ownKeys = (constructor: Function) => {
    const inherited = new Set(collectReactiveMetadata(Cossack).keys);
    return collectReactiveMetadata(constructor).keys.filter(key => !inherited.has(key));
};
const taskKeys = (constructor: Function, isServer: boolean) =>
    collectTaskRegistrations(constructor, isServer).map(task => task.propertyKey);

describe('per-class reactive and task metadata', () => {
    it('collects reactive fields and tasks once per class across client re-renders and instances', async () => {
        const runs: string[] = [];
        class Widget extends Cossack {
            protected override isServer = false;
            @State() count = 0;
            @Store() list = { items: [1] };
            @ClientState() open = false;
            @Server() async save() {}
            @Task() everywhere() { runs.push('task'); }
            @ServerTask() serverOnly() { runs.push('server'); }
            @ClientTask() clientOnly() { runs.push('client'); }
            render() { return html`<p>${this.count}</p>`; }
        }
        const reads = watchOwnMetadataReads();
        const pages: Widget[] = [];
        for (let instance = 0; instance < 3; instance++) {
            const container = document.createElement('div');
            const page = new Widget();
            await page.bootstrap({ container, initialState: { public: {}, metadata: {} } });
            for (let render = 1; render <= 5; render++) {
                page.count = render;
                await page.requestUpdate();
            }
            expect(container.textContent).toBe('5');
            pages.push(page);
        }
        await settle();

        for (const key of ['cossack:state', 'cossack:store', 'cossack:client-state', 'cossack:client-store']) {
            expect(reads(key, Widget), key).toBe(1);
        }
        for (const key of ['cossack:tasks', 'cossack:server-tasks', 'cossack:client-tasks']) {
            expect(reads(key, Widget), key).toBe(1);
        }
        // Tasks still run on every render; the browser never runs @ServerTask.
        expect(runs).not.toContain('server');
        expect(runs.filter(run => run === 'client').length).toBeGreaterThanOrEqual(3 * 6);
        // Shared class metadata, separate instance state.
        pages[0]!.count = 42;
        expect(pages.map(page => page.count)).toEqual([42, 5, 5]);
        for (const page of pages) await page.destroyAsync();
    });

    it('collects once across server requests that each create a new instance', async () => {
        const runs: string[] = [];
        class Report extends Cossack {
            protected override isServer = true;
            @State() title = 'report';
            @ServerTask() load() { runs.push('server'); }
            @ClientTask() browser() { runs.push('client'); }
            render() { return html`<h1>${this.title}</h1>`; }
        }
        const reads = watchOwnMetadataReads();
        for (let request = 0; request < 4; request++) {
            const page = new Report();
            await page.bootstrap({ context: new Context(new Request('http://localhost/report')) as any, skipInit: true });
            expect(page.getPublicState()).toEqual({ title: 'report' });
            await page.destroyAsync();
        }
        expect(reads('cossack:state', Report)).toBe(1);
        expect(reads('cossack:server-tasks', Report)).toBe(1);
        expect(runs).toEqual(['server', 'server', 'server', 'server']);
    });

    it('keeps a subclass entry separate from its parent in either collection order', () => {
        class Parent extends Cossack {
            @State() shared = 1;
            @State() mode = 'parent';
            @Task() parentTask() {}
            @ServerTask() replaced() {}
        }
        class Child extends Parent {
            @State() own = 2;
            @ClientState() override mode = 'child';
            @ClientTask() override replaced() {}
        }

        const parent = collectReactiveMetadata(Parent);
        expect(ownKeys(Parent)).toEqual(['shared', 'mode']);
        const child = collectReactiveMetadata(Child);
        expect(child).not.toBe(parent);
        expect(ownKeys(Child)).toEqual(['shared', 'own', 'mode']);
        expect(child.clientState.has('mode')).toBe(true);
        expect(collectReactiveMetadata(Parent)).toBe(parent);
        expect(parent.clientState.has('mode')).toBe(false);
        expect(parent.state.mode).toBeDefined();

        expect(taskKeys(Parent, true)).toEqual(['parentTask', 'replaced']);
        expect(taskKeys(Child, true)).toEqual(['parentTask']);
        expect(taskKeys(Child, false)).toEqual(['parentTask', 'replaced']);
        expect(taskKeys(Parent, false)).toEqual(['parentTask']);

        // Collecting a subclass first must not seed its parent's entry.
        class Base extends Cossack { @State() base = 0; @Task() baseTask() {} }
        class Leaf extends Base { @Store() extra = {}; @ClientTask() leaf() {} }
        expect(ownKeys(Leaf)).toEqual(['base', 'extra']);
        expect(taskKeys(Leaf, false)).toEqual(['baseTask', 'leaf']);
        expect(ownKeys(Base)).toEqual(['base']);
        expect(taskKeys(Base, false)).toEqual(['baseTask']);
    });

    it('hydrates only the fields an instance class declares', async () => {
        class Base extends Cossack { protected override isServer = false; @State() a = 1; }
        class Derived extends Base { @State() b = 2; }
        const derived = new Derived();
        await derived.bootstrap({ container: document.createElement('div'), initialState: { public: { a: 10, b: 20 }, metadata: {} } });
        const base = new Base();
        await base.bootstrap({ container: document.createElement('div'), initialState: { public: { a: 30, b: 40 }, metadata: {} } });
        expect(derived.getPublicState()).toEqual({ a: 10, b: 20 });
        expect(base.getPublicState()).toEqual({ a: 30 });
        await derived.destroyAsync();
        await base.destroyAsync();
    });

    it('shares frozen metadata that callers cannot corrupt', () => {
        class Frozen extends Cossack { @State() value = 0; @Task() run() {} }
        const metadata = collectReactiveMetadata(Frozen);
        expect(Object.isFrozen(metadata)).toBe(true);
        expect(Object.isFrozen(metadata.state)).toBe(true);
        expect(Object.isFrozen(metadata.keys)).toBe(true);
        expect(Object.isFrozen(collectTaskRegistrations(Frozen, true))).toBe(true);
    });
});
