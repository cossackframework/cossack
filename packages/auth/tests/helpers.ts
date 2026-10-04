import { vi, type Mock } from 'vitest';
import type { OAuthStateRecord, OAuthStateStore } from '../src/index';

/** Fixture only: synchronous Map deletion models the atomic boundary in one process. */
export function memoryOAuthStates() {
    const rows = new Map<string, OAuthStateRecord>();
    const store: OAuthStateStore = {
        create: vi.fn(async record => {
            if (rows.has(record.key)) throw new Error('Duplicate fixture state');
            rows.set(record.key, record);
        }),
        consume: vi.fn(async (key, provider, now) => {
            const record = rows.get(key);
            if (!record || record.provider !== provider || record.expiresAt <= now) return false;
            rows.delete(key); return true;
        }),
    };
    return { store, rows };
}

/**
 * A single mocked fetch response.
 */
export interface MockResponse {
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
}

/**
 * Install a mocked `globalThis.fetch` that returns the provided responses in
 * order (one per call). Returns the underlying mock for assertions.
 *
 * Pass an array to queue multiple responses; the last one is reused for any
 * extra calls.
 */
export function mockFetch(responses: MockResponse | MockResponse[]): Mock {
    const queue = Array.isArray(responses) ? [...responses] : [responses];
    const fallback = queue[queue.length - 1];
    const mock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
        const next = queue.shift() ?? fallback;
        const status = next.status ?? 200;
        const headers = new Headers(next.headers ?? { 'Content-Type': 'application/json' });
        const body =
            typeof next.body === 'string'
                ? next.body
                : JSON.stringify(next.body ?? {});
        return new Response(body, { status, headers });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

export function restoreFetch(): void {
    vi.unstubAllGlobals();
}
