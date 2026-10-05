// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { logRuntimeFailure } from '../src/shared/server-diagnostics';
import { dispatchSocketRpcMessage } from '../src/shared/runtime';

afterEach(() => vi.restoreAllMocks());

it('does not log incoming socket target and action labels', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn();
    await dispatchSocketRpcMessage({ _id: 'root', activeComponents: new Map() }, { type: 'action', target: 'private-target', action: 'private-action', payload: [], requestId: 'private-id' }, { send, readyState: 1 });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private-');
    expect(logged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ stage: 'dispatch', requestId: 'unavailable' }));
    expect(send).toHaveBeenCalledOnce();
});

it('emits bounded authored metadata without arbitrary context properties', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    logRuntimeFailure({ requestId: '12345678-1234-4123-8123-123456789abc', route: '/items/:id', action: 'save', runtime: 'node', startedAt: performance.now(), ...{ error: new Error('private-secret') } }, 'action');
    expect(logged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'cossack.runtime.failure', requestId: '12345678-1234-4123-8123-123456789abc', route: '/items/:id', action: 'save', runtime: 'node', code: 'COSSACK_RUNTIME_FAILED', stage: 'action' }));
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private-secret');
});

it('does not invoke accessors and sanitizes untrusted IDs and enum values', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getter = vi.fn(() => { throw new Error('private-secret'); });
    const context = { requestId: 'private-secret', runtime: 'private-secret', startedAt: Infinity };
    Object.defineProperty(context, 'route', { get: getter });
    logRuntimeFailure(context, 'private-secret' as any, 'private-secret' as any);
    expect(getter).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestId: 'unavailable', route: 'unknown', runtime: 'unknown', durationMs: 0, stage: 'unknown', code: 'COSSACK_RUNTIME_FAILED' }));
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private-secret');
});

it('bounds labels and clamps future start times', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    logRuntimeFailure({ route: 'a'.repeat(200), action: 'b'.repeat(100), component: 'c'.repeat(100), startedAt: performance.now() + 10000 }, 'socket');
    const event = logged.mock.calls[0][0];
    expect(event.route).toHaveLength(160);
    expect(event.action).toHaveLength(80);
    expect(event.component).toHaveLength(80);
    expect(event.durationMs).toBe(0);
});
