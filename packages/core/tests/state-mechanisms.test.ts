// @vitest-environment jsdom
import 'reflect-metadata';
import type { Context } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientState, ClientStore, Computed, Service, State, Store, Task } from '../src/shared/decorators';
import { sanitizeClientState } from '../src/shared/method-proxy';
import { getServiceState, hydrateServiceState, registerServiceState } from '../src/shared/service-bootstrap';
import { sanitizeServiceState } from '../src/shared/service-scope';
import { createStore, connectStore } from '../src/shared/reactive-store';

afterEach(() => { vi.restoreAllMocks(); });
class CossackSubclass extends Cossack {}

describe('component state mechanisms', () => {
    it.each([true, false])('initializes local state quietly during bootstrap (server: %s)', async (server) => {
        class QuietState extends Cossack {
            protected override isServer = server;
            @State() input = 1;
            @ClientState() count = 0;
            @ClientStore() draft = { count: 0 };
            @Task({ track: ['input'] })
            seed() { this.count = 2; this.draft.count = 3; }
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = new QuietState();
        const update = vi.spyOn(page, 'requestUpdate').mockImplementation(() => Promise.resolve(true));
        await page.bootstrap({ context: { req: { param: () => ({}) } } as unknown as Context });
        expect(page.count).toBe(2);
        expect(page.draft.count).toBe(3);
        expect(update).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        page.count = 4;
        page.draft.count = 5;
        if (!server) expect(update.mock.calls.map(([key]) => key)).toEqual(['count', 'draft']);
        else expect(update).not.toHaveBeenCalled();
        await page.destroy();
    });

    it('notifies for replacement/deep stores and computes fresh values without serializing derived state', () => {
        class Choices extends Cossack {
            @State() shallow = { count: 1, rows: [1] };
            @Store() deep = { nested: { count: 1 }, rows: [1] };
            @ClientState() local = 1;
            @ClientStore() draft = { rows: [1] };
            @Computed() get total() { return this.shallow.count + this.deep.nested.count + this.deep.rows.length + this.local + this.draft.rows.length; }
        }
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = new Choices();
        page.connectedCallback();
        const update = vi.spyOn(page, 'requestUpdate').mockImplementation(() => Promise.resolve(true));
        expect(page.total).toBe(5);
        page.shallow.count++;
        page.shallow.rows.push(2);
        expect(update).not.toHaveBeenCalled();
        page.shallow = { count: 3, rows: [1, 2] };
        expect(update).toHaveBeenCalledTimes(1);
        page.deep.nested.count = 4;
        page.deep.rows.push(2);
        page.local = 5;
        page.draft.rows.splice(0, 1, 2, 3);
        expect(update.mock.calls.map(([key]) => key)).toEqual(['shallow', 'deep', 'deep', 'local', 'draft', 'draft']);
        expect(page.total).toBe(16);
        const initial = page.getInitialState();
        expect(Object.keys(initial.public)).toEqual(['shallow', 'deep']);
        expect(initial.public).not.toHaveProperty('total');
        expect(initial.public).not.toHaveProperty('local');
        expect(initial.public).not.toHaveProperty('draft');
        expect(warn).toHaveBeenCalledOnce();
    });

    it('retains inherited fields and honors child public/client and shallow/deep replacements', () => {
        class Parent extends Cossack {
            @State() inherited = 1;
            @State() changed = { count: 1 };
            @State() hidden = 'parent-public';
            @ClientState() promoted = 'parent-local';
        }
        class Child extends Parent {
            @State() added = 2;
            @Store() override changed = { count: 3 };
            @ClientState() override hidden = 'child-local';
            @State() override promoted = 'child-public';
        }
        const page = new Child();
        page.connectedCallback();
        const update = vi.spyOn(page, 'requestUpdate').mockImplementation(() => Promise.resolve(true));
        expect(page.getPublicState()).toEqual({ inherited: 1, changed: { count: 3 }, promoted: 'child-public', added: 2 });
        page.inherited = 4;
        page.changed.count = 5;
        expect(update.mock.calls.map(([key]) => key)).toEqual(['inherited', 'changed']);
        expect(sanitizeClientState(Child, { inherited: 6, changed: { count: 7 }, hidden: 'forged', promoted: 'public' }))
            .toEqual({ inherited: 6, changed: { count: 7 }, promoted: 'public' });
        expect(page.getInitialState().public).not.toHaveProperty('hidden');
    });

    it('uses the same inherited public contract for service snapshots and request overlays', () => {
        @Service()
        class Parent {
            @State() inherited = 1;
            @State() hidden = 'parent';
        }
        @Service()
        class Child extends Parent {
            @Store() nested = { count: 2 };
            @ClientState() override hidden = 'child';
        }
        const service = new Child();
        expect(getServiceState(service)).toEqual({ inherited: 1, nested: { count: 2 } });
        const incoming = { inherited: 3, nested: { count: 4 }, hidden: 'forged' };
        expect(sanitizeServiceState(Child, incoming)).toEqual({ inherited: 3, nested: { count: 4 } });
        hydrateServiceState(service, incoming);
        expect(service.inherited).toBe(3);
        expect(service.hidden).toBe('child');
        const consumer = new CossackSubclass();
        consumer.connectedCallback();
        registerServiceState(consumer, service);
        expect(consumer.getPublicState()).toEqual({ inherited: 3, nested: { count: 4 } });
        expect(consumer.getPublicState()).not.toHaveProperty('hidden');
    });

    it('external stores publish replacement values and stop notifying after disconnection', () => {
        class Consumer extends Cossack { @ClientState() count = 0; }
        const page = new Consumer();
        page.connectedCallback();
        const update = vi.spyOn(page, 'requestUpdate').mockImplementation(() => Promise.resolve(true));
        const store = createStore(1);
        const disconnect = connectStore(store, page, 'count');
        expect(page.count).toBe(1);
        update.mockClear();
        store.set(1);
        expect(update).not.toHaveBeenCalled();
        store.update(value => value + 1);
        expect(page.count).toBe(2);
        disconnect();
        store.set(3);
        expect(page.count).toBe(2);
        expect(Object.keys(page.getPublicState())).toEqual([]);
    });
    it('validates channels of inherited public stores and skips client-only replacements', () => {
        class Parent extends Cossack { @Store({ channel: 'billing' }) inherited = { count: 1 }; }
        class Child extends Parent { @State() added = 1; }
        const child = new Child();
        expect(() => (child as any).validateChannels()).toThrow("State property 'inherited' uses channel 'billing'");
        class Local extends Parent { @ClientStore() override inherited = { count: 2 }; }
        expect(() => (new Local() as any).validateChannels()).not.toThrow();
    });

});
