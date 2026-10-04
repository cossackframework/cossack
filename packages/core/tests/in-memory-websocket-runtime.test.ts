import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'hono';
import { InMemoryWebSocketRuntime } from '../src/shared/runtime';

class Socket {
  readyState = 1;
  sent: string[] = [];
  closed?: [number | undefined, string | undefined];
  send(message: string) { this.sent.push(message); }
  close(code?: number, reason?: string) { this.closed = [code, reason]; this.readyState = 3; }
}

describe('InMemoryWebSocketRuntime', () => {
  it('isolates malformed messages and handles ping', async () => {
    const component = { _id: 'root', activeComponents: new Map(), executeAction: vi.fn(), getInitialState: () => ({}) };
    const runtime = new InMemoryWebSocketRuntime(component);
    const client = new Socket();
    runtime.addClient(client, { id: 'one' });
    await expect(runtime.onClientMessage(client, '{bad')).resolves.toBeUndefined();
    await runtime.onClientMessage(client, 'ping');
    expect(client.sent).toEqual(['pong']);
    expect(component.executeAction).not.toHaveBeenCalled();
  });

  it('dispatches nested targets with the authenticated client user', async () => {
    const nested = { executeAction: vi.fn() };
    const component = {
      _id: 'root', activeComponents: new Map([['child', nested]]),
      executeAction: vi.fn(), getInitialState: () => ({ public: {} }),
    };
    const runtime = new InMemoryWebSocketRuntime(component);
    const client = new Socket();
    const user = { id: 'trusted' };
    runtime.addClient(client, user);
    await runtime.onClientMessage(client, JSON.stringify({
      type: 'action', target: 'child', action: 'increment', payload: [2],
    }));
    expect(nested.executeAction).toHaveBeenCalledWith('increment', [2], user, client, undefined);
    expect(component.executeAction).not.toHaveBeenCalled();
  });

  it('broadcasts only to open clients and removes clients', () => {
    const component = { getInitialState: () => ({}), activeComponents: new Map() };
    const runtime = new InMemoryWebSocketRuntime(component);
    const open = new Socket();
    const closed = new Socket(); closed.readyState = 3;
    runtime.addClient(open); runtime.addClient(closed);
    runtime.broadcastState({ count: 1 });
    expect(open.sent).toEqual([JSON.stringify({ type: 'state-update', state: { count: 1 } })]);
    expect(closed.sent).toEqual([]);
    runtime.removeClient(open);
    expect(runtime.clientCount).toBe(1);
  });

  it('runs actions and the initial snapshot inside fresh authorization context', async () => {
    const component = {
      _id: 'root', activeComponents: new Map(), executeAction: vi.fn(),
      getInitialState: () => ({ public: { count: 0 } }),
    };
    const runtime = new InMemoryWebSocketRuntime(component);
    const client = new Socket();
    runtime.addClient(client, { id: 'stale' }, undefined, async (_socket, operation) => {
      const context = new Context(new Request('http://localhost/ws'));
      context.set('user', { id: 'fresh' });
      await operation(context);
      return true;
    });
    await runtime.sendInitialState(client);
    expect(JSON.parse(client.sent[0]!)).toEqual({ type: 'state-update', state: { count: 0 } });
    await runtime.onClientMessage(client, JSON.stringify({ type: 'action', action: 'mutate', payload: [] }));
    expect(component.executeAction).toHaveBeenCalledWith('mutate', [], { id: 'fresh' }, client, undefined, expect.anything());
  });

  it('stops both an unauthorized action and later outbound delivery', async () => {
    const component = { _id: 'root', activeComponents: new Map(), executeAction: vi.fn(), getInitialState: () => ({ public: {} }) };
    const runtime = new InMemoryWebSocketRuntime(component);
    const client = new Socket();
    runtime.addClient(client, { id: 'stale' }, undefined, async () => false);
    await runtime.onClientMessage(client, JSON.stringify({ type: 'action', requestId: 'req-1', action: 'mutate', payload: [] }));
    expect(component.executeAction).not.toHaveBeenCalled();
    expect(client.closed?.[0]).toBe(1008);
    expect(client.sent.map(frame => JSON.parse(frame))).toContainEqual(expect.objectContaining({
      type: 'authorization-error', code: 'COSSACK_REALTIME_AUTH_CHANGED',
    }));
    const before = client.sent.length;
    await runtime.sendToClient(client, { type: 'state-update', state: { secret: true } });
    expect(client.sent).toHaveLength(before);
  });
});
