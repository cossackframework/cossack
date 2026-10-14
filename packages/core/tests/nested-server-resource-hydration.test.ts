// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, html } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';

const settle = async (turns = 20) => {
    for (let i = 0; i < turns; i++) await Promise.resolve();
};

afterEach(() => { vi.restoreAllMocks(); });

describe('nested component server$ hydration', () => {
    it('seeds a component() child from its serialized serverResources instead of refetching', async () => {
        const loader = vi.fn(async () => 99);
        class Child extends Cossack {
            get item() { return this.__serverResource('item', loader, { initial: 0 }); }
            render() { return html`<span>${this.item}</span>`; }
        }
        class Page extends Cossack {
            protected override isServer = false;
            render() { return html`<div>${component(Child, {})}</div>`; }
        }

        const container = document.createElement('div');
        const page = new Page();
        await page.bootstrap({
            container,
            initialState: {
                public: {}, private: {}, metadata: {},
                children: {
                    'root:0': { public: {}, private: {}, serverResources: { item: { argsKey: '[]', value: 42 } } },
                },
            } as any,
        });
        await settle();

        expect(container.querySelector('span')!.textContent).toBe('42');
        expect(loader).not.toHaveBeenCalled();
        await page.destroy();
    });

    it('round-trips a nested resource from SSR state to the client', async () => {
        const loader = vi.fn(async () => 7);
        class Child extends Cossack {
            get item() { return this.__serverResource('item', loader, { initial: 0 }); }
            render() { return html`<span>${this.item}</span>`; }
        }
        // Simulate the server side: the child resolved its resource during SSR.
        const serverChild = new Child();
        serverChild._id = 'root:0';
        void serverChild.item;
        await Promise.all(serverChild.__serverResourcePending());
        const childState = serverChild.getInitialState();
        expect(childState.serverResources).toEqual({ item: { argsKey: '[]', value: 7 } });
        loader.mockClear();

        class Page extends Cossack {
            protected override isServer = false;
            render() { return html`<div>${component(Child, {})}</div>`; }
        }
        const container = document.createElement('div');
        const page = new Page();
        await page.bootstrap({
            container,
            initialState: { public: {}, private: {}, metadata: {}, children: { 'root:0': childState } } as any,
        });
        await settle();
        expect(container.querySelector('span')!.textContent).toBe('7');
        expect(loader).not.toHaveBeenCalled();
        await page.destroy();
    });
});
