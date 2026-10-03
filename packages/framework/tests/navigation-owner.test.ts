import { afterEach, expect, it, vi } from 'vitest';
import { NavigationOwner } from '../src/client/navigation-owner';

afterEach(() => vi.useRealTimers());

it('revokes waiting and publication together after the deadline', async () => {
  vi.useFakeTimers();
  const owner = new NavigationOwner();
  const result = owner.wait(new Promise<void>(() => {}));
  const failure = expect(result).rejects.toMatchObject({ code: 'COSSACK_NAVIGATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(30_000);
  await failure;
  expect(() => owner.assertCurrent()).toThrow('deadline');
  owner.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('observes ignored work rejecting after supersession', async () => {
  const owner = new NavigationOwner();
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_yes, no) => { reject = no; });
  const result = owner.wait(pending);
  owner.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  reject(new Error('late failure'));
  await Promise.resolve();
  await expect(owner.wait(Promise.resolve('late'))).rejects.toMatchObject({ name: 'AbortError' });
});

it('clears the deadline after completed work', async () => {
  vi.useFakeTimers();
  const owner = new NavigationOwner();
  await expect(owner.wait(Promise.resolve('ready'))).resolves.toBe('ready');
  owner.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
