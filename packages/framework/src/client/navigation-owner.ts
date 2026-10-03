/** One navigation's completion budget and authority to publish. */
export class NavigationOwner {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly timer = setTimeout(() => this.controller.abort(Object.assign(
    new Error('[Cossack] Navigation exceeded its 30-second deadline.'),
    { code: 'COSSACK_NAVIGATION_TIMEOUT' },
  )), 30_000);

  abort(): void { this.controller.abort(); this.dispose(); }
  dispose(): void { clearTimeout(this.timer); }
  assertCurrent(): void { this.signal.throwIfAborted(); }

  wait<T>(work: PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cancel = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', cancel, { once: true });
      // Always observe work, including when it rejected just before cancellation.
      Promise.resolve(work).then(resolve, reject).finally(() => {
        this.signal.removeEventListener('abort', cancel);
      });
      if (this.signal.aborted) cancel();
    });
  }
}
