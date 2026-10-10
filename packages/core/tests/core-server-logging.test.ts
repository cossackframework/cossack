// @vitest-environment node
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { Server, ServerTask, Service } from '../src/shared/decorators';
import { ServiceScope } from '../src/shared/service-scope';

const id = '12345678-1234-4123-8123-123456789abc';
const secret = 'private-config-token-sentinel';
const error = () => Object.assign(new Error(secret), { config: { token: secret } });
afterEach(() => vi.restoreAllMocks());
async function context() {
    let result!: Context;
    const app = new Hono(); app.get('/items/:id', c => {
        c.header('X-Cossack-Request-Id', id); (c as Context).set('cossack.configContext', { runtime: 'node' }); result = c; return c.text('ok');
    });
    await app.request(`/items/${secret}?token=${secret}`); return result;
}
function assertSafe(logged: ReturnType<typeof vi.spyOn>) {
    expect(JSON.stringify(logged.mock.calls)).not.toContain(secret);
    for (const call of logged.mock.calls) {
        expect(call).toHaveLength(1);
        expect(call[0]).toMatchObject({ event: 'cossack.runtime.failure', durationMs: expect.any(Number) });
        expect(call[0].durationMs).toBeGreaterThanOrEqual(0);
    }
}

it('correlates socket iterator and cleanup failures without logging exceptions', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Actions extends Cossack {
        @Server() stream() { return { [Symbol.asyncIterator]() { return { next: async () => { throw error(); }, return: async () => { throw error(); } }; } }; }
    }
    const page = new Actions(); const request = await context();
    await page.bootstrap({ context: request, runtime: { platform: 'web', adapter: 'node' }, skipInit: true });
    page.__cossack_rpcOwner = '/src/pages/items/[id].ts';
    const socket = { send: vi.fn(), readyState: 1 };
    await page.executeAction('stream', [secret], undefined, socket, id, request);
    expect(logged.mock.calls.map(call => call[0].stage)).toEqual(['action', 'action-cleanup']);
    expect(logged.mock.calls[0][0]).toMatchObject({ requestId: id, route: '/src/pages/items/[id].ts', action: 'stream', runtime: 'node', code: 'COSSACK_RPC_INTERNAL_ERROR' });
    expect(logged.mock.calls[1][0]).toMatchObject({ requestId: id, code: 'COSSACK_RPC_CLEANUP_FAILED' });
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ requestId: id, type: 'error', message: 'Internal Server Error' });
    assertSafe(logged); await page.destroyAsync();
});

it('redacts server task setup and asynchronous cleanup failures', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Tasks extends Cossack {
        @ServerTask() load() { throw error(); }
        @ServerTask() subscribe() { return async () => { throw error(); }; }
    }
    const page = new Tasks(); page.__cossack_rpcOwner = '/src/pages/tasks.ts';
    await page.bootstrap({ context: await context(), runtime: { platform: 'web', adapter: 'node' }, skipInit: true });
    await page.destroyAsync();
    expect(logged.mock.calls.map(call => call[0].stage)).toEqual(['task-setup', 'task-cleanup']);
    expect(logged.mock.calls[0][0]).toMatchObject({ requestId: id, action: 'load', component: 'Tasks', code: 'COSSACK_TASK_FAILED' });
    expect(logged.mock.calls[1][0]).toMatchObject({ requestId: id, action: 'subscribe', code: 'COSSACK_TASK_CLEANUP_FAILED' });
    assertSafe(logged);
});

it('redacts asynchronously rejected component cleanup', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Component extends Cossack { async onCleanup() { throw error(); } }
    const page = new Component(); await page.bootstrap({ context: await context(), skipInit: true });
    await expect(page.destroyAsync()).rejects.toBeInstanceOf(AggregateError);
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0][0]).toMatchObject({ requestId: id, stage: 'component-cleanup', code: 'COSSACK_COMPONENT_CLEANUP_FAILED' });
    assertSafe(logged);
});

it('redacts partial service construction rollback failures', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    @Service() class First { async onDispose() { throw error(); } }
    @Service() class Broken { constructor() { throw error(); } }
    const root = new ServiceScope(); root.bindRequest({ context: await context() });
    expect(() => new ServiceScope(root, [First, Broken], { ownerRoutePath: '/src/pages/layout.ts' })).toThrow(secret);
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(logged.mock.calls[0][0]).toMatchObject({ requestId: id, route: '/src/pages/layout.ts', runtime: 'node', stage: 'service-setup-cleanup', code: 'COSSACK_SERVICE_CLEANUP_FAILED' });
    assertSafe(logged);
});

it('redacts service disposal failures while preserving awaitable errors', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    @Service() class Resource { async onDispose() { throw error(); } }
    const scope = new ServiceScope(undefined, [Resource], { ownerRoutePath: '/src/pages/layout.ts' });
    scope.bindRequest({ context: await context() }); scope.dispose();
    await expect(scope.disposeAsync()).rejects.toBeInstanceOf(AggregateError);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledOnce());
    expect(logged.mock.calls[0][0]).toMatchObject({ requestId: id, stage: 'service-cleanup', code: 'COSSACK_SERVICE_CLEANUP_FAILED' });
    assertSafe(logged);
});

it('does not let unavailable context metadata prevent component or service teardown', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hostile = new Proxy({}, { get() { throw error(); } }) as Context;
    class Component extends Cossack { async onCleanup() { throw error(); } }
    const page = new Component();
    (page as any)._c = hostile;
    await expect(page.destroyAsync()).rejects.toBeInstanceOf(AggregateError);
    @Service() class Resource { async onDispose() { throw error(); } }
    const scope = new ServiceScope(undefined, [Resource]); scope.bindRequest({ context: hostile });
    expect(() => scope.dispose()).not.toThrow();
    await expect(scope.disposeAsync()).rejects.toBeInstanceOf(AggregateError);
    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
    expect(logged.mock.calls.every(call => call[0].requestId === 'unavailable' && call[0].runtime === 'unknown')).toBe(true);
    assertSafe(logged);
});

it('redacts actual server update failures while preserving propagated navigation errors', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Component extends Cossack {
        render(): never { throw error(); }
        updateNow() { return this.performUpdate(); }
    }
    const page = new Component(); page.__cossack_rpcOwner = '/src/pages/update.ts';
    await page.bootstrap({ context: await context(), runtime: { platform: 'web', adapter: 'node' }, skipInit: true });
    await expect(page.updateNow()).resolves.toBe(true);
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0][0]).toMatchObject({ requestId: id, route: '/src/pages/update.ts', component: 'Component',
        runtime: 'node', stage: 'dispatch', code: 'COSSACK_RUNTIME_FAILED' });
    assertSafe(logged);
    await expect(page._frameworkRenderNavigation(() => true)).rejects.toMatchObject({ message: secret });
    expect(logged).toHaveBeenCalledOnce();
    await page.destroyAsync();
});
