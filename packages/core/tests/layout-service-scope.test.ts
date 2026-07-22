import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { Cossack } from '../src/shared/cossack';
import { CossackService } from '../src/shared/cossack-service';
import { createInstance } from '../src/shared/container';
import { Inject, Page, Server, Service, State, Store } from '../src/shared/decorators';
import { isRpcCallableAction } from '../src/shared/method-proxy';
import {
  ServiceScope,
  createLayoutServiceScope,
  createRootServiceScope,
  sanitizeServiceState,
} from '../src/shared/service-scope';

describe('layout-scoped services', () => {
  it('records services separately from transport providers', () => {
    @Service()
    class DashboardService {}
    const provider = {} as any;

    @Page({ services: [DashboardService], providers: { page: provider } })
    class Layout extends Cossack {}

    const options = Reflect.getMetadata('page:options', Layout);
    expect(options.services).toEqual([DashboardService]);
    expect(options.providers).toEqual({ page: provider });
  });

  it('rejects duplicate and undecorated declarations descriptively', () => {
    @Service()
    class GoodService {}
    class NotAService {}
    const root = createRootServiceScope();

    expect(() => new ServiceScope(root, [GoodService, GoodService], { ownerRoutePath: '/layout.ts' }))
      .toThrow('Duplicate service GoodService');
    expect(() => new ServiceScope(root, [NotAService], { ownerRoutePath: '/layout.ts' }))
      .toThrow('NotAService in services for /layout.ts is not decorated with @Service()');
  });

  it('lazily injects the nearest declaration and shadows outer layouts', () => {
    @Service()
    class DashboardService {
      @State() label = 'outer';
    }
    const root = createRootServiceScope();
    const outer = new ServiceScope(root, [DashboardService]);
    const inner = new ServiceScope(outer, [DashboardService]);
    inner.resolveDeclared(DashboardService).label = 'inner';

    class Consumer extends Cossack {
      @Inject(DashboardService) private dashboard!: DashboardService;
      read() { return this.dashboard; }
    }

    const outerConsumer = createInstance(Consumer, { serviceScope: outer });
    const innerConsumer = createInstance(Consumer, { serviceScope: inner });
    expect(outerConsumer.read()).not.toBe(innerConsumer.read());
    expect(outerConsumer.read().label).toBe('outer');
    expect(innerConsumer.read().label).toBe('inner');
  });

  it('inherits scope through a renderer parent and reports missing declarations', () => {
    @Service()
    class SharedService {}
    class Parent extends Cossack {}
    class Child extends Cossack {
      @Inject(SharedService) private shared!: SharedService;
      read() { return this.shared; }
    }

    const root = createRootServiceScope();
    const declared = new ServiceScope(root, [SharedService]);
    const parent = createInstance(Parent, { serviceScope: declared });
    const child = new Child();
    child.__parent = parent;
    child.connectedCallback();
    expect(child.read()).toBe(declared.resolveDeclared(SharedService));

    const missing = createInstance(Child, { serviceScope: root });
    expect(() => missing.read()).toThrow('no active layout declares it');
  });

  it('keeps constructor injection compatible while preferring scoped declarations', () => {
    @Service()
    class SharedService {}
    class Consumer extends Cossack {
      constructor(public shared: SharedService) { super(); }
    }
    Reflect.defineMetadata('design:paramtypes', [SharedService], Consumer);

    const root = createRootServiceScope();
    const scope = new ServiceScope(root, [SharedService]);
    const consumer = createInstance(Consumer, { serviceScope: scope });
    expect(consumer.shared).toBe(scope.resolveDeclared(SharedService));
  });

  it('notifies every consumer, serializes stable slots, and hydrates public service state', () => {
    @Service()
    class CounterService {
      @State() count = 0;
      @Store() form = { name: '' };
      secret = 'server-only';
    }
    const scope = new ServiceScope(undefined, [CounterService]);
    const service = scope.resolveDeclared(CounterService);
    const updateA = vi.fn();
    const updateB = vi.fn();
    scope.subscribe(CounterService, { requestUpdate: updateA, loading: {} });
    scope.subscribe(CounterService, { requestUpdate: updateB, loading: {} });

    service.count = 2;
    service.form.name = 'Ada';
    expect(updateA).toHaveBeenCalledTimes(2);
    expect(updateB).toHaveBeenCalledTimes(2);
    expect(scope.serializeOwnedState()).toEqual({
      '0': { count: 2, form: { name: 'Ada' } },
    });

    const hydrated = new ServiceScope(undefined, [CounterService], {
      initialState: { '0': { count: 7, form: { name: 'Grace' }, secret: 'forged' } },
    });
    expect(hydrated.resolveDeclared(CounterService).count).toBe(7);
    expect(hydrated.resolveDeclared(CounterService).form.name).toBe('Grace');
    expect(hydrated.resolveDeclared(CounterService).secret).toBe('server-only');
    expect(sanitizeServiceState(CounterService, { count: 3, secret: 'forged' })).toEqual({ count: 3 });
  });

  it('disposes subscriptions, child scopes, and service hooks exactly once', () => {
    const disposed = vi.fn();
    @Service()
    class DisposableService {
      @State() value = 0;
      onDispose() { disposed(); }
    }
    const parent = new ServiceScope(undefined, [DisposableService]);
    const child = new ServiceScope(parent, [DisposableService]);
    const update = vi.fn();
    child.subscribe(DisposableService, { requestUpdate: update, loading: {} });
    const service = child.resolveDeclared(DisposableService);

    parent.dispose();
    service.value++;
    parent.dispose();
    expect(update).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledTimes(2);
  });

  it('binds request facilities independently for concurrent request scopes', () => {
    @Service()
    class RequestService extends CossackService<{ tenant: string }> {
      snapshot() {
        return { user: this.user?.id, tenant: this.env.tenant, path: this.c.req.path };
      }
    }
    const make = (id: string, tenant: string, path: string) => {
      const root = createRootServiceScope();
      const scope = new ServiceScope(root, [RequestService]);
      scope.bindRequest({
        context: { req: { path } } as unknown as Context,
        user: { id },
        env: { tenant },
      });
      return scope.resolveDeclared(RequestService);
    };

    const first = make('u1', 'one', '/one');
    const second = make('u2', 'two', '/two');
    expect(first.snapshot()).toEqual({ user: 'u1', tenant: 'one', path: '/one' });
    expect(second.snapshot()).toEqual({ user: 'u2', tenant: 'two', path: '/two' });
  });

  it('creates scopes from Page metadata', () => {
    @Service()
    class DeclaredService {}
    @Page({ services: [DeclaredService] })
    class Layout extends Cossack {}
    const scope = createLayoutServiceScope(createRootServiceScope(), Layout);
    expect(scope.resolveDeclared(DeclaredService)).toBeInstanceOf(DeclaredService);
  });

  it('routes client service actions with an explicit owner and slot', async () => {
    @Service()
    class ActionService {
      @State() count = 1;
      @Server() add(_amount: number) { return -1; }
      helper() { return 'not callable'; }
    }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(request).toMatchObject({
        service: { ownerRouteId: 'layout-route', slot: '0' },
        action: 'add',
        payload: [4],
        state: { count: 1 },
      });
      return new Response(JSON.stringify({
        _cossack_service_state: { count: 5 },
        _cossack_return: 'saved',
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const scope = new ServiceScope(undefined, [ActionService], { ownerRouteId: 'layout-route' });
      const service = scope.resolveDeclared(ActionService);
      await expect(service.add(4)).resolves.toBe('saved');
      expect(service.count).toBe(5);
      expect(isRpcCallableAction(ActionService, 'add')).toBe(true);
      expect(isRpcCallableAction(ActionService, 'helper')).toBe(false);
      expect(isRpcCallableAction(ActionService, '__proto__')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps service slots separate from component public state', () => {
    @Service()
    class SharedService { @State() count = 8; }
    class Layout extends Cossack {}
    const scope = new ServiceScope(undefined, [SharedService]);
    const layout = createInstance(Layout, { serviceScope: scope, ownsServiceScope: true });
    const initial = layout.getInitialState();
    expect(initial.public).toEqual({});
    expect(initial.services).toEqual({ '0': { count: 8 } });
  });
});
