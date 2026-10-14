import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Cossack, Page, Server } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

/**
 * On Workers, a response sent while the request body is still unread leaves
 * the client writing after the response and breaks the next request on the
 * same connection. Whatever the pipeline leaves unread must be read to the end
 * before the response is returned.
 */
const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, unknown>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

@Page({ transport: 'http' })
class IgnoresBody extends Cossack {
    async post() { return this.c.json({ ignored: true }); }
}

@Page({ transport: 'http' })
class Denied extends Cossack {
    @Server({ authorize: () => false })
    async post() { return this.c.json({ never: true }); }
}

@Page({ transport: 'http' })
class Home extends Cossack {
    render() { return html`<p>home</p>`; }
}

registry.pages['/src/pages/api/ignores/index.ts'] = { default: IgnoresBody };
registry.pages['/src/pages/api/denied/index.ts'] = { default: Denied };
registry.pages['/src/pages/index.ts'] = { default: Home };
const { createApp } = await import('../src/router');

function streamedBody() {
    const chunks = ['{"a":', '1}'];
    const state = { pulls: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) { const chunk = chunks[state.pulls++]; if (chunk) controller.enqueue(new TextEncoder().encode(chunk)); else controller.close(); },
        cancel() { state.cancelled = true; },
    });
    return { stream, state, done: chunks.length + 1 };
}

const post = (path: string, body: ReadableStream<Uint8Array>) => createApp().request(path, {
    method: 'POST', body, headers: { 'Content-Type': 'application/json' }, duplex: 'half',
} as RequestInit, {} as any);

describe('unread request bodies', () => {
    it('are read to the end when a handler ignores its body', async () => {
        const { stream, state, done } = streamedBody();
        const response = await post('/api/ignores', stream);
        expect(response.status).toBe(200);
        expect(state.pulls).toBe(done);
        expect(state.cancelled).toBe(false);
    });

    it('are read to the end when authorization denies the handler', async () => {
        const { stream, state, done } = streamedBody();
        const response = await post('/api/denied', stream);
        expect(response.status).toBe(403);
        expect(state.pulls).toBe(done);
    });

    it('are read to the end for a 404', async () => {
        const { stream, state, done } = streamedBody();
        const response = await post('/missing', stream);
        expect(response.status).toBe(404);
        expect(state.pulls).toBe(done);
    });

    it('are cancelled instead of read when larger than the upload limit', async () => {
        let pulls = 0; let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); },
            cancel() { cancelled = true; },
        });
        const response = await createApp({ rpc: { maxUploadBytes: 4096 } }).request('/api/ignores', {
            method: 'POST', body: stream, headers: { 'Content-Type': 'application/json' }, duplex: 'half',
        } as RequestInit, {} as any);
        expect(response.status).toBe(200);
        expect(cancelled).toBe(true);
        expect(pulls).toBeLessThan(16);
    });
});
