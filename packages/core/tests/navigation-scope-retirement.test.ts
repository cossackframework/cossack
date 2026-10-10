import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { Service } from '../src/shared/decorators';
import { ServiceScope } from '../src/shared/service-scope';

function component(scope: ServiceScope, owns = false) {
    class Component extends Cossack {}
    const instance = new Component();
    (instance as any).isServer = false;
    instance._setServiceScope(scope, owns);
    return instance;
}

it('keeps navigation scopes and ancestors alive through DOM detachment and async child cleanup', async () => {
    const disposed = vi.fn();
    @Service() class Resource { onDispose() { disposed(); } }
    const outer = new ServiceScope(undefined, [Resource]);
    const inner = new ServiceScope(outer, [Resource]);
    const outerOwner = component(outer, true);
    const innerOwner = component(inner, true);
    const child = component(inner);
    child._frameworkRendererAttached();
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    child.onCleanup = () => cleanup;
    const task = new AbortController();
    (child as any)._taskExecutions.set('pending', task);
    outerOwner._frameworkRetireNavigationScope();
    innerOwner._frameworkRetireNavigationScope();
    const completions = [child.destroyAsync(), innerOwner.destroyAsync(), outerOwner.destroyAsync()];
    expect(task.signal.aborted).toBe(true);
    expect(disposed).not.toHaveBeenCalled();
    expect(inner.resolveDeclared(Resource)).toBeDefined();
    child._frameworkRendererDetached();
    await Promise.resolve();
    expect(disposed).not.toHaveBeenCalled();
    release();
    await Promise.all(completions);
    expect(disposed).toHaveBeenCalledTimes(2);
    child._frameworkRendererDetached();
    expect(disposed).toHaveBeenCalledTimes(2);
});

it('does not create a self-wait when a DOM consumer also owns its scope', async () => {
    const disposed = vi.fn();
    @Service() class Resource { onDispose() { disposed(); } }
    const scope = new ServiceScope(undefined, [Resource]);
    const owner = component(scope, true);
    owner._frameworkRendererAttached();
    owner._frameworkRetireNavigationScope();
    const completion = owner.destroyAsync();
    expect(disposed).not.toHaveBeenCalled();
    owner._frameworkRendererDetached();
    await completion;
    expect(disposed).toHaveBeenCalledOnce();
});

it('keeps a successfully retired scope alive when DOM detachment precedes async child cleanup', async () => {
    const disposed = vi.fn();
    @Service() class Resource { onDispose() { disposed(); } }
    const scope = new ServiceScope(undefined, [Resource]);
    const owner = component(scope, true);
    const child = component(scope);
    child._frameworkRendererAttached();
    let finish!: () => void;
    child.onCleanup = () => new Promise<void>(resolve => { finish = resolve; });
    const childCompletion = child.destroyAsync();
    child._frameworkRendererDetached();
    owner._frameworkRetireNavigationScope();
    const ownerCompletion = owner.destroyAsync();
    await Promise.resolve();
    expect(disposed).not.toHaveBeenCalled();
    finish();
    await Promise.all([childCompletion, ownerCompletion]);
    expect(disposed).toHaveBeenCalledOnce();
});

it('rejects new renderer attachments to a retiring scope', async () => {
    const scope = new ServiceScope();
    const owner = component(scope, true);
    owner._frameworkRetireNavigationScope();
    const late = component(scope);
    expect(() => late._frameworkRendererAttached()).toThrow('retiring navigation scope');
    await owner.destroyAsync();
    late.destroy();
});

it('preserves ordinary explicit destruction without a navigation retirement hold', async () => {
    const disposed = vi.fn();
    @Service() class Resource { onDispose() { disposed(); } }
    const scope = new ServiceScope(undefined, [Resource]);
    const owner = component(scope, true);
    owner._frameworkRendererAttached();
    await owner.destroyAsync();
    expect(disposed).toHaveBeenCalledOnce();
    owner._frameworkRendererDetached();
});
