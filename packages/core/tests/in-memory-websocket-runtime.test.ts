import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryWebSocketRuntime } from '../src/shared/runtime';

class Socket {
  readyState = 1;
  sent: string[] = [];
  send(message: string) { this.sent.push(message); }
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
    expect(nested.executeAction).toHaveBeenCalledWith('increment', [2], user, client);
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
});
