import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

// Minimal DurableObject base and SQLite-backed storage so the coordinator's
// long-poll contract runs under Node. Native workerd coverage lives in
// packages/cossack/tests/sse-coordinator-integration.test.js.
vi.mock('cloudflare:workers', () => ({
    DurableObject: class { constructor(public ctx: any, public env: any) {} },
}));

const { SseDurableObject, SSE_MAX_WAIT_MS, SSE_MAX_WAITERS } = await import('../src/SseDurableObject');

function createObject() {
    const db = new DatabaseSync(':memory:');
    const sql = {
        exec(query: string, ...params: unknown[]) {
            const statement = db.prepare(query);
            const reader = /^\s*(SELECT|INSERT[\s\S]*RETURNING)/i.test(query);
            const rows = reader ? statement.all(...(params as any[])) : [];
            const info = reader ? { changes: rows.length } : statement.run(...(params as any[]));
            return { toArray: () => rows, one: () => rows[0], rowsWritten: Number(info.changes) };
        },
    };
    const ctx = {
        id: { name: '["route","scope"]' },
        storage: { sql, transactionSync: (fn: () => void) => fn() },
        blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    };
    const object = new SseDurableObject(ctx as any, {} as any);
    object.initialize('{"count":0}');
    return object;
}

describe('SseDurableObject long-poll updates()', () => {
    it('returns immediately without a wait (non-blocking callers)', async () => {
        const object = createObject();
        const result = await object.updates(0);
        expect(result.events).toEqual([]);
        expect(object.waiterCount()).toBe(0);
    });

    it('holds the call until an event is appended, then resolves the waiter', async () => {
        const object = createObject();
        let settled = false;
        const pending = object.updates(0, 20_000, 'w1').then(result => { settled = true; return result; });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(settled).toBe(false);
        expect(object.waiterCount()).toBe(1);
        object.publish('{"count":1}');
        const result = await pending;
        expect(result.events.map(event => JSON.parse(event.data))).toEqual([{ count: 1 }]);
        expect(object.waiterCount()).toBe(0);
    });

    it('returns pending events without waiting', async () => {
        const object = createObject();
        object.broadcast('event', '{"x":1}');
        const result = await object.updates(0, 20_000, 'w1');
        expect(result.events).toHaveLength(1);
        expect(object.waiterCount()).toBe(0);
    });

    it('times out empty at the capped wait and supports cancellation', async () => {
        vi.useFakeTimers();
        try {
            const object = createObject();
            const capped = object.updates(0, 10 * 60_000, 'capped');
            await vi.advanceTimersByTimeAsync(SSE_MAX_WAIT_MS);
            expect((await capped).events).toEqual([]);
            expect(object.waiterCount()).toBe(0);

            const cancelled = object.updates(0, 20_000, 'cancel-me');
            expect(object.waiterCount()).toBe(1);
            object.cancelWait('cancel-me');
            expect((await cancelled).events).toEqual([]);
            expect(object.waiterCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('bounds waiters and asks the overflow to retry later', async () => {
        vi.useFakeTimers();
        try {
            const object = createObject();
            const held = Array.from({ length: SSE_MAX_WAITERS }, (_, i) => object.updates(0, 20_000, `w${i}`));
            expect(object.waiterCount()).toBe(SSE_MAX_WAITERS);
            const overflow = await object.updates(0, 20_000, 'overflow');
            expect(overflow.retryAfterMs).toBeGreaterThan(0);
            expect(object.waiterCount()).toBe(SSE_MAX_WAITERS);
            object.broadcast('event', '{"x":1}');
            for (const result of await Promise.all(held)) expect(result.events).toHaveLength(1);
            expect(object.waiterCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('replaces a duplicate waiter ID instead of leaking the first', async () => {
        const object = createObject();
        const first = object.updates(0, 20_000, 'dup');
        const second = object.updates(0, 20_000, 'dup');
        expect((await first).events).toEqual([]);
        expect(object.waiterCount()).toBe(1);
        object.cancelWait('dup');
        await second;
        expect(object.waiterCount()).toBe(0);
    });
});
