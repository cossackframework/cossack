import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rpcFormData, snapshotRpcPayload } from '../src/shared/rpc-files';
import { sendRpcUpload } from '../src/shared/rpc-upload';
import { readRpcStream, RPC_STREAM_CONTENT_TYPE, RPC_STREAM_MAX_FRAME_BYTES } from '../src/shared/rpc-stream';

class Xhr {
    static latest: Xhr;
    upload: { onprogress?: (event: any) => void } = {};
    responseType = ''; responseText = ''; response: ArrayBuffer | undefined;
    status = 200; statusText = 'OK'; readyState = 1;
    responseHeaders = new Headers();
    onreadystatechange?: () => void; onprogress?: () => void; onload?: () => void; onerror?: () => void; onabort?: () => void;
    abort = vi.fn(() => { this.responseHeaders = new Headers(); this.onabort?.(); });
    constructor() { Xhr.latest = this; }
    getResponseHeader(key: string) { return this.responseHeaders.get(key); }
    getAllResponseHeaders() { return [...this.responseHeaders].map(([k, v]) => `${k}: ${v}`).join('\r\n'); }
    setRequestHeader = vi.fn();
    open() {} send() {} overrideMimeType() {}
    beginStream() {
        this.responseHeaders = new Headers({ 'Content-Type': RPC_STREAM_CONTENT_TYPE, 'X-Cossack-Request-Id': 'upload-a' });
        this.readyState = 2; this.onreadystatechange?.();
    }
    progress(text: string) { this.responseText += text; this.readyState = 3; this.onprogress?.(); }
}
beforeEach(() => vi.stubGlobal('XMLHttpRequest', Xhr));
afterEach(() => vi.unstubAllGlobals());

describe('multipart payload values', () => {
    it('preserves nested file parts and JSON representations with one custom hook evaluation', () => {
        const file = new File(['hello'], 'nested.txt');
        const hook = vi.fn(() => ({ when: new Date('2026-10-03'), files: [file] }));
        const encoded = snapshotRpcPayload([{ toJSON: hook }]);
        expect(encoded.payload).toEqual([{ when: '2026-10-03T00:00:00.000Z', files: [{ _cossack_file_id: 'file_0' }] }]);
        expect(encoded.files.get('file_0')).toBe(file); expect(hook).toHaveBeenCalledOnce();
        const body = rpcFormData({ service: { ownerRouteId: 'layout', slot: '0' }, payload: encoded.payload, scopeKey: 'user:test' }, encoded.files);
        expect(body.get('service')).toBe('{"ownerRouteId":"layout","slot":"0"}'); expect(body.get('scopeKey')).toBe('user:test');
        expect((body.get('file_0') as File).name).toBe('nested.txt');
    });
    it('accepts FileList as an array of multipart parts', () => {
        const file = new File(['hello'], 'list.txt');
        class Files { 0 = file; length = 1; }
        vi.stubGlobal('FileList', Files);
        expect(snapshotRpcPayload([new Files()]).payload).toEqual([[{ _cossack_file_id: 'file_0' }]]);
    });
    it('retains own __proto__ data and rejects unsupported binary arguments', () => {
        const value = JSON.parse('{"__proto__":{"title":"data"}}');
        expect(JSON.stringify(snapshotRpcPayload([value]).payload)).toBe('[{"__proto__":{"title":"data"}}]');
        expect(() => snapshotRpcPayload([new Blob(['opaque'])])).toThrow(/payload\[0\] \(binary value\)/);
    });
});

describe('progressive upload replies', () => {
    it('retains the supplied call ID when aborting before response headers', async () => {
        const controller = new AbortController(); const id = crypto.randomUUID();
        const pending = sendRpcUpload('/upload', new FormData(), controller.signal, vi.fn(), id, { 'X-Cossack-Development-Trace': id });
        expect(Xhr.latest.setRequestHeader).toHaveBeenCalledWith('X-Cossack-Request-Id', id);
        expect(Xhr.latest.setRequestHeader).toHaveBeenCalledWith('X-Cossack-Development-Trace', id);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: id });
    });
    it('exposes headers and complete Unicode frames before load while preserving upload progress', async () => {
        const progress = vi.fn();
        const pending = sendRpcUpload('/upload', new FormData(), new AbortController().signal, progress);
        const xhr = Xhr.latest; xhr.beginStream();
        expect(xhr.responseType).toBe('text');
        const response = await pending; const iterator = readRpcStream(response);
        const first = iterator.next();
        xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
        const frame = JSON.stringify({ v: 1, type: 'yield', requestId: 'upload-a', state: {}, value: 'привет🙂' });
        xhr.progress(frame.slice(0, -2)); xhr.progress(frame.slice(-2) + '\n');
        expect(await first).toMatchObject({ done: false, value: { value: 'привет🙂' } }); expect(progress).toHaveBeenCalledOnce();
        const next = iterator.next(); xhr.progress(JSON.stringify({ v: 1, type: 'done', requestId: 'upload-a', state: {}, value: 2 }) + '\n'); xhr.onload?.();
        expect(await next).toMatchObject({ value: { type: 'done', value: 2 } }); await iterator.next();
    });
    it('retains the known ID after a native XHR abort clears headers', async () => {
        const controller = new AbortController();
        const pending = sendRpcUpload('/upload', new FormData(), controller.signal, vi.fn());
        Xhr.latest.beginStream(); const iterator = readRpcStream(await pending); const reading = iterator.next(); controller.abort();
        await expect(reading).rejects.toMatchObject({ code: 'COSSACK_RPC_CANCELLED', requestId: 'upload-a' });
        expect(Xhr.latest.abort).toHaveBeenCalledOnce();
    });
    it('reports a network failure after headers and releases the stream', async () => {
        const pending = sendRpcUpload('/upload', new FormData(), new AbortController().signal, vi.fn());
        Xhr.latest.beginStream(); const iterator = readRpcStream(await pending); const reading = iterator.next();
        Xhr.latest.onerror?.(); await expect(reading).rejects.toMatchObject({ code: 'COSSACK_RPC_NETWORK_FAILED', requestId: 'upload-a' });
    });
    it('rejects an oversized unfinished frame before receiving load', async () => {
        const pending = sendRpcUpload('/upload', new FormData(), new AbortController().signal, vi.fn());
        Xhr.latest.beginStream(); const iterator = readRpcStream(await pending); const reading = iterator.next();
        Xhr.latest.progress('x'.repeat(RPC_STREAM_MAX_FRAME_BYTES + 1));
        await expect(reading).rejects.toMatchObject({ code: 'COSSACK_RPC_STREAM_TOO_LARGE', requestId: 'upload-a' });
        expect(Xhr.latest.abort).toHaveBeenCalledOnce();
    });
    it('preserves binary/native headers instead of activating the generator decoder', async () => {
        const pending = sendRpcUpload('/upload', new FormData(), new AbortController().signal, vi.fn()); const xhr = Xhr.latest;
        xhr.responseHeaders = new Headers({ 'Content-Type': RPC_STREAM_CONTENT_TYPE, 'X-Cossack-Rpc-Response': 'native', 'X-Custom': 'kept' });
        xhr.readyState = 2; xhr.onreadystatechange?.(); expect(xhr.responseType).toBe('arraybuffer');
        xhr.response = new Uint8Array([0, 255, 128]).buffer; xhr.onload?.();
        const response = await pending; expect(response.headers.get('X-Custom')).toBe('kept');
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 128]);
    });
});
