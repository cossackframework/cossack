import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Optimistic, Server, Service, State } from '../src/shared/decorators';
import { optimistic } from '../src/shared/optimistic';
import { hasOptimisticCalls } from '../src/shared/optimistic-state';
import { ServiceScope } from '../src/shared/service-scope';

@Service()
class Counter {
    @State() count = 0;
    @Optimistic('edit') preview() { optimistic<Counter>(this).increment('count', 1); }
    @Server() edit() { return 'server'; }
}

@Service()
class OtherCounter {
    @State() count = 0;
    @Server() edit() { return 'other'; }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture() {
    const pending: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { pending.push(resolve); })));
    const scope = new ServiceScope(undefined, [Counter, OtherCounter], { ownerRouteId: 'layout' });
    const service = scope.resolveDeclared(Counter);
    return {
        scope, service,
        succeed(index: number, count: number) {
            pending[index](new Response(JSON.stringify({ _cossack_return: 'ok', _cossack_service_state: { count } }),
                { headers: { 'Content-Type': 'application/json' } }));
        },
        fail(index: number) {
            pending[index](new Response(JSON.stringify({ code: 'COSSACK_RPC_VALIDATION_FAILED', error: 'Invalid' }),
                { status: 422, headers: { 'Content-Type': 'application/json' } }));
        },
    };
}

function consumer() { return { loading: {} as Record<string, number>, requestUpdate: vi.fn() }; }

describe('scoped service invocation loading', () => {
    it('attaches a late consumer to pending work started without subscribers', async () => {
        const f = fixture();
        const call = f.service.edit();
        expect(f.service.count).toBe(1);
        const late = consumer();
        f.scope.subscribe(Counter, late);
        expect(late.loading.edit).toBe(1);
        expect(hasOptimisticCalls(late, 'edit')).toBe(true);
        f.fail(0);
        await expect(call).rejects.toMatchObject({ code: 'COSSACK_RPC_VALIDATION_FAILED' });
        expect(f.service.count).toBe(0);
        expect(late.loading).toEqual({});
        expect(hasOptimisticCalls(late, 'edit')).toBe(false);
        await f.scope.disposeAsync();
    });

    it('counts each overlapping invocation once for a new sibling consumer', async () => {
        const f = fixture();
        const old = consumer();
        f.scope.subscribe(Counter, old);
        const calls = [f.service.edit(), f.service.edit()];
        const siblingScope = new ServiceScope(f.scope);
        const sibling = consumer();
        siblingScope.subscribe(Counter, sibling);
        expect(siblingScope.resolveDeclared(Counter)).toBe(f.service);
        expect(f.service.count).toBe(2);
        expect(sibling.loading.edit).toBe(2);
        f.fail(0); await expect(calls[0]).rejects.toBeDefined();
        expect(f.service.count).toBe(1);
        expect(sibling.loading.edit).toBe(1);
        expect(old.loading.edit).toBe(1);
        f.succeed(1, 8); await calls[1];
        expect(f.service.count).toBe(8);
        expect(sibling.loading).toEqual({});
        expect(old.loading).toEqual({});
        await f.scope.disposeAsync();
    });

    it('does not double-count duplicate subscriptions or unsubscribe/rejoin', async () => {
        const f = fixture();
        const call = f.service.edit();
        const late = consumer();
        const off = f.scope.subscribe(Counter, late);
        const secondOff = f.scope.subscribe(Counter, late);
        expect(late.loading.edit).toBe(1);
        off(); secondOff();
        f.scope.subscribe(Counter, late);
        expect(late.loading.edit).toBe(1);
        f.succeed(0, 3); await call;
        expect(late.loading).toEqual({});
        expect(hasOptimisticCalls(late, 'edit')).toBe(false);
        await f.scope.disposeAsync();
    });

    it('never attaches a service action to consumers of another declaration', async () => {
        const f = fixture();
        const existingOther = consumer();
        f.scope.subscribe(OtherCounter, existingOther);
        const call = f.service.edit();
        const lateOther = consumer();
        f.scope.subscribe(OtherCounter, lateOther);
        expect(existingOther.loading).toEqual({});
        expect(lateOther.loading).toEqual({});
        expect(hasOptimisticCalls(existingOther, 'edit')).toBe(false);
        f.succeed(0, 2); await call;
        expect(existingOther.requestUpdate).not.toHaveBeenCalled();
        expect(lateOther.requestUpdate).not.toHaveBeenCalled();
        await f.scope.disposeAsync();
    });

    it('shares the counter for equal action names without sharing service ownership', async () => {
        const f = fixture();
        const shared = consumer();
        f.scope.subscribe(Counter, shared);
        f.scope.subscribe(OtherCounter, shared);
        const first = f.service.edit();
        const second = f.scope.resolveDeclared(OtherCounter).edit();
        expect(shared.loading.edit).toBe(2);
        f.succeed(0, 2); await first;
        expect(shared.loading.edit).toBe(1);
        expect(hasOptimisticCalls(shared, 'edit')).toBe(true);
        f.succeed(1, 4); await second;
        expect(shared.loading).toEqual({});
        expect(hasOptimisticCalls(shared, 'edit')).toBe(false);
        expect(f.service.count).toBe(2);
        expect(f.scope.resolveDeclared(OtherCounter).count).toBe(4);
        await f.scope.disposeAsync();
    });

    it('does not render for a consumer that only subscribes to another service now', async () => {
        const f = fixture();
        const switched = consumer();
        const off = f.scope.subscribe(Counter, switched);
        const call = f.service.edit();
        off();
        f.scope.subscribe(OtherCounter, switched);
        const renders = switched.requestUpdate.mock.calls.length;
        f.succeed(0, 3); await call;
        expect(switched.loading).toEqual({});
        expect(switched.requestUpdate).toHaveBeenCalledTimes(renders);
        await f.scope.disposeAsync();
    });

    it('adds service ownership without erasing independent component loading', async () => {
        const f = fixture();
        const call = f.service.edit();
        const late = consumer();
        late.loading.edit = 1;
        f.scope.subscribe(Counter, late);
        expect(late.loading.edit).toBe(2);
        f.fail(0); await expect(call).rejects.toBeDefined();
        expect(late.loading.edit).toBe(1);
        expect(hasOptimisticCalls(late, 'edit')).toBe(false);
        await f.scope.disposeAsync();
    });

    it('does not inherit pending work from a shadowed outer service', async () => {
        const f = fixture();
        const call = f.service.edit();
        const nested = new ServiceScope(f.scope, [Counter], { ownerRouteId: 'nested-layout' });
        const child = consumer();
        nested.subscribe(Counter, child);
        expect(nested.resolveDeclared(Counter)).not.toBe(f.service);
        expect(child.loading).toEqual({});
        f.succeed(0, 4); await call;
        expect(nested.resolveDeclared(Counter).count).toBe(0);
        expect(child.requestUpdate).not.toHaveBeenCalled();
        await f.scope.disposeAsync();
    });

    it('releases a late consumer after it exits without scheduling another render', async () => {
        const f = fixture();
        const call = f.service.edit();
        const late = consumer();
        const off = f.scope.subscribe(Counter, late);
        expect(late.loading.edit).toBe(1);
        off();
        const renders = late.requestUpdate.mock.calls.length;
        f.succeed(0, 5); await call;
        expect(late.loading).toEqual({});
        expect(hasOptimisticCalls(late, 'edit')).toBe(false);
        expect(late.requestUpdate).toHaveBeenCalledTimes(renders);
        await f.scope.disposeAsync();
    });

    it('does not attach a new consumer to already settled invocations', async () => {
        const f = fixture();
        const call = f.service.edit();
        f.succeed(0, 6); await call;
        const late = consumer();
        f.scope.subscribe(Counter, late);
        expect(f.service.count).toBe(6);
        expect(late.loading).toEqual({});
        expect(hasOptimisticCalls(late, 'edit')).toBe(false);
        expect(late.requestUpdate).not.toHaveBeenCalled();
        await f.scope.disposeAsync();
    });
});
