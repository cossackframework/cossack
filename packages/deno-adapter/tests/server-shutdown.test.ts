import { afterEach, expect, it, vi } from 'vitest';
vi.mock('hono/deno', () => ({ serveStatic: () => async (_c: unknown, next: () => Promise<void>) => next(), upgradeWebSocket: vi.fn() }));
import { createDenoAdapter, installDenoShutdown } from '../src/index';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('passes a native abort signal and uses it only when graceful HTTP draining exceeds the deadline', async () => {
  vi.useFakeTimers();
  let nativeSignal!: AbortSignal;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const nativeShutdown = vi.fn(() => finished);
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('Deno', {
    addSignalListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeSignalListener: (name: string) => listeners.delete(name),
    serve(options: { signal: AbortSignal }) {
      nativeSignal = options.signal;
      nativeSignal.addEventListener('abort', finish);
      return { finished, shutdown: nativeShutdown };
    },
  });
  const runtime = createDenoAdapter();
  const server = runtime.serve({ fetch: () => new Response('ok') });
  const owner = installDenoShutdown(server, { timeoutMs: 50 });
  listeners.get('SIGTERM')!();
  const result = owner.shutdown();
  await vi.advanceTimersByTimeAsync(49);
  expect(nativeShutdown).toHaveBeenCalledTimes(1);
  expect(nativeSignal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ forced: true, cleanupCompleted: false, cleanupFailed: false });
  expect(nativeSignal.aborted).toBe(true);
  expect(listeners.size).toBe(0);
  await server.finished;
  await expect(runtime.dispose()).resolves.toBeUndefined();
});

it('awaits graceful native HTTP completion without aborting and shares runtime disposal', async () => {
  let nativeSignal!: AbortSignal;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const nativeShutdown = vi.fn(() => finished);
  vi.stubGlobal('Deno', {
    addSignalListener: vi.fn(), removeSignalListener: vi.fn(),
    serve(options: { signal: AbortSignal }) {
      nativeSignal = options.signal;
      return { finished, shutdown: nativeShutdown };
    },
  });
  const runtime = createDenoAdapter();
  const server = runtime.serve({ fetch: () => new Response('ok') });
  const result = installDenoShutdown(server).shutdown();
  await Promise.resolve();
  finish();
  expect(await result).toEqual({ forced: false, cleanupCompleted: true, cleanupFailed: false });
  expect(nativeSignal.aborted).toBe(false);
  expect(nativeShutdown).toHaveBeenCalledTimes(1);
  await server.finished;
  expect(runtime.dispose()).toBe(runtime.dispose());
});
