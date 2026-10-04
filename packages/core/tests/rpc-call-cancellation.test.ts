import { expect, it, vi } from 'vitest';
import { createRpcCall, RpcError } from '../src/shared/rpc-stream';

it('latches reentrant and repeated cancellation before abort and closes the generator once', async () => {
    const controller = new AbortController(), cleanup = vi.fn(), log = vi.fn();
    const abort = vi.fn(() => { controller.abort(); void call.cancel(); });
    const call = createRpcCall((async function* () { try { yield 1; return 2; } finally { cleanup(); } })(), abort, log,
        () => 'request-id', { signal: controller.signal, error: () => new RpcError('COSSACK_RPC_CANCELLED', 'Cancelled', { requestId: 'request-id' }) });
    const iterator = call[Symbol.asyncIterator](); await iterator.next();
    const first = call.cancel(); expect(call.cancel()).toBe(first); await first;
    await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: 'request-id' });
    expect(abort).toHaveBeenCalledTimes(1); expect(cleanup).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
    expect(await iterator.next()).toMatchObject({ done: true });
});
it('detaches cancellation after successful completion so later abort cannot change the result', async () => {
    const controller = new AbortController(), abort = vi.fn(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const call = createRpcCall((async function* () { return 2; })(), abort, undefined, undefined,
        { signal: controller.signal, error: () => new RpcError('COSSACK_RPC_TIMEOUT', 'Timeout') });
    expect(await call).toBe(2); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort(); await call.cancel(); expect(await call).toBe(2); expect(abort).not.toHaveBeenCalled();
});
it('handles a pre-aborted source without starting the operation', async () => {
    const controller = new AbortController(), started = vi.fn(), cleanup = vi.fn(); controller.abort();
    const call = createRpcCall((async function* () { started(); yield 1; return 2; })(), cleanup, undefined, undefined,
        { signal: controller.signal, error: () => new RpcError('COSSACK_RPC_TIMEOUT', 'Timeout') });
    await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_TIMEOUT' }); await call.cancel();
    expect(started).not.toHaveBeenCalled(); expect(cleanup).toHaveBeenCalledTimes(1);
});
