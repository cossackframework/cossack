import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'hono';
vi.mock('../src/shared/environment', () => ({ isServer: true }));
const { Cossack } = await import('../src/shared/cossack');
const { createInstance, resetContainer } = await import('../src/shared/container');
const { Page, Server, Service, State, Store } = await import('../src/shared/decorators');
const { createLayoutServiceScope, createRootServiceScope } = await import('../src/shared/service-scope');

afterEach(() => resetContainer());
const props = () => ({ context: new Context(new Request('http://localhost/')) as any });

describe('global singleton services with client-writable state', () => {
  it('rejects a constructor-injected singleton service that declares @State or @Store', async () => {
    @Service()
    class Counter { @State() count = 0; @Server() increment() { this.count++; } }
    @Service({ scope: 'singleton' })
    class Draft { @Store() form = { name: '' }; }
    for (const Dependency of [Counter, Draft]) {
      class Consumer extends Cossack { constructor(public dependency: unknown) { super(); } }
      Reflect.defineMetadata('design:paramtypes', [Dependency], Consumer);
      const root = createRootServiceScope();
      const consumer = createInstance(Consumer, { serviceScope: root });
      await expect(consumer.bootstrap(props())).rejects.toThrow(
        new RegExp(`${Dependency.name} is a global singleton service with @State/@Store .*@Page\\(\\{ services: \\[${Dependency.name}\\] \\}\\)`));
      await root.disposeAsync();
    }
  });

  it('keeps transient and layout-declared stateful services working', async () => {
    @Service({ scope: 'transient' })
    class PerComponent { @State() count = 1; }
    @Service()
    class Declared { @State() count = 2; }
    class TransientConsumer extends Cossack { constructor(public dependency: PerComponent) { super(); } }
    Reflect.defineMetadata('design:paramtypes', [PerComponent], TransientConsumer);
    class DeclaredConsumer extends Cossack { constructor(public dependency: Declared) { super(); } }
    Reflect.defineMetadata('design:paramtypes', [Declared], DeclaredConsumer);
    @Page({ services: [Declared] })
    class Layout extends Cossack {}
    const root = createRootServiceScope();
    const transient = createInstance(TransientConsumer, { serviceScope: root });
    await transient.bootstrap(props());
    expect(transient.dependency.count).toBe(1);
    const declared = createInstance(DeclaredConsumer, { serviceScope: createLayoutServiceScope(root, Layout, { ownerRoutePath: '/layout.ts' }) });
    await declared.bootstrap(props());
    expect(declared.dependency.count).toBe(2);
    await root.disposeAsync();
  });
});
