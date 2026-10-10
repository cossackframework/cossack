import { afterEach, expect, it, vi } from 'vitest';
import { queueDevelopmentNativeEvidence, sendDevelopmentNativeEvidence } from '../src/transports/development-trace';
const event = 'cossack:development-trace:native';
afterEach(() => vi.useRealTimers());
function fixture() {
    vi.useFakeTimers(); const listeners = new Map<string, Function>();
    const hot = { on: vi.fn((name: string, fn: Function) => listeners.set(name, fn)), off: vi.fn((name: string) => listeners.delete(name)), send: vi.fn() };
    const evidence = { schemaVersion: 1 as const, callId: crypto.randomUUID(), requestId: crypto.randomUUID(), dispatchId: crypto.randomUUID(), finishedAt: 10, outcome: 'succeeded' as const, cleanup: 'completed' as const };
    return { hot, evidence, listeners };
}
it('keeps the reporting promise alive until its own acknowledgement and removes its listener', async () => {
    const { hot, evidence, listeners } = fixture(); let done = false;
    const pending = sendDevelopmentNativeEvidence(hot as any, evidence).then(() => { done = true; });
    expect(hot.send.mock.calls).toEqual([[event, JSON.stringify(evidence)]]);
    listeners.get(event + ':ack')!({ dispatchId: 'other' }); await Promise.resolve(); expect(done).toBe(false);
    listeners.get(event + ':ack')!({ dispatchId: evidence.dispatchId }); await pending;
    expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('bounds missing acknowledgements to one second without replay or retaining a listener', async () => {
    const { hot, evidence, listeners } = fixture(); let done = false;
    const pending = sendDevelopmentNativeEvidence(hot as any, evidence).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(999); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await pending;
    expect(listeners.size).toBe(0); expect(hot.send).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('releases immediately on a synchronous transport error', async () => {
    const { hot, evidence, listeners } = fixture(); hot.send.mockImplementation(() => { throw new Error('disconnected'); });
    await sendDevelopmentNativeEvidence(hot as any, evidence);
    expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
it('settles even when a disposed runner rejects listener removal', async () => {
    const { hot, evidence } = fixture(); hot.off.mockImplementation(() => { throw new Error('disposed runner'); });
    const pending = sendDevelopmentNativeEvidence(hot as any, evidence);
    await vi.advanceTimersByTimeAsync(1000); await pending;
    expect(vi.getTimerCount()).toBe(0);
});
it('keeps concurrent reports independent when acknowledgements arrive out of order', async () => {
    const { EventEmitter } = await import('node:events');
    const { evidence } = fixture(), emitter = new EventEmitter();
    const hot = { on: emitter.on.bind(emitter), off: emitter.off.bind(emitter), send: vi.fn() };
    const second = { ...evidence, dispatchId: crypto.randomUUID() };
    let firstDone = false;
    const first = sendDevelopmentNativeEvidence(hot as any, evidence).then(() => { firstDone = true; });
    const last = sendDevelopmentNativeEvidence(hot as any, second);
    emitter.emit(event + ':ack', { dispatchId: second.dispatchId }); await last;
    expect(firstDone).toBe(false); expect(emitter.listenerCount(event + ':ack')).toBe(1);
    emitter.emit(event + ':ack', { dispatchId: evidence.dispatchId }); await first;
    expect(emitter.listenerCount(event + ':ack')).toBe(0); expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('returns without waiting for delivery when execution context is %s', async available => {
    const { hot, evidence, listeners } = fixture(); let held: Promise<void> | undefined;
    const execution = { waitUntil(pending: Promise<void>) { expect(this).toBe(execution); held = pending; } };
    expect(queueDevelopmentNativeEvidence(hot as any, evidence, available ? execution : undefined)).toBeUndefined();
    expect(listeners.size).toBe(1); if (available) expect(held).toBeInstanceOf(Promise);
    await vi.advanceTimersByTimeAsync(1000); await held;
    expect(listeners.size).toBe(0);
});
it('isolates a closing execution context while retaining bounded background cleanup', async () => {
    const { hot, evidence, listeners } = fixture();
    expect(() => queueDevelopmentNativeEvidence(hot as any, evidence, { waitUntil() { throw new Error('closed'); } })).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000); expect(listeners.size).toBe(0);
});
