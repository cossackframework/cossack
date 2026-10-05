import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { createInstance } from '../src/shared/container';
import { Inject, Service, State, Task } from '../src/shared/decorators';
import { ServiceScope } from '../src/shared/service-scope';

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

afterEach(() => vi.restoreAllMocks());

describe('awaitable cleanup', () => {
  it('waits for child hooks started by an earlier synchronous disposal, exactly once', async () => {
    const released = gate();
    const finished = vi.fn();
    @Service()
    class Resource {
      async onDispose() { await released.promise; finished(); }
    }
    const root = new ServiceScope();
    const child = new ServiceScope(root, [Resource]);
    child.dispose();
    let completed = false;
    const disposing = root.disposeAsync().then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    released.open();
    await disposing;
    await child.disposeAsync();
    root.dispose();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('collects synchronous and asynchronous service failures while disposing siblings', async () => {
    const finished = vi.fn();
    const syncFailure = new Error('sync resource');
    const asyncFailure = new Error('async resource');
    @Service()
    class First { onDispose() { throw syncFailure; } }
    @Service()
    class Second { async onDispose() { throw asyncFailure; } }
    @Service()
    class Third { onDispose() { finished(); } }
    const scope = new ServiceScope(undefined, [First, Second, Third]);
    const failure = await scope.disposeAsync().catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.map((error: Error) => error.cause)).toEqual([syncFailure, asyncFailure]);
    expect(finished).toHaveBeenCalledTimes(1);
    await expect(scope.disposeAsync()).rejects.toBeInstanceOf(AggregateError);
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it('cleans already-created services when a later service constructor throws', async () => {
    const released = gate();
    const calls: string[] = [];
    const constructionFailure = new Error('service construction failed');
    @Service()
    class First {
      async onDispose() {
        calls.push('dispose:start');
        await released.promise;
        calls.push('dispose:end');
      }
    }
    @Service()
    class Broken {
      constructor() { throw constructionFailure; }
    }

    const root = new ServiceScope();
    expect(() => new ServiceScope(root, [First, Broken], { ownerRoutePath: '/src/pages/layout.ts' }))
      .toThrow(constructionFailure);
    const rootDisposal = root.disposeAsync();
    await Promise.resolve();
    expect(calls).toEqual(['dispose:start']);
    released.open();
    await rootDisposal;
    expect(calls).toEqual(['dispose:start', 'dispose:end']);
  });

  it('destroys descendants and awaits their hooks when synchronous destroy ran first', async () => {
    const released = gate();
    const childCleanup = vi.fn();
    const parentCleanup = vi.fn();
    class Child extends Cossack {
      async onCleanup() { await released.promise; childCleanup(); }
    }
    class Parent extends Cossack { onCleanup() { parentCleanup(); } }
    const parent = new Parent();
    parent.activeComponents.set('child', new Child());
    parent.destroy();
    let completed = false;
    const destroying = parent.destroyAsync().then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(parent.activeComponents.size).toBe(0);
    released.open();
    await destroying;
    await parent.destroyAsync();
    expect(childCleanup).toHaveBeenCalledTimes(1);
    expect(parentCleanup).toHaveBeenCalledTimes(1);
  });

  it('disposes all server descendants replaced under the same render ID', async () => {
    const cleaned: number[] = [];
    class Child extends Cossack {
      constructor(private readonly generation: number) { super(); }
      onCleanup() { cleaned.push(this.generation); }
    }
    class Parent extends Cossack { protected isServer = true; }
    const parent = new Parent();
    const first = new Child(1);
    const second = new Child(2);
    first._id = second._id = 'stable-child-id';
    parent.registerComponent(first);
    parent.registerComponent(second);
    expect(parent.activeComponents.get('stable-child-id')).toBe(second);
    await parent.destroyAsync();
    await parent.destroyAsync();
    expect(cleaned).toEqual([1, 2]);
  });

  it('keeps owned services alive for asynchronous component cleanup', async () => {
    const released = gate();
    const calls: string[] = [];
    @Service()
    class Resource {
      @State() value = 'available';
      async onDispose() { await Promise.resolve(); calls.push('service:disposed'); }
    }
    class Layout extends Cossack {
      @Inject(Resource) resource!: Resource;
      async onCleanup() {
        await released.promise;
        calls.push(`layout:${this.resource.value}`);
      }
    }
    const scope = new ServiceScope(undefined, [Resource]);
    const layout = createInstance(Layout, { serviceScope: scope, ownsServiceScope: true });
    const destroying = layout.destroyAsync();
    expect(calls).toEqual([]);
    released.open();
    await destroying;
    expect(calls).toEqual(['layout:available', 'service:disposed']);
  });

  it('releases subscriptions and services even if the component hook throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const disposed = vi.fn();
    @Service()
    class Resource {
      @State() value = 0;
      onDispose() { disposed(); }
    }
    const primaryFailure = new Error('component hook');
    class Layout extends Cossack {
      @Inject(Resource) resource!: Resource;
      onCleanup() { throw primaryFailure; }
    }
    const scope = new ServiceScope(undefined, [Resource]);
    const layout = createInstance(Layout, { serviceScope: scope, ownsServiceScope: true });
    const resource = layout.resource;
    const update = vi.spyOn(layout, 'requestUpdate');
    await expect(layout.destroyAsync()).rejects.toMatchObject({ errors: [primaryFailure] });
    resource.value++;
    expect(update).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('awaits registered asynchronous task cleanup without delaying synchronous task execution', async () => {
    const released = gate();
    const finished = vi.fn();
    class Worker extends Cossack {
      calls = 0;
      @Task()
      task() {
        this.calls++;
        return async () => { await released.promise; finished(); };
      }
    }
    const worker = new Worker();
    worker._render();
    expect(worker.calls).toBe(1);
    let completed = false;
    const destroying = worker.destroyAsync().then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    released.open();
    await destroying;
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
