import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { Page } from '../src/shared/decorators';
import { StateProvider } from '../src/shared/StateProvider';
class Provider extends StateProvider {
  getConnectionTarget = vi.fn(() => { throw new Error('Cloudflare binding required'); });
}
@Page({ transport: 'durable-object' })
class Live extends Cossack {
  provider = new Provider();
  constructor() { super(); this.providers = new Map([['page', this.provider]]); }
}
it('uses router-supplied provider targets without accessing platform bindings', async () => {
  const instance = new Live();
  await instance.bootstrap({ page: '/live', providerTargets: { page: 'user:trusted' } });
  expect(instance.getInitialState().providerTargets).toEqual({ page: 'user:trusted' });
  expect(instance.provider.getConnectionTarget).not.toHaveBeenCalled();
  await instance.destroyAsync();
});
it('still resolves providers when the router has not supplied a target', async () => {
  const instance = new Live();
  await instance.bootstrap({ page: '/live' });
  expect(() => instance.getInitialState()).toThrow('Cloudflare binding required');
  await instance.destroyAsync();
});
