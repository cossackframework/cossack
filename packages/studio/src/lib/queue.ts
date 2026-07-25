export class OperationQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Studio connection is closed.'));
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async close(operation: () => Promise<void>): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.tail;
    await operation();
  }
}
