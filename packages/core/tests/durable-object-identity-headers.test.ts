// @vitest-environment node
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { CossackDurableObject } from '../src/shared/CossackDurableObject';
import { Page } from '../src/shared/decorators';
vi.mock('../src/shared/environment', () => ({ isServer: true }));

afterEach(() => { vi.unstubAllGlobals(); });

it('decodes percent-encoded user id and scope headers without trusting user data', async () => {
    const servers: { serializeAttachment: ReturnType<typeof vi.fn> }[] = [];
    const socket = () => ({ readyState: 1, send: vi.fn(), close: vi.fn(), serializeAttachment: vi.fn() });
    vi.stubGlobal('WebSocketRequestResponsePair', class {});
    vi.stubGlobal('WebSocketPair', class { 0 = socket(); 1 = (() => { const s = socket(); servers.push(s); return s; })(); });
    @Page({ transport: 'durable-object' })
    class Live extends Cossack {}
    class FixtureObject extends CossackDurableObject {
        async getComponentRegistry() { return new Map([['/src/pages/live/index.ts', Live]]); }
        protected override async authorizeWebSocketPeer() { return false; }
    }
    const state = { storage: { get: vi.fn(), put: vi.fn() }, setWebSocketAutoResponse: vi.fn(), getWebSockets: () => [], acceptWebSocket: vi.fn(), waitUntil: vi.fn() };
    const object = new FixtureObject(state as unknown as DurableObjectState, {});
    await object.fetch(new Request('https://fixture.test/global?pathname=/live&params={}', { headers: {
        'X-Component-Path': '/src/pages/live/index.ts', 'X-Provider-Name': 'page',
        'X-User-ID': encodeURIComponent('taras-Тарас'), 'X-User-Data': '{"id":"admin","role":"admin"}',
        'X-Cossack-Realtime-Scope': encodeURIComponent('user:taras-Тарас'),
    } })).catch(() => undefined);
    const peer = servers[0]!.serializeAttachment.mock.calls[0]![0];
    expect(peer.user).toEqual({ id: 'taras-Тарас' });
    expect(peer.scopeKey).toBe('user:taras-Тарас');
});
