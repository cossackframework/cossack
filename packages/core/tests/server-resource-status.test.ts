// @vitest-environment jsdom
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { State } from '../src/shared/decorators';

/**
 * RT-03: public resource lifecycle status — pending (with stale over existing
 * data), ready, error, refresh/retry, and dependency invalidation.
 */

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

class Host extends Cossack {
    first = deferred<number>();
    second = deferred<number>();
    call = 0;

    status(name: string) { return this.resourceStatus$(name); }

    usersValue?: number;
    loadUsers(value: number) {
        this.usersValue = this.__serverResource('users',
            async () => {
                this.call += 1;
                return this.call === 1 ? await this.first.promise : await this.second.promise;
            },
            { initial: 0 }) as number | undefined;
    }

    failing?: number;
    loadFailing() {
        this.failing = this.__serverResource('failing', async () => {
            throw new Error('backend down');
        }, { initial: -1 }) as number | undefined;
    }
}

describe('resourceStatus$ (RT-03)', () => {
    it('starts declared fields through status or refresh before the first render, including inherited fields', async () => {
        const loader = vi.fn(() => 7);
        class Fields extends Cossack<{}, { Resources: 'item' }> {
            static readonly __cossackResourceFields = ['item'];
            get item() { return this.__serverResource('item', loader, { initial: 0 })!; }
            get unrelated() { throw new Error('unrelated getter executed'); }
        }
        class Inherited extends Fields {}
        const host = new Inherited();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        expect(host.resourceStatus$('item')).toMatchObject({ state: 'pending', value: 0 });
        await Promise.all(host.__serverResourcePending());
        expect(loader).toHaveBeenCalledOnce();
        // An untyped/dynamic caller still fails without invoking arbitrary getters.
        await expect((host.refresh$ as (name: string) => Promise<void>)('unrelated')).rejects.toThrow(/Unknown server\$ resource/);
        await host.destroyAsync();
        const fresh = new Fields();
        vi.spyOn(fresh, 'requestUpdate').mockResolvedValue(true);
        loader.mockClear();
        await fresh.refresh$('item');
        expect(loader).toHaveBeenCalledOnce();
        expect(fresh.resourceStatus$('item')).toMatchObject({ state: 'ready', value: 7 });
        await fresh.destroyAsync();
    });

    it('accepts repeated acyclic references and never invokes custom serialization hooks', async () => {
        const host = new Host();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const shared = { id: 7 };
        const value = [shared, shared];
        expect(() => host.__serverResource('shared', (_left: typeof shared, _right: typeof shared) => value, { deps: () => [shared, shared] as const })).not.toThrow();
        await Promise.all(host.__serverResourcePending());
        expect(host.status('shared')).toMatchObject({ state: 'ready', value });
        const toJSON = vi.fn(() => 'surprise');
        expect(() => host.__serverResource('hook', (_arg: unknown) => 0, { deps: () => [{ toJSON }] as const })).toThrow(/not transport-safe/);
        expect(toJSON).not.toHaveBeenCalled();
        expect(() => host.__serverResource('date', (_arg: unknown) => 0, { deps: () => [new Date()] as const })).toThrow(/unsupported dependency Date/);
        for (const number of [NaN, Infinity, -Infinity]) {
            expect(() => host.__serverResource('number', (_arg: unknown) => 0, { deps: () => [number] as const })).toThrow(/non-finite number/);
        }
        expect(() => host.__serverResource('absent', (_arg: unknown) => 0, { deps: () => [undefined] as const })).toThrow(/undefined dependency; use null/);
        expect(() => host.__serverResource('nested', (_arg: unknown) => 0, { deps: () => [{ id: undefined }] as const })).toThrow(/undefined dependency; use null/);
        const hidden = Object.defineProperty({}, 'toJSON', { value: toJSON });
        expect(() => host.__serverResource('hidden', (_arg: unknown) => 0, { deps: () => [hidden] as const })).toThrow(/custom toJSON hook/);
        expect(toJSON).not.toHaveBeenCalled();
        host.__serverResource('optional', () => undefined);
        await Promise.all(host.__serverResourcePending());
        expect(host.status('optional')).toMatchObject({ state: 'ready', hasValue: true, value: undefined });
        await host.destroyAsync();
    });
    it('retries a failed refresh while preserving the last successful data', async () => {
        const host = new Host();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail = false;
        let value = 10;
        try {
            host.__serverResource('item', () => {
                if (fail) throw new Error('temporarily unavailable');
                return value;
            });
            await Promise.all(host.__serverResourcePending());
            fail = true;
            await host.refresh$('item');
            expect(host.status('item')).toMatchObject({ state: 'error', hasValue: true, value: 10 });
            fail = false;
            value = 20;
            await host.refresh$('item');
            expect(host.status('item')).toEqual({ state: 'ready', hasValue: true, value: 20, stale: false });
        } finally { log.mockRestore(); await host.destroyAsync(); }
    });

    it('binds a hydrated field loader before refresh and uses current dependencies without two loads', async () => {
        const loader = vi.fn((id: number) => id * 10);
        class Hydrated extends Cossack<{}, { Resources: 'item' }> {
            static readonly __cossackResourceFields = ['item'];
            @State() id = 1;
            get item() { return this.__serverResource('item', loader, { deps: () => [this.id] as const, initial: 0 })!; }
        }
        const host = new Hydrated();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        await host.bootstrap({ skipInit: true, initialState: {
            public: { id: 7 }, serverResources: { item: { argsKey: '[7]', value: 70 } },
        } });
        // No getter read has bound the generated method yet.
        await host.refresh$('item');
        expect(loader.mock.calls).toEqual([[7]]);
        host.id = 8;
        await host.refresh$('item');
        expect(loader.mock.calls).toEqual([[7], [8]]);
        expect(host.resourceStatus$('item')).toMatchObject({ state: 'ready', value: 80 });
        await host.destroyAsync();
    });

    it('reuses hydrated data only for the dependencies that produced it', async () => {
        const loader = vi.fn((id: number) => id * 10);
        class Hydrated extends Cossack {
            @State() id = 1;
            read() { return this.__serverResource('item', loader, { deps: () => [this.id] as const }); }
        }
        const host = new Hydrated();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        await host.bootstrap({ skipInit: true, initialState: {
            public: { id: 7 }, serverResources: { item: { argsKey: '[7]', value: 70 } },
        } });
        expect(host.read()).toBe(70);
        expect(host.read()).toBe(70);
        await Promise.resolve();
        expect(loader).not.toHaveBeenCalled();
        host.id = 8;
        expect(host.read()).toBe(70);
        expect(host.resourceStatus$('item')).toMatchObject({ state: 'pending', value: 70, stale: true });
        await Promise.all(host.__serverResourcePending());
        expect(host.read()).toBe(80);
        expect(loader.mock.calls).toEqual([[8]]);
        await host.destroyAsync();
    });

    it('discards pending values and errors after disposal and cannot start another loader', async () => {
        const host = new Host();
        const update = vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const value = deferred<number>();
        const failure = deferred<number>();
        host.__serverResource('value', () => value.promise);
        host.__serverResource('failure', () => failure.promise);
        const pending = host.__serverResourcePending();
        await host.destroyAsync();
        value.resolve(42);
        failure.reject(new Error('obsolete failure'));
        try {
            await Promise.all(pending);
            expect(update).not.toHaveBeenCalled();
            expect(log).not.toHaveBeenCalled();
            expect(host.__serverResourcePending()).toEqual([]);
            const loader = vi.fn(() => 7);
            expect(() => host.__serverResource('value', loader)).toThrow(/after Host was destroyed/);
            expect(loader).not.toHaveBeenCalled();
        } finally { log.mockRestore(); }
    });

    it('invalidates pending work, starts from the declared initial value, and rejects unknown targets', async () => {
        const host = new Host();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const stale = deferred<number>();
        host.__serverResource('item', () => stale.promise, { initial: 1 });
        const oldPending = host.__serverResourcePending();
        host.invalidate$('item');
        expect(host.__serverResource('item', () => 9, { initial: 2 })).toBe(2);
        await Promise.all(host.__serverResourcePending());
        stale.resolve(100);
        await Promise.all(oldPending);
        expect(host.status('item')).toMatchObject({ state: 'ready', value: 9 });
        await expect(host.refresh$('missing')).rejects.toThrow(/Unknown server\$ resource/);
        expect(() => host.invalidate$('missing')).toThrow(/Unknown server\$ resource/);
        expect(() => host.resourceStatus$('missing')).toThrow(/Unknown server\$ resource/);
        await host.destroyAsync();
    });
    it('refresh preserves dependency arguments and ignores older refreshes', async () => {
        const host = new Host();
        const first = deferred<number>();
        const second = deferred<number>();
        const loader = vi.fn((id: number) => loader.mock.calls.length === 1 ? id :
            loader.mock.calls.length === 2 ? first.promise : second.promise);
        host.__serverResource('item', loader, { deps: () => [7] as const });
        await Promise.all(host.__serverResourcePending());
        const older = host.refresh$('item');
        const newer = host.refresh$('item');
        second.resolve(20);
        await newer;
        first.resolve(10);
        await older;
        expect(loader.mock.calls).toEqual([[7], [7], [7]]);
        expect(host.status('item')).toMatchObject({ state: 'ready', value: 20 });
    });

    it('refresh applies the same serialization checks as the initial load', async () => {
        const host = new Host();
        let fail = false;
        host.__serverResource('unsafe', () => fail ? (() => {}) : 1);
        await Promise.all(host.__serverResourcePending());
        fail = true;
        await host.refresh$('unsafe');
        expect(host.status('unsafe')).toMatchObject({ state: 'error', value: 1 });
    });

    it('records synchronous loader failures as resource errors', async () => {
        const host = new Host();
        expect(() => host.__serverResource('sync', () => { throw new Error('sync failure'); })).not.toThrow();
        await Promise.all(host.__serverResourcePending());
        expect(host.status('sync')).toMatchObject({ state: 'error' });
    });
    it('tracks pending → ready with initial values', async () => {
        const host = new Host();
        host.loadUsers(7);
        expect(host.status('users')).toMatchObject({ state: 'pending', hasValue: true, value: 0, stale: true });
        host.first.resolve(42);
        await vi.waitFor(() => expect(host.status('users').state).toBe('ready'), { timeout: 1000 });
        expect(host.status('users')).toMatchObject({ state: 'ready', hasValue: true, value: 42, stale: false });
        expect(host.status('users').value).toBe(42);
    });

    it('reports errors distinctly with the last data retained', async () => {
        const host = new Host();
        host.loadFailing();
        await vi.waitFor(() => expect(host.status('failing')).toMatchObject({
            state: 'error', hasValue: true, value: -1,
        }));
        expect((host.status('failing').error as Error).message).toBe('backend down');
    });

    it('rerenders an active client after failure, but ignores a replaced load failure', async () => {
        const host = new Host();
        const update = vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const failed = deferred<number>();
        const obsolete = deferred<number>();
        try {
            host.__serverResource('item', (_id: number) => obsolete.promise, { deps: () => [1] as const, initial: 10 });
            const oldPending = host.__serverResourcePending();
            host.__serverResource('item', (_id: number) => failed.promise, { deps: () => [2] as const });
            const pending = host.__serverResourcePending();
            obsolete.reject(new Error('obsolete'));
            await Promise.all(oldPending);
            expect(update).not.toHaveBeenCalled();
            expect(host.status('item')).toMatchObject({ state: 'pending', value: 10 });
            failed.reject(new Error('current failure'));
            await Promise.all(pending);
            expect(update).toHaveBeenCalledOnce();
            expect(host.status('item')).toMatchObject({ state: 'error', value: 10 });
        } finally {
            log.mockRestore();
        }
    });

    it('refresh$ re-runs the loader and settles again', async () => {
        const host = new Host();
        host.loadUsers(1);
        host.first.resolve(1);
        await vi.waitFor(() => expect(host.status('users').state).toBe('ready'));
        void host.refresh$('users');
        expect(host.status('users')).toMatchObject({ state: 'pending', value: 1, stale: true });
        host.second.resolve(2);
        await vi.waitFor(() => expect(host.status('users')).toMatchObject({ state: 'ready', value: 2 }));
        expect(host.call).toBe(2);
    });

    it('invalidate$ returns the resource to pending-without-data', async () => {
        const host = new Host();
        host.loadUsers(1);
        host.first.resolve(9);
        await vi.waitFor(() => expect(host.status('users').state).toBe('ready'));
        host.invalidate$('users');
        expect(() => host.status('users')).toThrow(/Unknown server\$ resource/);
    });
});

describe('load$', () => {
    class Lead extends Cossack<{}, { Resources: 'lead' }> {
        static readonly __cossackResourceFields = ['lead'];
        selectedId = 'a';
        calls: string[] = [];
        gates = new Map<string, ReturnType<typeof deferred<string>>>();
        get lead() {
            return this.__serverResource('lead', async (id: string) => {
                this.calls.push(id);
                const gate = deferred<string>();
                this.gates.set(id, gate);
                return gate.promise;
            }, { deps: () => [this.selectedId] as const, initial: null as string | null })!;
        }
    }

    it('resolves the current dependencies when render() never read the field', async () => {
        const host = new Lead();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        host.selectedId = 'b';
        const value = host.load$('lead');
        await vi.waitFor(() => expect(host.gates.has('b')).toBe(true));
        host.gates.get('b')!.resolve('lead b');
        await expect(value).resolves.toBe('lead b');
        expect(host.calls).toEqual(['b']);
        // A resolved invocation is returned without another request.
        await expect(host.load$('lead')).resolves.toBe('lead b');
        expect(host.calls).toEqual(['b']);
    });

    it('shares an in-flight load and follows a dependency change made while waiting', async () => {
        const host = new Lead();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        void host.lead;
        const value = host.load$('lead');
        await vi.waitFor(() => expect(host.gates.has('a')).toBe(true));
        host.selectedId = 'c';
        host.gates.get('a')!.resolve('lead a');
        await vi.waitFor(() => expect(host.gates.has('c')).toBe(true));
        host.gates.get('c')!.resolve('lead c');
        await expect(value).resolves.toBe('lead c');
        expect(host.calls).toEqual(['a', 'c']);
    });

    it('rejects with the load error and for unknown names', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const host = new Lead();
            vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
            const value = host.load$('lead');
            await vi.waitFor(() => expect(host.gates.has('a')).toBe(true));
            host.gates.get('a')!.reject(new Error('backend down'));
            await expect(value).rejects.toThrow('backend down');
            await expect((host.load$ as (name: string) => Promise<unknown>)('missing')).rejects.toThrow(/Unknown server\$ resource/);
        } finally {
            log.mockRestore();
        }
    });

    it('rejects when the component is destroyed while waiting', async () => {
        const host = new Lead();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const value = host.load$('lead');
        await vi.waitFor(() => expect(host.gates.has('a')).toBe(true));
        host.destroy();
        host.gates.get('a')!.resolve('lead a');
        await expect(value).rejects.toThrow(/after Lead was destroyed/);
        await expect(host.load$('lead')).rejects.toThrow(/destroyed/);
    });

    it('follows a refresh made while waiting and returns the refreshed value', async () => {
        const host = new Lead();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const value = host.load$('lead');
        await vi.waitFor(() => expect(host.gates.has('a')).toBe(true));
        const first = host.gates.get('a')!;
        void host.refresh$('lead');
        await vi.waitFor(() => expect(host.calls).toEqual(['a', 'a']));
        const second = host.gates.get('a')!;
        expect(second).not.toBe(first);
        first.resolve('stale a');
        second.resolve('fresh a');
        await expect(value).resolves.toBe('fresh a');
    });

    it('follows an invalidation made while waiting and starts a new load', async () => {
        const host = new Lead();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        const value = host.load$('lead');
        await vi.waitFor(() => expect(host.gates.has('a')).toBe(true));
        const first = host.gates.get('a')!;
        host.invalidate$('lead');
        first.resolve('stale a');
        await vi.waitFor(() => expect(host.calls).toEqual(['a', 'a']));
        host.gates.get('a')!.resolve('fresh a');
        await expect(value).resolves.toBe('fresh a');
    });

    it('rejects a server-side loader failure without recording a client error', async () => {
        const host = new Lead();
        vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
        Object.defineProperty(host, 'isServer', { value: true, configurable: true });
        const value = host.load$('lead');
        await vi.waitFor(() => expect(host.gates.has('a')).toBe(true));
        host.gates.get('a')!.reject(new Error('server rejected'));
        await expect(value).rejects.toThrow('server rejected');
    });
});
