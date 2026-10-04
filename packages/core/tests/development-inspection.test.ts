import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientState, Service, State } from '../src/shared/decorators';
import { createInstance } from '../src/shared/container';
import { ServiceScope } from '../src/shared/service-scope';
import { startDevelopmentTrace, type DevelopmentTraceSession } from '../src/shared/development-trace';
import { StateContainer } from '../src/shared/state-container';
import type { DevelopmentComponentDetails } from '../src/shared/development-inspection';

let session: DevelopmentTraceSession;
const hosts: Cossack[] = [];
afterEach(async () => { session?.stop(); await Promise.all(hosts.splice(0).map(host => host.destroyAsync())); vi.restoreAllMocks(); });
function details(host: Cossack, state: string[] = []): DevelopmentComponentDetails {
    const result = session.inspect(host, { state }); expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('No snapshot'); return result.details;
}
it('inspects stored public/client state without getters, values by default, or undecorated private fields', () => {
    const getter = vi.fn(() => 'getter-secret'), toJSON = vi.fn(() => 'json-secret');
    class Host extends Cossack {
        @State() count = 7;
        @State() password = 'private-password';
        @ClientState() draft = 'draft-value';
        @State() data = Object.defineProperty({ safe: true, toJSON, token: 'nested-secret' }, 'derived', { enumerable: true, get: getter });
        private internalSecret = 'internal-private';
        get unrelated() { return getter(); }
    }
    const host = new Host(); hosts.push(host); host.connectedCallback(); session = startDevelopmentTrace();
    const passive = details(host);
    expect(passive.state.fields.every(field => field.value.type === 'omitted')).toBe(true);
    expect(JSON.stringify(passive)).not.toContain('private-password');
    const selected = details(host, ['count', 'draft', 'password', 'data', 'internalSecret', 'unrelated']);
    expect(selected.state.fields).toEqual(expect.arrayContaining([
        { name: 'count', visibility: 'public', value: { type: 'number', value: 7 } },
        { name: 'draft', visibility: 'client', value: { type: 'string', value: 'draft-value' } },
        { name: 'password', visibility: 'public', value: { type: 'redacted' } },
    ]));
    expect(JSON.stringify(selected)).not.toMatch(/private-password|nested-secret|internal-private|getter-secret|json-secret/);
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    selected.state.fields.length = 0; expect(details(host).state.fields.length).toBeGreaterThan(0);
    expect(session.snapshot().components.entries[0]).toMatchObject({ status: 'available', details: { lifecycle: host.getPhase() } });
});

it('reads unbound/pending/ready/error resource status without starting or refreshing a loader', async () => {
    let resolve!: (value: number) => void;
    const loader = vi.fn(() => new Promise<number>(done => { resolve = done; })), getter = vi.fn();
    class Host extends Cossack {
        static readonly __cossackResourceFields = ['item'];
        get item() { getter(); return this.__serverResource('item', loader, { initial: 0 }); }
    }
    const host = new Host(); hosts.push(host); vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
    session = startDevelopmentTrace();
    expect(details(host).resources.entries).toEqual([{ name: 'item', state: 'unbound', hasValue: false, stale: false }]);
    expect(getter).not.toHaveBeenCalled(); expect(loader).not.toHaveBeenCalled();
    void host.item; await Promise.resolve();
    expect(details(host).resources.entries[0]).toMatchObject({ state: 'pending', hasValue: true, stale: true });
    resolve(4); await Promise.all(host.__serverResourcePending());
    expect(details(host).resources.entries[0]).toMatchObject({ state: 'ready', stale: false });
    expect(loader).toHaveBeenCalledOnce(); expect(getter).toHaveBeenCalledOnce();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host.__serverResource('failure', () => { throw new Error('private failure'); });
    await Promise.all(host.__serverResourcePending());
    expect(details(host).resources.entries.find(entry => entry.name === 'failure')).toMatchObject({ state: 'error', stale: false });
    expect(JSON.stringify(details(host))).not.toContain('private failure');
});

it('reports real scope ownership and transport status without service values, owner URLs or error text', async () => {
    let created = 0;
    @Service() class Counter { @State() secret = 'service-private'; constructor() { created++; } }
    const root = new ServiceScope(), scope = new ServiceScope(root, [Counter], { ownerRoutePath: '/private-route', scopeKey: 'private-scope' });
    class Host extends Cossack {}
    const host = createInstance(Host, { serviceScope: scope }); hosts.push(host);
    host.realtime.sse.state = 'reconnecting'; host.realtime.sse.lastError = 'private error';
    host.realtime.websockets['private-provider'] = { state: 'open', attempts: 2, updatedAt: Date.now(), lastEventId: 'secret-cursor', resynced: true };
    session = startDevelopmentTrace();
    const snapshot = details(host);
    expect(snapshot.scopes.entries).toHaveLength(2);
    expect(snapshot.scopes.entries[0].parentId).toBe(snapshot.scopes.entries[1].scopeId);
    expect(snapshot.scopes.entries[0].services).toEqual([{ slot: '0', name: 'Counter', initialized: true }]);
    expect(snapshot.transports.entries).toEqual([
        { transport: 'sse', slot: 0, state: 'reconnecting', attempts: 0, resynced: false },
        { transport: 'websocket', slot: 1, state: 'open', attempts: 2, resynced: true },
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/service-private|private-route|private-scope|private error|private-provider|secret-cursor/);
    expect(created).toBe(1); await scope.disposeAsync(); expect(details(host).scopes.entries[0].disposed).toBe(true); await root.disposeAsync();
});

it('bounds selected values and fields, preserves sparse indices, and does not expose internal state', () => {
    const container = new StateContainer(), client = new Set<string>();
    for (let i = 0; i < 65; i++) container.setPublic('field' + i, i);
    container.setInternal('secret', 'private');
    expect(container.developmentSnapshot(new Set(), client)).toMatchObject({ fields: expect.any(Array), truncated: true });
    expect(container.developmentSnapshot(new Set(), client).fields).toHaveLength(64);
    const sparse: any[] = []; sparse[2] = 'last'; const cyclic: any = {}; cyclic.self = cyclic;
    container.setPublic('selected', { sparse, cyclic, long: 'x'.repeat(513), token: 'private', many: Array(100).fill(1) });
    const selected = container.developmentSnapshot(new Set(['selected', 'secret']), client).fields[0];
    expect(selected.name).toBe('selected'); expect(JSON.stringify(selected)).not.toContain('private');
    expect(selected.value).toMatchObject({ type: 'object', entries: expect.arrayContaining([
        { name: 'sparse', value: { type: 'array', items: [{ type: 'hole' }, { type: 'hole' }, { type: 'string', value: 'last' }], truncated: false } },
        { name: 'long', value: { type: 'truncated' } },
    ]) });
});

it('keeps weak component tracking bounded and stops passive reads when capture stops', () => {
    session = startDevelopmentTrace();
    for (let i = 0; i < 65; i++) { const host = new (class extends Cossack {})(); hosts.push(host); session.inspect(host); }
    const snapshot = session.snapshot(); expect(snapshot.components.entries).toHaveLength(64); expect(snapshot.components.dropped).toBe(1);
    expect(() => session.inspect(hosts[0], { state: Array(33).fill('field') })).toThrow(TypeError);
    session.stop(); expect(session.inspect(hosts[0])).toMatchObject({ status: 'stopped' });
    expect(session.snapshot().components.entries.every(entry => entry.status === 'stopped')).toBe(true);
});
