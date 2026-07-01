// src/als.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { setDbStoreGetter } from './store';
import type { DbClient } from './types';

const dbAls = new AsyncLocalStorage<DbClient>();

let wired = false;

/**
 * One-time wiring of the AsyncLocalStorage store-getter into the global
 * {@link db} helper. Idempotent.
 */
export function ensureDbAlsWired(): void {
    if (wired) return;
    setDbStoreGetter(() => dbAls.getStore());
    wired = true;
}

/**
 * Runs `fn` inside a database scope. Any call to {@link db} inside `fn`
 * (or its async descendants) resolves to `client`.
 *
 * Used by the database middleware to wrap each request, and by standalone
 * scripts (seeders, tests) that need the global `db()` helper.
 */
export function runWithDb<T>(client: DbClient, fn: () => T | Promise<T>): T | Promise<T> {
    return dbAls.run(client, fn as () => T);
}
