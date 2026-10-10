import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { RpcError } from '../src/shared/rpc-stream';

afterEach(() => vi.restoreAllMocks());

function fixture() {
    const load = vi.fn((id: number) => ({ id, count: 1 }));
    class Host extends Cossack<{}, { Resources: 'record' }> {
        static readonly __cossackResourceFields = ['record'];
        id = 1;
        get record() { return this.__serverResource('record', load, { deps: () => [this.id] as const, initial: { id: 0, count: 0 } })!; }
        get unrelated() { throw new Error('unrelated getter executed'); }
    }
    const host = new Host(); vi.spyOn(host, 'requestUpdate').mockResolvedValue(true);
    return { host, load };
}

it('reads one declared resource after a lost reply and shares repeated recovery requests', async () => {
    const { host, load } = fixture(); const failure = new RpcError('COSSACK_RPC_NETWORK_FAILED', 'The result is unknown.');
    const recover = (host as any).reconcile$(failure, 'record');
    const repeated = (host as any).reconcile$(failure, 'record', 'record');
    expect(await recover).toMatchObject({ state: 'recovered', resources: ['record'] });
    expect(await repeated).toMatchObject({ state: 'recovered', resources: ['record'] });
    expect(load).toHaveBeenCalledOnce(); expect(host.record).toEqual({ id: 1, count: 1 });
    expect(failure.code).toBe('COSSACK_RPC_NETWORK_FAILED'); await host.destroyAsync();
});

it('does not read after confirmed validation rejection', async () => {
    const { host, load } = fixture();
    expect(await (host as any).reconcile$(new RpcError('COSSACK_VALIDATION_FAILED', 'Denied.'), 'record')).toMatchObject({ state: 'not-needed' });
    expect(load).not.toHaveBeenCalled(); await host.destroyAsync();
});

it('binds each recovery to the dependencies at invocation and does not confirm an obsolete read', async () => {
    let resolve!: (value: { id: number; count: number }) => void;
    const { host, load } = fixture();
    load.mockImplementationOnce((id: number) => new Promise<{ id: number; count: number }>(done => { resolve = done; }) as any);
    const failure = new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Unknown.');
    const first = (host as any).reconcile$(failure, 'record');
    host.id = 2;
    const next = (host as any).reconcile$(failure, 'record');
    await Promise.resolve(); await Promise.resolve();
    expect(load.mock.calls.map(args => args[0])).toEqual([1, 2]);
    resolve({ id: 1, count: 1 });
    expect(await first).toMatchObject({ state: 'superseded' });
    expect(await next).toMatchObject({ state: 'recovered' });
    expect(host.record).toEqual({ id: 2, count: 1 }); await host.destroyAsync();
});

it.each(['COSSACK_RPC_NETWORK_FAILED', 'COSSACK_RPC_TRANSPORT_CLOSED', 'COSSACK_RPC_TIMEOUT',
    'COSSACK_RPC_CANCELLED', 'COSSACK_RPC_RESPONSE_INVALID', 'COSSACK_RPC_RESPONSE_TOO_LARGE',
    'COSSACK_RPC_STREAM_TRUNCATED', 'COSSACK_RPC_STREAM_INVALID', 'COSSACK_RPC_STREAM_TOO_LARGE',
    'COSSACK_RPC_BUFFER_EXCEEDED', 'COSSACK_RPC_INTERNAL_ERROR'])('reads after %s without changing the failure', async code => {
    const { host, load } = fixture(); const failure = new RpcError(code, 'Unknown.', { requestId: 'original' });
    expect(await host.reconcile$(failure, 'record')).toMatchObject({ state: 'recovered' });
    expect(load).toHaveBeenCalledOnce(); expect(failure.requestId).toBe('original');
    await host.destroyAsync();
});

it.each(['COSSACK_VALIDATION_FAILED', 'COSSACK_RPC_VALIDATION_FAILED', 'COSSACK_AUTH_FORBIDDEN',
    'COSSACK_AUTH_UNAUTHENTICATED', 'COSSACK_RPC_FORBIDDEN', 'COSSACK_RPC_NOT_FOUND',
    'COSSACK_RPC_SERIALIZATION_FAILED', 'COSSACK_RPC_TRANSPORT_FAILED', 'COSSACK_RPC_ALREADY_CONSUMED'])('skips the standard pre-dispatch/guard/consumer failure %s', async code => {
    const { host, load } = fixture();
    expect(await host.reconcile$(new RpcError(code, 'Denied.'), 'record')).toMatchObject({ state: 'not-needed' });
    expect(load).not.toHaveBeenCalled(); await host.destroyAsync();
});

it('selects server-correlated serialization and generic HTTP 500 failures for reads', async () => {
    for (const failure of [new RpcError('COSSACK_RPC_SERIALIZATION_FAILED', 'After write.', { requestId: 'server' }),
        new RpcError('COSSACK_RPC_FAILED', 'Upstream failed.', { status: 500 })]) {
        const { host, load } = fixture();
        expect(await host.reconcile$(failure, 'record')).toMatchObject({ state: 'recovered' });
        expect(load).toHaveBeenCalledOnce(); await host.destroyAsync();
    }
});

it('does not classify a plain application error or code-shaped object as an RPC transport failure', async () => {
    const { host, load } = fixture();
    for (const error of [new Error('application error'), { code: 'COSSACK_RPC_NETWORK_FAILED' }, null]) {
        expect(await host.reconcile$(error, 'record')).toMatchObject({ state: 'not-needed' });
    }
    expect(load).not.toHaveBeenCalled(); await host.destroyAsync();
});

it('validates all requested names before reads and never evaluates unrelated getters', async () => {
    const { host, load } = fixture(); const failure = new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Unknown.');
    const result = await (host.reconcile$ as any)(failure, 'record', 'unrelated');
    expect(result.state).toBe('failed'); expect(result.error.message).toContain('Unknown server$ resource');
    expect(load).not.toHaveBeenCalled(); expect(failure.code).toBe('COSSACK_RPC_NETWORK_FAILED');
    await host.destroyAsync();
});

it('reports a failed resource read separately and shares it until an explicit refresh retries', async () => {
    const { host, load } = fixture(); const readError = new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Read failed.');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    load.mockImplementationOnce(() => { throw readError; });
    const failure = new RpcError('COSSACK_RPC_TIMEOUT', 'Write unknown.');
    const result = await host.reconcile$(failure, 'record');
    expect(result).toMatchObject({ state: 'failed', error: readError });
    expect(host.resourceStatus$('record')).toMatchObject({ state: 'error', error: readError });
    expect(await host.reconcile$(failure, 'record')).toEqual(result); expect(load).toHaveBeenCalledOnce();
    expect(failure.message).toBe('Write unknown.');
    await host.refresh$('record'); expect(host.resourceStatus$('record').state).toBe('ready');
    expect(load).toHaveBeenCalledTimes(2); await host.destroyAsync();
});

it('returns disposed without a read and discards an in-flight read on component destruction', async () => {
    const { host, load } = fixture(); const failure = new RpcError('COSSACK_RPC_TIMEOUT', 'Unknown.');
    await host.destroyAsync(); expect(await host.reconcile$(failure, 'record')).toMatchObject({ state: 'disposed' });
    expect(load).not.toHaveBeenCalled();
    const active = fixture(); let resolve!: (value: { id: number; count: number }) => void;
    active.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }) as any);
    const pending = active.host.reconcile$(failure, 'record'); await Promise.resolve();
    await active.host.destroyAsync(); resolve({ id: 1, count: 1 });
    expect(await pending).toMatchObject({ state: 'disposed' });
});

it('does not report recovered when an explicit refresh supersedes this read', async () => {
    const { host, load } = fixture(); let resolve!: (value: { id: number; count: number }) => void;
    load.mockImplementationOnce(() => new Promise(done => { resolve = done; }) as any);
    const pending = host.reconcile$(new RpcError('COSSACK_RPC_TIMEOUT', 'Unknown.'), 'record');
    await Promise.resolve(); await host.refresh$('record'); resolve({ id: 1, count: 99 });
    expect(await pending).toMatchObject({ state: 'superseded' }); expect(host.record.count).toBe(1);
    await host.destroyAsync();
});

it('returns immutable status and name snapshots', async () => {
    const { host } = fixture(); const result = await host.reconcile$(new RpcError('COSSACK_RPC_NETWORK_FAILED', 'Unknown.'), 'record');
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.resources)).toBe(true);
    await host.destroyAsync();
});
