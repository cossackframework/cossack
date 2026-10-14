import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'hono';
vi.mock('../src/shared/environment', () => ({ isServer: true }));
const { Cossack } = await import('../src/shared/cossack');
const { Page, State } = await import('../src/shared/decorators');
const { setPublicUserProjection } = await import('../src/shared/user');
const { DurableObjectRuntime } = await import('../src/shared/runtimes/durable-object');

const user = { id: 'u1', email: 'taras@example.com', passwordHash: 'SECRET' } as any;
@Page({ transport: 'durable-object', stateful: true })
class Live extends Cossack { @State() count = 3; }

async function live() {
  const component = new Live();
  await component.bootstrap({ context: new Context(new Request('http://localhost/live')) as any, user, page: '/live', providerTargets: { page: 'target' }, skipInit: true } as any);
  return component;
}
afterEach(() => setPublicUserProjection(undefined));

describe('user in serialized component state', () => {
  it('serializes only the id by default and an opted-in projection with the real id', async () => {
    const component = await live();
    expect(component.getInitialState().metadata?.user).toEqual({ id: 'u1' });
    setPublicUserProjection(u => ({ email: (u as any).email, id: 'forged' }));
    expect(component.getInitialState().metadata?.user).toEqual({ id: 'u1', email: 'taras@example.com' });
  });

  it('never persists a user into Durable Object storage', async () => {
    const component = await live();
    const put = vi.fn();
    const runtime = new DurableObjectRuntime(component, { storage: { put } } as any, true);
    await runtime.persistState();
    const persisted = put.mock.calls[0]![1];
    expect(persisted.public).toEqual({ count: 3 });
    expect(persisted.metadata).not.toHaveProperty('user');
    expect(JSON.stringify(persisted)).not.toContain('SECRET');
  });
});
