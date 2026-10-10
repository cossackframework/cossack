/** Shared fetches have independent, bounded consumers (navigation or prefetch). */
export class SharedPageRequests<T> {
  private entries = new Map<string, { controller: AbortController; promise: Promise<T>; readers: number }>();

  constructor(private readonly timeoutMs = 30_000) {}

  has(key: string): boolean { return this.entries.has(key); }

  // Invalidation detaches existing work without changing its readers' result.
  clear(): void { this.entries.clear(); }

  read(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, readers: 0, promise: Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(controller.signal);
      }) };
      this.entries.set(key, entry);
      const owned = entry;
      const remove = () => { if (this.entries.get(key) === owned) this.entries.delete(key); };
      void entry.promise.then(remove, remove);
    }
    const owned = entry;
    owned.readers++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (success: boolean, value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (--owned.readers === 0) {
          if (this.entries.get(key) === owned) this.entries.delete(key);
          owned.controller.abort();
        }
        if (success) resolve(value as T); else reject(value);
      };
      const cancel = () => finish(false, signal?.reason);
      const timer = setTimeout(() => finish(false, Object.assign(
        new Error('[Cossack] Page response exceeded its 30-second deadline.'),
        { code: 'COSSACK_NAVIGATION_FETCH_TIMEOUT' },
      )), this.timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      // Observe late failure even when every reader has already left.
      void owned.promise.then(value => finish(true, value), error => finish(false, error));
    });
  }
}
