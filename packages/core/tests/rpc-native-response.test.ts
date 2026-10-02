import { describe, expect, it, vi } from 'vitest';
import { readRpcNativeResponse, RPC_NATIVE_RESPONSE_MAX_BYTES } from '../src/shared/rpc-stream';

describe('native RPC response completion', () => {
    it('copies binary chunks and metadata into a readable local response', async () => {
        const original = new Response(new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array([0, 255])); controller.enqueue(new Uint8Array([128])); controller.close(); },
        }), { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/octet-stream', 'X-Custom': 'kept' } });
        const response = await readRpcNativeResponse(original);
        expect(original.bodyUsed).toBe(true); expect(original.body?.locked).toBe(false);
        expect(response.status).toBe(201); expect(response.statusText).toBe('Created');
        expect(response.headers.get('X-Custom')).toBe('kept'); expect(response.bodyUsed).toBe(false);
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 128]);
    });
    it('preserves a bodyless 204 response', async () => {
        const response = await readRpcNativeResponse(new Response(null, { status: 204 }));
        expect(response.status).toBe(204); expect(response.body).toBeNull();
    });
    it('permits exactly the byte limit', async () => {
        const response = await readRpcNativeResponse(new Response(new Uint8Array(RPC_NATIVE_RESPONSE_MAX_BYTES)));
        expect((await response.arrayBuffer()).byteLength).toBe(RPC_NATIVE_RESPONSE_MAX_BYTES);
    });
    it('rejects an oversized body, cancels its producer and releases its reader', async () => {
        const cancel = vi.fn();
        const original = new Response(new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(RPC_NATIVE_RESPONSE_MAX_BYTES + 1)); }, cancel,
        }), { headers: { 'X-Cossack-Request-Id': 'large-response' } });
        await expect(readRpcNativeResponse(original)).rejects.toMatchObject({ code: 'COSSACK_RPC_RESPONSE_TOO_LARGE', requestId: 'large-response' });
        expect(cancel).toHaveBeenCalledOnce(); expect(original.body?.locked).toBe(false);
    });
    it('handles many one-byte chunks without per-chunk storage', async () => {
        let sent = 0;
        const response = await readRpcNativeResponse(new Response(new ReadableStream<Uint8Array>({
            pull(controller) { if (sent++ < 10000) controller.enqueue(new Uint8Array([1])); else controller.close(); },
        })));
        expect((await response.arrayBuffer()).byteLength).toBe(10000);
    });
    it('cancels before reading an already aborted body', async () => {
        const cancel = vi.fn(); const pull = vi.fn(); const controller = new AbortController(); controller.abort();
        const original = new Response(new ReadableStream<Uint8Array>({ cancel, pull }, { highWaterMark: 0 }));
        await expect(readRpcNativeResponse(original, controller.signal)).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED' });
        expect(pull).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(original.body?.locked).toBe(false);
    });
    it('aborts while a body read is pending and releases its reader', async () => {
        const cancel = vi.fn(); const controller = new AbortController();
        const original = new Response(new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }), { headers: { 'X-Cossack-Request-Id': 'cancelled-response' } });
        const pending = readRpcNativeResponse(original, controller.signal); controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: 'cancelled-response' });
        expect(cancel).toHaveBeenCalledOnce(); expect(original.body?.locked).toBe(false);
    });
    it('preserves a network failure and releases its reader', async () => {
        const failure = new TypeError('connection lost');
        const original = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(failure); } }));
        await expect(readRpcNativeResponse(original)).rejects.toBe(failure);
        expect(original.body?.locked).toBe(false);
    });
});
