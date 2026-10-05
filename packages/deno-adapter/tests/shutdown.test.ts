import { afterEach, expect, it, vi } from 'vitest';
import { installDenoShutdown } from '../src/shutdown';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function signals() {
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('Deno', {
    addSignalListener: vi.fn((name: string, callback: () => void) => listeners.set(name, callback)),
    removeSignalListener: vi.fn((name: string) => listeners.delete(name)),
  });
  return listeners;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('installs no signals on import and rejects invalid deadlines before taking ownership', () => {
  const listeners = signals();
  const server = { shutdown: vi.fn(async () => {}), forceShutdown: vi.fn() };
  for (const timeoutMs of [0, -1, Infinity, NaN]) {
    expect(() => installDenoShutdown(server, { timeoutMs })).toThrow('positive and finite');
  }
  expect(listeners.size).toBe(0);
});

it('shares one drain between repeated SIGTERM/SIGINT and explicit shutdown', async () => {
  const listeners = signals();
  const drain = deferred();
  const server = { shutdown: vi.fn(() => drain.promise), forceShutdown: vi.fn() };
  const onComplete = vi.fn();
  const owner = installDenoShutdown(server, { onComplete });
  listeners.get('SIGTERM')!();
  listeners.get('SIGINT')!();
  const first = owner.shutdown();
  expect(owner.shutdown()).toBe(first);
  await Promise.resolve();
  expect(server.shutdown).toHaveBeenCalledTimes(1);
  expect(onComplete).not.toHaveBeenCalled();
  drain.resolve();
  expect(await first).toEqual({ forced: false, cleanupCompleted: true, cleanupFailed: false });
  expect(server.forceShutdown).not.toHaveBeenCalled();
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(0);
});

it('bounds outstanding requests and cleanup together and observes late failure', async () => {
  vi.useFakeTimers();
  const listeners = signals();
  const drain = deferred();
  const server = { shutdown: vi.fn(() => drain.promise), forceShutdown: vi.fn() };
  const owner = installDenoShutdown(server, { timeoutMs: 30 });
  const pending = owner.shutdown();
  await vi.advanceTimersByTimeAsync(30);
  const result = await pending;
  expect(result).toEqual({ forced: true, cleanupCompleted: false, cleanupFailed: false });
  expect(server.forceShutdown).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(0);
  drain.reject(new Error('late ignored work'));
  await Promise.resolve();
  expect(await owner.shutdown()).toBe(result);
  expect(result.cleanupCompleted).toBe(false);
});

it('reports rejected runtime cleanup without leaking private exceptions', async () => {
  signals();
  const onComplete = vi.fn();
  const owner = installDenoShutdown({
    shutdown: async () => { throw new Error('PRIVATE_CLEANUP'); },
    forceShutdown: vi.fn(),
  }, { onComplete });
  expect(await owner.shutdown()).toEqual({ forced: false, cleanupCompleted: true, cleanupFailed: true });
  expect(JSON.stringify(onComplete.mock.calls)).not.toContain('PRIVATE_CLEANUP');
});

it('uninstalls ownership without shutting down an embedded server', () => {
  const listeners = signals();
  const server = { shutdown: vi.fn(async () => {}), forceShutdown: vi.fn() };
  installDenoShutdown(server).uninstall();
  expect(listeners.size).toBe(0);
  expect(server.shutdown).not.toHaveBeenCalled();
});

it('rolls back the first listener when a platform rejects the second signal', () => {
  const removeSignalListener = vi.fn();
  vi.stubGlobal('Deno', {
    addSignalListener(name: string) { if (name === 'SIGINT') throw new Error('unsupported'); },
    removeSignalListener,
  });
  expect(() => installDenoShutdown({ shutdown: async () => {}, forceShutdown() {} })).toThrow('unsupported');
  expect(removeSignalListener).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
});
