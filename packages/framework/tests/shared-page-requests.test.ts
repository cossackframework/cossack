import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedPageRequests } from '../src/client/shared-page-requests';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

describe('shared page request ownership', () => {
  it('keeps a prefetch alive when its navigation reader leaves', async () => {
    const requests = new SharedPageRequests<string>();
    const pending = deferred<string>();
    let underlying!: AbortSignal;
    const load = vi.fn((signal: AbortSignal) => { underlying = signal; return pending.promise; });
    const prefetch = requests.read('/page', load);
    const controller = new AbortController();
    const navigation = requests.read('/page', load, controller.signal);
    const canceled = expect(navigation).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort();
    await canceled;
    expect(underlying.aborted).toBe(false);
    pending.resolve('page');
    await expect(prefetch).resolves.toBe('page');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('settles abandonment even if the underlying operation ignores abort', async () => {
    const requests = new SharedPageRequests<string>();
    const pending = deferred<string>();
    let underlying!: AbortSignal;
    const owner = new AbortController();
    const result = requests.read('/page', signal => { underlying = signal; return pending.promise; }, owner.signal);
    const canceled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    owner.abort();
    await canceled;
    expect(underlying.aborted).toBe(true);
    await expect(requests.read('/page', async () => 'new')).resolves.toBe('new');
    pending.reject(new Error('late failure is observed'));
  });

  it('bounds each reader independently and aborts after the last deadline', async () => {
    vi.useFakeTimers();
    const requests = new SharedPageRequests<string>();
    let underlying!: AbortSignal;
    const load = vi.fn((signal: AbortSignal) => { underlying = signal; return new Promise<string>(() => {}); });
    const first = requests.read('/page', load);
    const firstFailure = expect(first).rejects.toMatchObject({ code: 'COSSACK_NAVIGATION_FETCH_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    const second = requests.read('/page', load);
    const secondFailure = expect(second).rejects.toMatchObject({ code: 'COSSACK_NAVIGATION_FETCH_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20_000);
    await firstFailure;
    expect(underlying.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await secondFailure;
    expect(underlying.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('detaches invalidated work without letting old completion remove its replacement', async () => {
    const requests = new SharedPageRequests<string>();
    const old = deferred<string>();
    const fresh = deferred<string>();
    const first = requests.read('/page', () => old.promise);
    requests.clear();
    const load = vi.fn(() => fresh.promise);
    const second = requests.read('/page', load);
    old.resolve('old');
    await expect(first).resolves.toBe('old');
    const third = requests.read('/page', load);
    fresh.resolve('new');
    expect(await Promise.all([second, third])).toEqual(['new', 'new']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not start work for an already canceled reader', async () => {
    const requests = new SharedPageRequests<string>();
    const owner = new AbortController();
    owner.abort();
    const load = vi.fn(async () => 'page');
    await expect(requests.read('/page', load, owner.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).not.toHaveBeenCalled();
  });

  it('clears timers and permits retry after synchronous loader failure', async () => {
    vi.useFakeTimers();
    const requests = new SharedPageRequests<string>();
    await expect(requests.read('/page', () => { throw new Error('broken'); })).rejects.toThrow('broken');
    await expect(requests.read('/page', async () => 'retried')).resolves.toBe('retried');
    expect(vi.getTimerCount()).toBe(0);
  });
});
