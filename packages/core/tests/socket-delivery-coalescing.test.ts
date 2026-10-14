import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryWebSocketRuntime } from '../src/shared/runtime';
import { SocketDeliveryQueue } from '../src/shared/socket-delivery';

class Socket {
    readyState = 1;
    sent: string[] = [];
    closed?: [number | undefined, string | undefined];
    send(message: string) { this.sent.push(message); }
    close(code?: number, reason?: string) { this.closed = [code, reason]; this.readyState = 3; }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** A slow authorizer (the framework reruns full middleware per authorization). */
function slowAuthorizer() {
    const calls = { count: 0 };
    const authorize = vi.fn(async (_socket: Socket, operation: (context: any) => Promise<void>) => {
        calls.count++;
        await tick();
        await operation({});
        return true;
    });
    return { authorize, calls };
}

describe('socket state delivery coalescing', () => {
    it('coalesces a tight loop of state writes, bounding authorizations without disconnecting', async () => {
        const component = { getInitialState: () => ({ public: {} }), activeComponents: new Map() };
        const runtime = new InMemoryWebSocketRuntime<Socket>(component);
        const client = new Socket();
        const { authorize, calls } = slowAuthorizer();
        runtime.addClient(client, undefined, undefined, authorize);

        for (let i = 1; i <= 200; i++) {
            runtime.broadcastState({ count: i });
            if (i % 50 === 0) runtime.broadcastState({ label: `at-${i}` });
            if (i % 20 === 0) await Promise.resolve();
        }
        for (let i = 0; i < 10; i++) await tick();

        expect(client.closed).toBeUndefined();
        expect(calls.count).toBeLessThanOrEqual(4);
        const frames = client.sent.map(frame => JSON.parse(frame));
        expect(frames.every(frame => frame.type === 'state-update')).toBe(true);
        // Partial snapshots merge, so no key is lost and the final value wins.
        const merged = Object.assign({}, ...frames.map(frame => frame.state));
        expect(merged).toEqual({ count: 200, label: 'at-200' });
        expect(frames.at(-1).state.count).toBe(200);
    });

    it('authorizes every client-action frame individually and keeps frame order', async () => {
        const queue = new SocketDeliveryQueue<Socket>();
        const client = new Socket();
        const { authorize, calls } = slowAuthorizer();
        const open = (socket: Socket) => socket.readyState === 1;
        void queue.send(client, { type: 'state-update', state: { a: 1 } }, open, authorize);
        void queue.send(client, { type: 'client-action', action: 'one', payload: [] }, open, authorize);
        void queue.send(client, { type: 'client-action', action: 'two', payload: [] }, open, authorize);
        void queue.send(client, { type: 'event', eventName: 'ping', payload: [] }, open, authorize);
        await queue.send(client, { type: 'state-update', state: { b: 2 } }, open, authorize);

        expect(client.sent.map(frame => JSON.parse(frame).type)).toEqual([
            'state-update', 'client-action', 'client-action', 'event', 'state-update',
        ]);
        // One batch for the leading state, one per client-action, one for the trailing batch.
        expect(calls.count).toBe(4);
    });

    it('never merges a state update across an intervening event', async () => {
        const queue = new SocketDeliveryQueue<Socket>();
        const client = new Socket();
        const { authorize } = slowAuthorizer();
        const open = (socket: Socket) => socket.readyState === 1;
        void queue.send(client, { type: 'state-update', state: { a: 1 } }, open, authorize);
        void queue.send(client, { type: 'event', eventName: 'e', payload: [] }, open, authorize);
        await queue.send(client, { type: 'state-update', state: { a: 2 } }, open, authorize);
        expect(client.sent.map(frame => JSON.parse(frame))).toEqual([
            { type: 'state-update', state: { a: 1 } },
            { type: 'event', eventName: 'e', payload: [] },
            { type: 'state-update', state: { a: 2 } },
        ]);
    });

    it('still retires a peer whose non-coalescible backlog exceeds the bound', async () => {
        const queue = new SocketDeliveryQueue<Socket>(4);
        const client = new Socket();
        const { authorize } = slowAuthorizer();
        const open = (socket: Socket) => socket.readyState === 1;
        for (let i = 0; i < 10; i++) void queue.send(client, { type: 'event', eventName: `e${i}`, payload: [] }, open, authorize);
        for (let i = 0; i < 5; i++) await tick();
        expect(client.closed?.[0]).toBe(1013);
    });
});
