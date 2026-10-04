import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { queueDevelopmentNativeEvidence } from '../src/transports/development-trace';
import { retainRpcResponseBody } from '../src/transports/rpc-stream';
afterEach(() => vi.unstubAllEnvs());
it('reports once after request cleanup, preserving native bytes, metadata and async context', async () => {
    const context = new AsyncLocalStorage<string>();
    let finish!: () => void;
    const cleanup = vi.fn(() => { expect(context.getStore()).toBe('request'); return new Promise<void>(resolve => { finish = resolve; }); });
    const report = vi.fn(); const abort = new AbortController();
    const wrapped = await context.run('request', () => retainRpcResponseBody(new Response(new Uint8Array([0, 255, 128]), {
        status: 201, statusText: 'Created', headers: { 'Content-Length': '3', 'X-Custom': 'kept', 'Content-Type': 'application/octet-stream' },
    }), abort.signal, cleanup, report));
    const reading = wrapped.arrayBuffer();
    await expect.poll(() => cleanup.mock.calls.length).toBe(1); expect(report).not.toHaveBeenCalled();
    finish(); expect([...new Uint8Array(await reading)]).toEqual([0, 255, 128]);
    expect(wrapped.status).toBe(201); expect(wrapped.statusText).toBe('Created');
    expect(wrapped.headers.get('Content-Length')).toBe('3'); expect(wrapped.headers.get('X-Custom')).toBe('kept');
    expect(report.mock.calls).toEqual([['succeeded', 'completed']]); abort.abort(); expect(report).toHaveBeenCalledOnce();
});
it.each(['body', 'cleanup'] as const)('distinguishes %s failures without retaining raw errors', async source => {
    const failure = new Error('private failure'), report = vi.fn();
    const original = source === 'body' ? new Response(new ReadableStream({ start(c) { c.error(failure); } })) : new Response('ok');
    const cleanup = vi.fn(async () => { if (source === 'cleanup') throw failure; });
    const response = await retainRpcResponseBody(original, new AbortController().signal, cleanup, report);
    await expect(response.text()).rejects.toBe(failure);
    // cancel() on an errored stream also rejects: cleanup includes the
    // producer cancellation attempt, even though request disposal still runs.
    expect(cleanup).toHaveBeenCalledOnce();
    expect(report.mock.calls).toEqual([['failed', 'failed']]);
});
it.each(['signal', 'consumer'] as const)('reports %s cancellation only when cleanup finishes', async source => {
    let finish!: () => void; const report = vi.fn(), abort = new AbortController();
    const cleanup = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const response = await retainRpcResponseBody(new Response(new ReadableStream()), abort.signal, cleanup, report);
    const reader = response.body!.getReader(); const reading = reader.read().catch(error => error);
    let cancelling: Promise<void> | undefined;
    if (source === 'signal') abort.abort(); else cancelling = reader.cancel();
    await expect.poll(() => cleanup.mock.calls.length).toBe(1); expect(report).not.toHaveBeenCalled();
    finish(); await cancelling; await reading;
    await expect.poll(() => report.mock.calls).toEqual([['cancelled', 'completed']]);
});
it('reports bodyless cleanup and isolates a throwing observer', async () => {
    const cleanup = vi.fn(async () => {}), report = vi.fn(() => { throw new Error('observer'); });
    const response = await retainRpcResponseBody(new Response(null, { status: 204 }), new AbortController().signal, cleanup, report);
    expect(response.status).toBe(204); expect(response.body).toBeNull(); expect(cleanup).toHaveBeenCalledOnce();
    expect(report.mock.calls).toEqual([['succeeded', 'completed']]);
});
it('does not notify observers in production', async () => {
    vi.stubEnv('DEV', false); const report = vi.fn();
    const response = await retainRpcResponseBody(new Response('native'), new AbortController().signal, async () => {}, report);
    expect(await response.text()).toBe('native'); expect(report).not.toHaveBeenCalled();
});
it('retains a bodyless cleanup failure even when its observer rejects', async () => {
    const failure = new Error('request disposal failed');
    const report = vi.fn(async () => { throw new Error('observer failed'); });
    await expect(retainRpcResponseBody(new Response(null, { status: 204 }), new AbortController().signal,
        async () => { throw failure; }, report)).rejects.toBe(failure);
    expect(report.mock.calls).toEqual([['failed', 'failed']]);
});

it.each([false, true])('does not hold a native response behind a missing trace acknowledgement (bodyless: %s)', async bodyless => {
    vi.useFakeTimers();
    let held: Promise<unknown> | undefined;
    const hot = { on: vi.fn(), off: vi.fn(), send: vi.fn() };
    const evidence = { schemaVersion: 1 as const, callId: crypto.randomUUID(), requestId: crypto.randomUUID(), dispatchId: crypto.randomUUID(),
        finishedAt: 1, outcome: 'succeeded' as const, cleanup: 'completed' as const };
    try {
        const response = await retainRpcResponseBody(bodyless ? new Response(null, { status: 204 }) : new Response('native'),
            new AbortController().signal, async () => {}, () => queueDevelopmentNativeEvidence(hot as any, evidence, { waitUntil(pending) { held = pending; } }));
        expect(await response.text()).toBe(bodyless ? '' : 'native');
        expect(vi.getTimerCount()).toBe(1); expect(held).toBeInstanceOf(Promise);
        await vi.advanceTimersByTimeAsync(1000); await held; expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
});
