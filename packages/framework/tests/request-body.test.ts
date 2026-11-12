import { describe, expect, it } from 'vitest';
import { discardRequestBody } from '../src/request-body';

function counted(chunks: number) {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (pulls++ < chunks) controller.enqueue(new Uint8Array(1024));
            else controller.close();
        },
    });
    return { stream, pulls: () => pulls };
}

describe('discardRequestBody', () => {
    it('drains a body that was read partway and released', async () => {
        const { stream, pulls } = counted(8);
        const request = new Request('http://test.local/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
        // A reader that refused the body after its first chunk, as getFormData does past its limit.
        const reader = request.body!.getReader();
        await reader.read();
        reader.releaseLock();
        await discardRequestBody(request, 1024 * 1024);
        expect(pulls()).toBe(9);
    });

    it('leaves a body that is still being read', async () => {
        const { stream, pulls } = counted(8);
        const request = new Request('http://test.local/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
        const reader = request.body!.getReader();
        await reader.read();
        // The stream pulls one chunk ahead by itself; let it settle first.
        await new Promise(resolve => setTimeout(resolve, 10));
        const before = pulls();
        await discardRequestBody(request, 1024 * 1024);
        expect(pulls()).toBe(before);
        reader.releaseLock();
    });

    it('returns at once for a body read to its end', async () => {
        const request = new Request('http://test.local/', { method: 'POST', body: 'done' });
        expect(await request.text()).toBe('done');
        await discardRequestBody(request, 1024);
    });
});
