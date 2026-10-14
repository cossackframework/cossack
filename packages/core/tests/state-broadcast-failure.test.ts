import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { State } from '../src/shared/decorators';

const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};

afterEach(() => { vi.restoreAllMocks(); });

class Counter extends Cossack {
    protected override isServer = true;
    @State() count = 0;
    @State() label = 'a';
}

function attachRuntime(component: Cossack, runtime: Record<string, unknown>) {
    (component as any)._runtime = runtime;
}

describe('server state broadcast failures', () => {
    it('keeps broadcasting after broadcastState throws once', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const component = new Counter();
        component.connectedCallback();
        const broadcasts: Record<string, unknown>[] = [];
        let fail = true;
        attachRuntime(component, {
            broadcastState: (state: Record<string, unknown>) => {
                broadcasts.push(state);
                if (fail) { fail = false; throw new Error('socket send failed'); }
            },
            persistState: vi.fn(async () => {}),
        });

        component.count = 1;
        await flush();
        component.label = 'b';
        await flush();

        expect(broadcasts).toEqual([{ count: 1 }, { label: 'b' }]);
        expect(errors.mock.calls.some(([record]) => (record as any)?.stage === 'delivery')).toBe(true);
    });

    it('observes a rejected persistState and keeps broadcasting', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const component = new Counter();
            component.connectedCallback();
            const broadcastState = vi.fn();
            const persistState = vi.fn()
                .mockImplementationOnce(() => Promise.reject(new Error('storage put failed')))
                .mockImplementation(async () => {});
            attachRuntime(component, { broadcastState, persistState });

            component.count = 1;
            await flush();
            component.count = 2;
            await flush();
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(broadcastState).toHaveBeenCalledTimes(2);
            expect(persistState).toHaveBeenCalledTimes(2);
            expect(unhandled).not.toHaveBeenCalled();
            expect(errors.mock.calls.some(([record]) => (record as any)?.stage === 'delivery')).toBe(true);
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });
});
