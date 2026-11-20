// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { awaitRpcResponse } from '../src/shared/rpc-response';
import { isLeavingPage, resetPageExit, watchPageExit } from '../src/shared/page-exit';
import { RpcError } from '../src/shared/rpc-stream';

afterEach(() => { resetPageExit(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('turns a request the browser cuts off while the page leaves into a cancellation', async () => {
    watchPageExit();
    const failed = awaitRpcResponse(Promise.reject(new TypeError('Failed to fetch')), new AbortController().signal, () => 'r1');
    await expect(failed).rejects.toBeInstanceOf(TypeError);
    window.dispatchEvent(new Event('pagehide'));
    expect(isLeavingPage()).toBe(true);
    await expect(awaitRpcResponse(Promise.reject(new TypeError('Failed to fetch')), new AbortController().signal, () => 'r2'))
        .rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: 'r2' });
    // Restored from the back/forward cache: failures count again.
    window.dispatchEvent(new Event('pageshow'));
    expect(isLeavingPage()).toBe(false);
});

it('stops counting a navigation that did not happen after ten seconds', () => {
    vi.useFakeTimers();
    watchPageExit();
    window.dispatchEvent(new Event('pagehide'));
    expect(isLeavingPage()).toBe(true);
    vi.advanceTimersByTime(10_001);
    expect(isLeavingPage()).toBe(false);
});

it('does not log a server$ load that was cancelled or cut off by leaving the page', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    class View extends Cossack {
        load(name: string, error: unknown) { return this.__serverResource(name, async () => { throw error; }, { initial: null }); }
    }
    const page = new View();
    vi.spyOn(page, 'requestUpdate').mockResolvedValue(true);
    page.load('cancelled', new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.'));
    await Promise.allSettled(page.__serverResourcePending());
    expect(errors).not.toHaveBeenCalled();
    page.load('failed', new RpcError('COSSACK_RPC_NETWORK_FAILED', 'RPC request failed.'));
    await Promise.allSettled(page.__serverResourcePending());
    expect(errors).toHaveBeenCalledOnce();
    watchPageExit();
    window.dispatchEvent(new Event('pagehide'));
    page.load('leaving', new RpcError('COSSACK_RPC_NETWORK_FAILED', 'RPC request failed.'));
    await Promise.allSettled(page.__serverResourcePending());
    expect(errors).toHaveBeenCalledOnce();
    await page.destroyAsync();
});
