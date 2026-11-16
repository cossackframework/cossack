import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { Cossack, Page } from '@cossackframework/core';
import { createApiHandler } from '../src/api-handler';

@Page({ transport: 'http' })
class JsonApi extends Cossack {
    async post() {
        const body = await this.c.req.json();
        return this.c.json({ keys: Object.keys(body as object).length });
    }
}

@Page({ transport: 'http' })
class TextApi extends Cossack {
    async post() {
        // A handler that catches its own read error still answers 413.
        try { await this.c.req.text(); } catch { /* ignored */ }
        return this.c.json({ ok: true });
    }
}

@Page({ transport: 'http' })
class LargeApi extends Cossack {
    static maxBodyBytes = 4096;
    async post() {
        return this.c.json({ size: (await this.c.req.arrayBuffer()).byteLength });
    }
}

@Page({ transport: 'http' })
class RawApi extends Cossack {
    static seen: Request | undefined;
    async post() {
        RawApi.seen = this.c.req.raw;
        return this.c.json({ size: (await this.c.req.arrayBuffer()).byteLength });
    }
}

function streamOf(bytes: number) {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (sent >= bytes) { controller.close(); return; }
            const chunk = new Uint8Array(Math.min(256, bytes - sent)).fill(97);
            sent += chunk.byteLength;
            controller.enqueue(chunk);
        },
    });
}

describe('createApiHandler — body limit', () => {
    const app = new Hono();
    app.post('/json', createApiHandler(JsonApi, 'post', { maxBodyBytes: 1024 }));
    app.post('/text', createApiHandler(TextApi, 'post', { maxBodyBytes: 1024 }));
    app.post('/large', createApiHandler(LargeApi, 'post', { maxBodyBytes: 1024 }));

    it('reads a body under the limit as before', async () => {
        const res = await app.request('/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 1, b: 2 }) });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ keys: 2 });
    });

    it('refuses a declared body over the limit before the handler reads it', async () => {
        const res = await app.request('/json', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(2048) }) });
        expect(res.status).toBe(413);
        expect(await res.json()).toMatchObject({ code: 'COSSACK_API_INPUT_TOO_LARGE' });
    });

    it('answers 413 for a streamed body past the limit, even when the handler swallows the error', async () => {
        for (const path of ['/json', '/text']) {
            const res = await app.request(path, { method: 'POST', body: streamOf(4096), duplex: 'half' } as RequestInit);
            expect(res.status, path).toBe(413);
        }
    });

    it('takes a class\'s own static maxBodyBytes', async () => {
        const res = await app.request('/large', { method: 'POST', body: streamOf(3000), duplex: 'half' } as RequestInit);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ size: 3000 });
        expect((await app.request('/large', { method: 'POST', body: streamOf(5000), duplex: 'half' } as RequestInit)).status).toBe(413);
    });

    it('leaves a body a middleware already read to Hono\'s cache', async () => {
        const read = new Hono();
        read.use('/read', async (c, next) => { await c.req.json(); await next(); });
        read.post('/read', createApiHandler(JsonApi, 'post', { maxBodyBytes: 1024 }));
        const res = await read.request('/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ keys: 1 });
    });

    it('keeps the request as it is when its declared length is within the limit', async () => {
        const kept = new Hono();
        let original: Request | undefined;
        kept.use('/raw', async (c, next) => { original = c.req.raw; await next(); });
        kept.post('/raw', createApiHandler(RawApi, 'post', { maxBodyBytes: 1024 }));
        const res = await kept.request('/raw', { method: 'POST', headers: { 'content-length': '10' }, body: streamOf(10), duplex: 'half' } as RequestInit);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ size: 10 });
        expect(RawApi.seen).toBe(original);
        // Without a declared length the body is wrapped, and bounded.
        await kept.request('/raw', { method: 'POST', body: streamOf(10), duplex: 'half' } as RequestInit);
        expect(RawApi.seen).not.toBe(original);
    });
});
