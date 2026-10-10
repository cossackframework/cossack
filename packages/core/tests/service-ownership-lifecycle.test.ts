import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import { Cossack } from '../src/shared/cossack';
import { CossackService } from '../src/shared/cossack-service';
import { createInstance } from '../src/shared/container';
import { Inject, Page, Service, State } from '../src/shared/decorators';
import { createLayoutServiceScope, createRootServiceScope } from '../src/shared/service-scope';

describe('runtime service ownership acceptance', () => {
  it('uses inherited layout declarations, stable slots, and the nearest owner for both injection forms', async () => {
    @Service()
    class Counter { @State() value = 0; }
    @Service()
    class Other {}
    @Page({ services: [Other, Counter] })
    class BaseLayout extends Cossack {}
    class InheritedLayout extends BaseLayout {}
    @Page({ services: [Counter] })
    class NestedLayout extends Cossack {}
    class Consumer extends Cossack {
      @Inject(Counter) property!: Counter;
      constructor(public dependency: Counter) { super(); }
    }
    Reflect.defineMetadata('design:paramtypes', [Counter], Consumer);
    const root = createRootServiceScope();
    const outer = createLayoutServiceScope(root, InheritedLayout, { ownerRoutePath: '/layout.ts' });
    const inner = createLayoutServiceScope(outer, NestedLayout, { ownerRoutePath: '/nested/layout.ts' });
    const a = createInstance(Consumer, { serviceScope: outer });
    const b = createInstance(Consumer, { serviceScope: inner });
    expect(outer.getSlot(Counter)).toBe('1');
    expect(inner.getSlot(Counter)).toBe('0');
    expect(outer.getOwnerScope(Counter)).toBe(outer);
    expect(inner.getOwnerScope(Counter)).toBe(inner);
    expect(a.property).toBe(a.dependency);
    expect(b.property).toBe(b.dependency);
    expect(a.property).not.toBe(b.property);
    expect(inner.describeScopeChain()).toEqual([
      '  - /nested/layout.ts declares [Counter]',
      '  - /layout.ts declares [Other, Counter]',
      '  - request root scope (no service declarations)',
    ]);
    await root.disposeAsync();
  });

  it('keeps constructor dependency facilities with their declaring ancestor during overlapping async work', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const disposed: string[] = [];
    @Service()
    class RequestFacility extends CossackService<{ tenant: string }> {
      snapshot() { return { user: this.user?.id, tenant: this.env.tenant, path: this.c.req.path }; }
      async run() { const before = this.snapshot(); await gate; return [before, this.snapshot()]; }
      onDispose() { disposed.push(this.env.tenant); }
    }
    @Service()
    class ConsumerService { constructor(public facility: RequestFacility) {} }
    Reflect.defineMetadata('design:paramtypes', [RequestFacility], ConsumerService);
    @Page({ services: [RequestFacility] })
    class Outer extends Cossack {}
    @Page({ services: [ConsumerService] })
    class Inner extends Cossack {}
    const make = (id: string) => {
      const root = createRootServiceScope();
      root.bindRequest({ context: { req: { path: `/${id}` } } as unknown as Context, user: { id }, env: { tenant: id } });
      const outer = createLayoutServiceScope(root, Outer);
      const inner = createLayoutServiceScope(outer, Inner);
      const consumer = inner.resolveDeclared(ConsumerService);
      expect(consumer.facility).toBe(outer.resolveDeclared(RequestFacility));
      expect(inner.getOwnerScope(RequestFacility)).toBe(outer);
      return { root, consumer };
    };
    const first = make('first');
    const second = make('second');
    expect(first.consumer.facility).not.toBe(second.consumer.facility);
    const pending = [first.consumer.facility.run(), second.consumer.facility.run()];
    release();
    expect(await Promise.all(pending)).toEqual(['first', 'second'].map(id => Array(2).fill({ user: id, tenant: id, path: `/${id}` })));
    await Promise.all([first.root.disposeAsync(), second.root.disposeAsync()]);
    expect(disposed.sort()).toEqual(['first', 'second']);
  });
});
