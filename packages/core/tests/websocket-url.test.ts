import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWebSocket, disconnectWebSockets, wsPendingCalls } from '../src/shared/transport-connections';

describe('connectWebSocket URL protocol', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes a malformed known-ID message before filtering broadcast types', () => {
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      send() {} close() {}
    }
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'example.test' } });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const component = {
      _phase: 'Mounted',
      getInitialStateFromWindow: () => ({ providerTargets: { page: 'scope' }, routePath: '/' }),
      websockets: new Map(), requestUpdate() {},
    };
    connectWebSocket(component);
    const socket = component.websockets.get('page');
    const sink = vi.fn(); const unrelated = vi.fn();
    wsPendingCalls(socket).set('known', sink); wsPendingCalls(socket).set('other', unrelated);
    try {
      socket.onmessage({ data: JSON.stringify({ v: 1, requestId: 'known', state: { count: 999 } }) });
      expect(sink).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', code: 'COSSACK_RPC_STREAM_INVALID', requestId: 'known' }), true);
      expect(unrelated).not.toHaveBeenCalled(); expect(wsPendingCalls(socket).has('known')).toBe(false);
      expect(wsPendingCalls(socket).has('other')).toBe(true);
    } finally { disconnectWebSockets(component); }
  });

  it.each([['https:', 'wss:'], ['http:', 'ws:']])('maps %s pages to %s sockets', (pageProtocol, socketProtocol) => {
    const urls: string[] = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 0;
      onmessage: unknown; onclose: unknown; onerror: unknown;
      constructor(url: string) { urls.push(url); }
      send() {} close() {}
    }
    vi.stubGlobal('window', { location: { protocol: pageProtocol, host: 'example.test' } });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const component = {
      getInitialStateFromWindow: () => ({
        providerTargets: { page: 'scope' }, routePath: '/', metadata: { pathname: '/' },
      }),
      websockets: new Map(),
    };
    connectWebSocket(component);
    expect(urls[0]).toBe(`${socketProtocol}//example.test/ws/page/scope?routePath=%2F&pathname=%2F&params=%7B%7D`);
    disconnectWebSockets(component);
  });
});
