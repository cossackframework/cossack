// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { enableDevTools } from '../src/client/devtools';
import { connectDevelopmentTraceBridge } from '../src/client/development-trace-bridge';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; enableDevTools()?.dispose(); vi.useRealTimers(); vi.unstubAllEnvs(); });
function fixture() {
    vi.useFakeTimers();
    const listeners = new Map<string, Function>();
    const hot = { on: (name: string, listener: Function) => listeners.set(name, listener), off: (name: string) => listeners.delete(name), send: vi.fn(), dispose: vi.fn() };
    dispose = connectDevelopmentTraceBridge('fixture-token', hot as any, enableDevTools());
    const emit = (name: string, data?: unknown) => listeners.get(name)?.(data);
    return { hot, emit, tools: enableDevTools()!, listeners };
}
it('sends only opted-in capture, bounds outstanding snapshots, and records stop after an in-flight active record', () => {
    const { hot, emit, tools } = fixture(); vi.advanceTimersByTime(2000); expect(hot.send).not.toHaveBeenCalled();
    const session = tools.startCapture(); vi.advanceTimersByTime(1000); expect(hot.send).toHaveBeenCalledTimes(1);
    const first = hot.send.mock.calls[0][1]; expect(JSON.parse(first.json).collecting).toBe(true);
    vi.advanceTimersByTime(10000); expect(hot.send).toHaveBeenCalledTimes(1);
    session.stop(); emit('cossack:development-trace:ack', { id: 'other', status: 'saved' });
    vi.advanceTimersByTime(1000); expect(hot.send).toHaveBeenCalledTimes(1);
    emit('cossack:development-trace:ack', { id: first.id, status: 'saved' });
    vi.advanceTimersByTime(1000); expect(hot.send).toHaveBeenCalledTimes(2);
    const final = hot.send.mock.calls[1][1]; expect(JSON.parse(final.json).collecting).toBe(false);
    emit('cossack:development-trace:ack', { id: final.id, status: 'saved' });
    vi.advanceTimersByTime(10000); expect(hot.send).toHaveBeenCalledTimes(2);
});
it('avoids disconnected buffering, retries after busy, and cleans up its timer/listeners without stopping capture', () => {
    const { hot, emit, tools, listeners } = fixture(); const session = tools.startCapture();
    emit('vite:ws:disconnect'); vi.advanceTimersByTime(10000); expect(hot.send).not.toHaveBeenCalled();
    emit('vite:ws:connect'); expect(hot.send).toHaveBeenCalledTimes(1);
    emit('cossack:development-trace:ack', { id: hot.send.mock.calls[0][1].id, status: 'busy' });
    vi.advanceTimersByTime(1000); expect(hot.send).toHaveBeenCalledTimes(2);
    dispose!(); dispose!(); vi.advanceTimersByTime(10000); expect(hot.send).toHaveBeenCalledTimes(2); expect(listeners.size).toBe(0);
    expect(session.snapshot().collecting).toBe(true);
});
it('does not install a production bridge', () => {
    vi.stubEnv('DEV', false); const on = vi.fn(); dispose = connectDevelopmentTraceBridge('unused', { on } as any, undefined); expect(on).not.toHaveBeenCalled();
});
it('routes native evidence through the shared inspector without reconnect buffering', () => {
    const { emit, tools } = fixture(); const record = vi.spyOn(tools, 'recordNativeEvidence');
    emit('cossack:development-trace:native', 'native evidence'); expect(record).toHaveBeenCalledWith('native evidence');
    emit('vite:ws:disconnect'); emit('cossack:development-trace:native', 'dropped'); expect(record).toHaveBeenCalledOnce();
    dispose!(); emit('cossack:development-trace:native', 'disposed'); expect(record).toHaveBeenCalledOnce(); record.mockRestore();
});
