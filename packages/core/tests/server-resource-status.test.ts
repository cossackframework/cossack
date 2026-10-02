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
