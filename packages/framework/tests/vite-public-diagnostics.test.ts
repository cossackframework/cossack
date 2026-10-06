import { describe, expect, it, vi } from 'vitest';
import type { ViteDevServer } from 'vite';
import { installPublicReloadPrivacy } from '../src/vite-public-diagnostics.js';

describe('public Vite reload privacy', () => {
  function fixture() {
    const send = vi.fn(function (this: unknown, ...args: unknown[]) { return { receiver: this, args }; });
    const ws = { send } as unknown as ViteDevServer['ws'];
    return { ws, send, restore: installPublicReloadPrivacy({ ws }) };
  }

  it('removes absolute source identity while preserving reload behavior and private input', () => {
    const { ws, send } = fixture();
    const payload = { type: 'full-reload' as const, path: '*', triggeredBy: '/private/app/src/server.ts' };
    ws.send(payload);
    expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    expect(payload.triggeredBy).toBe('/private/app/src/server.ts');
    expect(send.mock.results[0].value.receiver).toBe(ws);
  });

  it('forwards custom events and ordinary update messages unchanged', () => {
    const { ws, send } = fixture();
    const data = { requestId: 'public-id' };
    const update = { type: 'update' as const, updates: [] };
    ws.send('cossack:test', data);
    ws.send(update);
    expect(send.mock.calls).toEqual([['cossack:test', data], [update]]);
    expect(send.mock.calls[1][0]).toBe(update);
  });

  it('restores the original channel when disposed', () => {
    const { ws, send, restore } = fixture();
    expect(ws.send).not.toBe(send);
    restore();
    expect(ws.send).toBe(send);
  });

  it('does not replace a later plugin channel wrapper on disposal', () => {
    const { ws, restore } = fixture();
    const later = vi.fn() as unknown as typeof ws.send;
    ws.send = later;
    restore();
    expect(ws.send).toBe(later);
  });
});
