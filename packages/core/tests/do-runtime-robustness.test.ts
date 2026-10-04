import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { DurableObjectRuntime } from '../src/shared/runtimes/durable-object';
import { snapshotSocketRequest, socketRequestContext } from '../src/shared/socket-context';

const request = snapshotSocketRequest(new Request('https://example.test/ws?filter=active', {
    headers: { 'cf-connecting-ip': '192.0.2.1' },
}), { tenant: 'example' });

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
        const client: any = { deserializeAttachment: () => ({ user: { id: 'u1' }, request }) };
        await runtime.onClientMessage(client, JSON.stringify({
            type: 'action', action: 'doThing', payload: [1, 2],
        }));
        expect(component.executeAction).toHaveBeenCalledWith('doThing', [1, 2], { id: 'u1' }, client, undefined, expect.anything());
        const context = component.executeAction.mock.calls[0][5];
        expect(context.get('user')).toEqual({ id: 'u1' });
        expect(context.req.header('cf-connecting-ip')).toBe('192.0.2.1');
        expect(context.req.param('tenant')).toBe('example');
    });

    it('passes the request id through and honors cancel messages', async () => {
        const { runtime, component } = makeRuntime();
        const client: any = { deserializeAttachment: () => ({ request }), send: vi.fn() };
        const cancellations = new Map([['req-1', vi.fn()]]);
        (client as any).__cossack_rpc_cancellations = cancellations;
        await runtime.onClientMessage(client, JSON.stringify({
            v: 1, type: 'action', requestId: 'req-9', action: 'doThing', payload: [],
        }));
        expect(component.executeAction).toHaveBeenCalledWith('doThing', [], undefined, client, 'req-9', expect.anything());
        await runtime.onClientMessage(client, JSON.stringify({ type: 'cancel', requestId: 'req-1' }));
        expect(cancellations.get('req-1')).toHaveBeenCalled();
    });

    it('rejects an older connection without peer context before dispatch and requests reconnect', async () => {
        const { runtime, component } = makeRuntime();
        const client: any = { readyState: 1, deserializeAttachment: () => ({ user: { id: 'anonymous' } }), send: vi.fn(), close: vi.fn() };
        await runtime.onClientMessage(client, JSON.stringify({ type: 'action', action: 'mutate', payload: [], requestId: 'old-peer' }));
        expect(component.executeAction).not.toHaveBeenCalled();
        expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ code: 'COSSACK_RPC_TRANSPORT_CLOSED', requestId: 'old-peer' });
        expect(client.close).toHaveBeenCalledWith(1012, expect.any(String));
    });

    it('forwards a child target the same verified peer context and leaves unrelated frames attachment-free', async () => {
        const child = { executeAction: vi.fn() };
        const root = { _id: 'root', activeComponents: new Map([['child', child]]) } as any;
        const env = { MARK: 'worker' };
        const runtime = new DurableObjectRuntime(root, {} as any, false, env);
        const client: any = { deserializeAttachment: vi.fn(() => ({ user: { id: 'child-user' }, request })) };
        await runtime.onClientMessage(client, JSON.stringify({ type: 'state-update', state: { count: 9 } }));
        expect(client.deserializeAttachment).not.toHaveBeenCalled();
        await runtime.onClientMessage(client, JSON.stringify({ type: 'action', target: 'child', action: 'inspect', payload: [], requestId: 'child-call' }));
        const context = child.executeAction.mock.calls[0][5];
        expect(child.executeAction).toHaveBeenCalledWith('inspect', [], { id: 'child-user' }, client, 'child-call', context);
        expect(context.get('user')).toEqual({ id: 'child-user' });
        expect(context.env).toBe(env);
        expect(context.req.param('tenant')).toBe('example');
        expect(client.deserializeAttachment).toHaveBeenCalledOnce();
    });

    it('revalidates actions and outgoing frames from the peer attachment', async () => {
        const attachment = { user: { id: 'upgrade-user' }, request, identity: { version: 1, provider: 'fixture.session', data: {} },
            componentPath: '/src/pages/room.ts', scopeKey: 'team:alpha' };
        let allowed = true;
        const authorize = vi.fn(async (_client: WebSocket, peer: any, operation: (context: any) => Promise<void>) => {
            expect(peer.scopeKey).toBe('team:alpha');
            if (!allowed) return false;
            const fresh = socketRequestContext(peer.request!, {}, { id: 'fresh-user' });
            await operation(fresh);
            return true;
        });
        const component: any = { _id: 'root', activeComponents: new Map(), executeAction: vi.fn(), getInitialState: () => ({ public: {} }) };
        const client: any = { readyState: 1, deserializeAttachment: vi.fn(() => attachment), send: vi.fn(), close: vi.fn() };
        const runtime = new DurableObjectRuntime(component, { getWebSockets: () => [client] } as any, false, {}, authorize);

        await runtime.onClientMessage(client, JSON.stringify({ type: 'action', action: 'inspect', payload: [], requestId: 'fresh-call' }));
        expect(component.executeAction).toHaveBeenCalledWith('inspect', [], { id: 'fresh-user' }, client, 'fresh-call', expect.anything());
        allowed = false;
        await runtime.sendToClient(client, { type: 'state-update', state: { private: true } });
        expect(client.send).toHaveBeenLastCalledWith(expect.stringContaining('authorization-error'));
        expect(client.close).toHaveBeenCalledWith(1008, 'Realtime authorization changed');
        expect(client.deserializeAttachment).toHaveBeenCalledTimes(2);
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
