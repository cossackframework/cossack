export interface DenoShutdownServer {
  /** Stop admitting connections and drain HTTP responses and runtime cleanup. */
  shutdown(): Promise<void>;
  /** Abort the HTTP listener and outstanding connections at the deadline. */
  forceShutdown(): void;
}

export interface DenoShutdownResult {
  forced: boolean;
  cleanupCompleted: boolean;
  cleanupFailed: boolean;
}

export interface DenoShutdownOptions {
  /** One deadline for accepted requests and runtime cleanup. Default: 10 seconds. */
  timeoutMs?: number;
  /** Choose process exit policy explicitly; importing the adapter never exits. */
  onComplete?: (result: DenoShutdownResult) => void;
}

/** Explicit standalone process ownership. Embedded applications keep their own signals. */
export function installDenoShutdown(server: DenoShutdownServer, options: DenoShutdownOptions = {}) {
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('Shutdown timeout must be positive and finite');
  const deno = (globalThis as unknown as { Deno?: Pick<typeof Deno, 'addSignalListener' | 'removeSignalListener'> }).Deno;
  if (!deno) throw new Error('installDenoShutdown() requires Deno');
  let completion: Promise<DenoShutdownResult> | undefined;
  const uninstall = () => {
    deno.removeSignalListener('SIGTERM', signalled);
    deno.removeSignalListener('SIGINT', signalled);
  };
  const shutdown = (): Promise<DenoShutdownResult> => completion ??= (async () => {
    let cleanupCompleted = false, cleanupFailed = false;
    const cleanup = Promise.resolve().then(() => server.shutdown()).then(
      () => { cleanupCompleted = true; },
      () => { cleanupCompleted = true; cleanupFailed = true; },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const forced = await Promise.race([
      cleanup.then(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), timeout); }),
    ]);
    clearTimeout(timer);
    try {
      if (forced) server.forceShutdown();
    } finally {
      uninstall();
    }
    const result = { forced, cleanupCompleted, cleanupFailed };
    options.onComplete?.(result);
    return result;
  })();
  const signalled = () => { void shutdown(); };
  deno.addSignalListener('SIGTERM', signalled);
  try { deno.addSignalListener('SIGINT', signalled); }
  catch (error) { deno.removeSignalListener('SIGTERM', signalled); throw error; }
  return { shutdown, uninstall };
}
