import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';

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
