import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWebSocket } from '../src/shared/transport-connections';

describe('connectWebSocket URL protocol', () => {
  afterEach(() => vi.unstubAllGlobals());

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
    for (const socket of component.websockets.values()) (socket as any).onclose?.();
  });
});
