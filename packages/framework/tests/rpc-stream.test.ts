import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientVisibleError, readRpcStream, RPC_STREAM_MAX_FRAME_BYTES } from '@cossackframework/core';
import { createRpcStreamResponse } from '../src/transports/rpc-stream';

const local = new AsyncLocalStorage<string>();
afterEach(() => vi.restoreAllMocks());
async function collect(response: Response) {
    const frames = [];
    for await (const frame of readRpcStream(response)) frames.push(frame);
    return frames;
}
function create(result: AsyncIterable<unknown>, getState = () => ({ count: 0 }), cleanup = vi.fn(async () => {}), signal = new AbortController().signal) {
    return { response: createRpcStreamResponse({ result, getState, cleanup, signal, requestId: 'request-a' }), cleanup };
}

describe('response-local RPC streams', () => {
    it('preserves action context across pulls from different contexts and returns generator results', async () => {
        let count = 0;
        const scopes: Array<string | undefined> = [];
        const generator = async function* () {
            scopes.push(local.getStore());
            count++; yield 'first';
            await Promise.resolve();
            scopes.push(local.getStore());
            count++; yield 'second';
            return 'complete';
        };
        const { response, cleanup } = local.run('original', () => create(generator(), () => ({ count })));
        expect(count).toBe(0);
        const frames = await local.run('different', () => collect(response));
        expect(scopes).toEqual(['original', 'original']);
        expect(frames).toEqual([
            { v: 1, type: 'yield', requestId: 'request-a', value: 'first', state: { count: 1 } },
            { v: 1, type: 'yield', requestId: 'request-a', value: 'second', state: { count: 2 } },
            { v: 1, type: 'done', requestId: 'request-a', value: 'complete', state: { count: 2 } },
        ]);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });
    it('does not pull another generator value until its reader asks', async () => {
        const steps = vi.fn();
        const { response } = create((async function* () { steps(); yield 1; steps(); yield 2; })());
        const reader = response.body!.getReader();
        expect(steps).not.toHaveBeenCalled();
        await reader.read();
        await Promise.resolve();
        expect(steps).toHaveBeenCalledOnce();
        await reader.cancel();
    });
    it('closes the generator and cleans up once in its captured context when cancelled', async () => {
        const closed = vi.fn();
        const cleanup = vi.fn(async () => { expect(local.getStore()).toBe('original'); });
        const { response } = local.run('original', () => create((async function* () {
            try { yield 1; yield 2; } finally { closed(local.getStore()); }
        })(), undefined, cleanup));
        const reader = response.body!.getReader();
        await reader.read();
        await local.run('different', () => reader.cancel());
        expect(closed).toHaveBeenCalledExactlyOnceWith('original');
        expect(cleanup).toHaveBeenCalledOnce();
    });
    it('handles request abortion while preserving cleanup context', async () => {
        const controller = new AbortController();
        const closed = vi.fn();
        const { response, cleanup } = create((async function* () { try { yield 1; yield 2; } finally { closed(); } })(), undefined, undefined, controller.signal);
        const reader = response.body!.getReader();
        await reader.read();
        controller.abort();
        await expect(reader.read()).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
        expect(closed).toHaveBeenCalledOnce();
    });
    it.each([
        [new Error('database-password=secret'), 'COSSACK_RPC_INTERNAL_ERROR', 'Internal Server Error'],
        [new ClientVisibleError('Prompt is required'), 'COSSACK_RPC_CLIENT_ERROR', 'Prompt is required'],
    ])('sends correlated error frames with internal details redacted', async (error, code, message) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { response, cleanup } = create((async function* () { yield 'first'; throw error; })());
        expect((await collect(response)).at(-1)).toEqual({ v: 1, type: 'error', requestId: 'request-a', code, message });
        expect(cleanup).toHaveBeenCalledOnce();
    });
    it('reports serialization failures and executes generator finally', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const closed = vi.fn();
        const { response, cleanup } = create((async function* () { try { yield 1n; } finally { closed(); } })());
        expect(await collect(response)).toEqual([{ v: 1, type: 'error', requestId: 'request-a', code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: 'Cannot serialize RPC stream result or state.' }]);
        expect(cleanup).toHaveBeenCalledOnce();
        expect(closed).toHaveBeenCalledOnce();
    });
    it('bounds server frames and returns cleanup failures as errors, not successful completion', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const large = create((async function* () { yield 'x'.repeat(RPC_STREAM_MAX_FRAME_BYTES); })());
        expect((await collect(large.response)).at(-1)).toMatchObject({ type: 'error', code: 'COSSACK_RPC_STREAM_TOO_LARGE' });
        const failed = create((async function* () { return 42; })(), undefined, vi.fn(async () => { throw new Error('cleanup failed'); }));
        expect(await collect(failed.response)).toEqual([{ v: 1, type: 'error', requestId: 'request-a', code: 'COSSACK_RPC_INTERNAL_ERROR', message: 'Internal Server Error' }]);
        expect(failed.cleanup).toHaveBeenCalledOnce();
    });
});
