import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { DurableObjectRuntime } from '../src/shared/runtimes/durable-object';

/**
 * Verifies that malformed WebSocket frames do not throw out of the runtime
 * message handler (which would close the shared Durable Object connection for
 * all clients), and that non-conforming payloads are silently dropped.
 */

function makeRuntime() {
    const component: any = {
        _id: 'root',
        activeComponents: { has: () => false },
        executeAction: vi.fn(),
    };
    const state: any = {
        // DurableObjectState stub — not exercised by onClientMessage.
    };
    const runtime = new DurableObjectRuntime(component, state, false);
    return { runtime, component };
}

describe('DurableObjectRuntime.onClientMessage robustness', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    it('does not throw on a malformed (non-JSON) frame', async () => {
        const { runtime, component } = makeRuntime();
        await expect(runtime.onClientMessage({} as any, 'not-json{')).resolves.toBeUndefined();
        expect(component.executeAction).not.toHaveBeenCalled();
    });

    it('drops payloads that are not action messages', async () => {
        const { runtime, component } = makeRuntime();
        await runtime.onClientMessage({} as any, JSON.stringify({ type: 'state-update', state: {} }));
        await runtime.onClientMessage({} as any, JSON.stringify({ type: 'action' })); // missing action/payload
        await runtime.onClientMessage({} as any, JSON.stringify({ type: 'action', action: 'x', payload: 'not-array' }));
        expect(component.executeAction).not.toHaveBeenCalled();
    });

    it('executes a well-formed action message', async () => {
        const { runtime, component } = makeRuntime();
        const client: any = { deserializeAttachment: () => ({ user: { id: 'u1' } }) };
        await runtime.onClientMessage(client, JSON.stringify({
            type: 'action', action: 'doThing', payload: [1, 2],
        }));
        expect(component.executeAction).toHaveBeenCalledWith('doThing', [1, 2], { id: 'u1' }, client);
    });

    it('drops actions targeting an unknown component without throwing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const component: any = {
            _id: 'root',
            activeComponents: { has: () => false },
            executeAction: vi.fn(),
        };
        const runtime = new DurableObjectRuntime(component, {} as any, false);
        await runtime.onClientMessage(
            { deserializeAttachment: () => ({}) } as any,
            JSON.stringify({ type: 'action', action: 'x', payload: [], target: 'missing' }),
        );
        expect(component.executeAction).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
