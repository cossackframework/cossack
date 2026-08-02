import type { ScopeStorage } from "./types.js";

export interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined;
  run<R>(value: T, callback: () => R): R;
}

export function createAsyncLocalScope<T>(
  storage: AsyncLocalStorageLike<T>,
): ScopeStorage<T> {
  return {
    get: () => storage.getStore(),
    run: (value, callback) => storage.run(value, callback),
  };
}
