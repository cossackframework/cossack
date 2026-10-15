import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWebSocket, disconnectWebSocket, wsPendingCalls } from '../src/shared/transport-connections';

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
    const component: { _phase: string; getInitialStateFromWindow(): unknown; websocket?: any; requestUpdate(): void } = {
      _phase: 'Mounted',
      getInitialStateFromWindow: () => ({ realtimeTarget: 'scope', routePath: '/' }),
      websocket: undefined, requestUpdate() {},
    };
    connectWebSocket(component);
    const socket = component.websocket;
    const sink = vi.fn(); const unrelated = vi.fn();
    wsPendingCalls(socket).set('known', sink); wsPendingCalls(socket).set('other', unrelated);
    try {
      socket.onmessage({ data: JSON.stringify({ v: 1, requestId: 'known', state: { count: 999 } }) });
      expect(sink).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', code: 'COSSACK_RPC_STREAM_INVALID', requestId: 'known' }), true);
      expect(unrelated).not.toHaveBeenCalled(); expect(wsPendingCalls(socket).has('known')).toBe(false);
      expect(wsPendingCalls(socket).has('other')).toBe(true);
    } finally { disconnectWebSocket(component); }
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
        realtimeTarget: 'scope', routePath: '/', metadata: { pathname: '/' },
      }),
      websocket: undefined,
    };
    connectWebSocket(component);
    expect(urls[0]).toBe(`${socketProtocol}//example.test/ws/scope?routePath=%2F&pathname=%2F&params=%7B%7D`);
    disconnectWebSocket(component);
  });

  it('opens exactly one socket and none without a server-computed target', () => {
    const urls: string[] = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 0;
      onmessage: unknown; onclose: unknown; onerror: unknown;
      constructor(url: string) { urls.push(url); }
      send() {} close() {}
    }
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'example.test' } });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let state: Record<string, unknown> = { routePath: '/' };
    const component: { getInitialStateFromWindow(): unknown; websocket?: unknown } = { getInitialStateFromWindow: () => state };
    connectWebSocket(component);
    expect(urls).toEqual([]);
    expect(component.websocket).toBeUndefined();
    state = { realtimeTarget: 'user:1', routePath: '/' };
    connectWebSocket(component);
    const first = component.websocket;
    // Reconnecting replaces the one connection instead of adding a second.
    connectWebSocket(component);
    expect(urls).toHaveLength(2);
    expect(component.websocket).not.toBe(first);
    expect((first as { __cossack_intentional_close?: boolean }).__cossack_intentional_close).toBe(true);
    disconnectWebSocket(component);
    expect(component.websocket).toBeUndefined();
  });

  it('encodes a target with path characters as one URL segment', () => {
    const urls: string[] = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 0;
      onmessage: unknown; onclose: unknown; onerror: unknown;
      constructor(url: string) { urls.push(url); }
      send() {} close() {}
    }
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'example.test' } });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const target = 'page:["/src/pages/room/[id]/index.ts",[["id","1"]]]';
    const component = {
      getInitialStateFromWindow: () => ({ realtimeTarget: target, routePath: '/room/[id]', metadata: { pathname: '/room/1' } }),
      websocket: undefined,
    };
    connectWebSocket(component);
    const path = new URL(urls[0]!).pathname;
    expect(path.split('/')).toHaveLength(3);
    expect(path.split('/')[1]).toBe('ws');
    expect(decodeURIComponent(path.split('/')[2]!)).toBe(target);
    disconnectWebSocket(component);
  });
});
