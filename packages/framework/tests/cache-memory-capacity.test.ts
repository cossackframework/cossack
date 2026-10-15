import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCacheStore } from '../src/cache';

const encoder = new TextEncoder();

/**
 * The store before writes at capacity became amortised O(1): a `Map` in recency
 * order, every expired entry pruned by a full scan, then least recently used
 * entries evicted. The linked store must make the same observable decisions.
 */
class ScanningStore {
    private readonly entries = new Map<string, { raw: string; expiresAt?: number; bytes: number }>();
    private bytes = 0;
    constructor(private readonly maxEntries: number, private readonly maxBytes: number) {}

    get(key: string): unknown {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) { this.remove(key); return undefined; }
        this.entries.delete(key); this.entries.set(key, entry);
        return JSON.parse(entry.raw);
    }

    set(key: string, value: unknown, ttlMs?: number): void {
        const expiresAt = ttlMs === undefined ? undefined : Date.now() + ttlMs;
        const raw = JSON.stringify(value);
        const bytes = encoder.encode(key).length + encoder.encode(raw).length;
        if (bytes > this.maxBytes) throw new Error('maxBytes');
        this.remove(key);
        if (expiresAt !== undefined && Date.now() >= expiresAt) return;
        if (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
            for (const [candidate, entry] of this.entries) {
                if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) this.remove(candidate);
            }
            while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) this.remove(this.entries.keys().next().value!);
        }
        this.entries.set(key, { raw, expiresAt, bytes });
        this.bytes += bytes;
    }

    delete(key: string): void { this.remove(key); }

    private remove(key: string): void {
        const entry = this.entries.get(key);
        if (entry) this.bytes -= entry.bytes;
        this.entries.delete(key);
    }
}

/** Small deterministic PRNG so failures replay. */
function random(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

describe('InMemoryCacheStore at capacity', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_700_000_000_000); });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    /** A full store whose short-lived half has expired between long-lived entries. */
    async function seeded(size: number) {
        const store = new InMemoryCacheStore(size, 64 * 1024 * 1024);
        for (let i = 0; i < size; i++) await store.set(`seed${i}`, i, i % 2 ? 60_000 + i : 10 + (i % 7));
        vi.advanceTimersByTime(20);
        return store;
    }
    async function flood(store: InMemoryCacheStore, writes: number) {
        for (let i = 0; i < writes; i++) {
            await store.set(`flood${i}`, i, 60_000);
            if (i % 100 === 0) vi.advanceTimersByTime(1);
        }
    }

    it('writes without iterating every entry, including when some have expired', async () => {
        const size = 1_000;
        const writes = 2_000;
        const store = await seeded(size);
        const entries: Map<string, unknown> = (store as any).entries;
        const scans = ([Symbol.iterator, 'entries', 'keys', 'values', 'forEach'] as const)
            .map(method => vi.spyOn(entries, method as 'keys'));
        const clock = vi.spyOn(Date, 'now');
        await flood(store, writes);

        for (const scan of scans) expect(scan).not.toHaveBeenCalled();
        // An expiry scan reads the clock once per entry; a write reads it a fixed number of times.
        expect(clock.mock.calls.length).toBeLessThanOrEqual(writes * 4);
        expect(entries.size).toBe(size);
        // The expired half went first, then the live seeds, then the oldest writes.
        expect(await store.get('seed0')).toBeUndefined();
        expect(await store.get('seed999')).toBeUndefined();
        expect(await store.get(`flood${writes - 1}`)).toBe(writes - 1);
        expect(await store.get(`flood${writes - size}`)).toBe(writes - size);
        expect(await store.get(`flood${writes - size - 1}`)).toBeUndefined();
    });

    it('moves each entry between expiry buckets a bounded number of times', async () => {
        const size = 1_000;
        const writes = 2_000;
        const store = await seeded(size);
        const relinks = vi.spyOn((store as any).expiry, 'link');
        await flood(store, writes);
        // A move always targets a strictly lower bucket, so at most 53 per entry.
        expect(relinks.mock.calls.length).toBeLessThanOrEqual(53 * (size + writes));
    });

    it('reclaims an expired entry behind live ones before evicting any live entry', async () => {
        const store = new InMemoryCacheStore(3);
        await store.set('live-a', 'a', 60_000);
        await store.set('short', 's', 10);
        await store.set('live-b', 'b');
        vi.advanceTimersByTime(10);
        await store.set('new', 'n', 60_000);
        expect(await store.getMany(['live-a', 'short', 'live-b', 'new'])).toEqual(['a', undefined, 'b', 'n']);
    });

    it('frees byte budget from expired entries before evicting the least recently used', async () => {
        const store = new InMemoryCacheStore(100, 30);
        await store.set('a', '12345678', 60_000); // 11 bytes
        await store.set('b', '12345678', 5);
        await store.get('a');
        vi.advanceTimersByTime(5);
        await store.set('c', '1234567890123'); // 16 bytes: needs b's budget, not a's
        expect(await store.getMany(['a', 'b', 'c'])).toEqual(['12345678', undefined, '1234567890123']);
        await store.set('d', '12'); // 5 bytes: over budget again, so the LRU (a) goes
        expect(await store.getMany(['a', 'c', 'd'])).toEqual([undefined, '1234567890123', '12']);
    });

    it.each([1, 2, 3, 4, 5, 6])('matches the scanning store for random operations (seed %i)', async seed => {
        const next = random(seed);
        const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)]!;
        const maxEntries = pick([1, 3, 8]);
        const maxBytes = pick([40, 120, 1_000]);
        const store = new InMemoryCacheStore(maxEntries, maxBytes);
        const reference = new ScanningStore(maxEntries, maxBytes);
        const keys = Array.from({ length: 12 }, (_, index) => `k${index}`);
        for (let step = 0; step < 3_000; step++) {
            const roll = next();
            const key = pick(keys);
            if (roll < 0.45) {
                const value = 'x'.repeat(Math.floor(next() * 20));
                const ttlMs = pick([undefined, 0, 1, 3, 7, 20, 50, 1_000, Math.floor(next() * 100)]);
                const expected = (() => { try { reference.set(key, value, ttlMs); return 'ok'; } catch { return 'rejected'; } })();
                const actual = await store.set(key, value, ttlMs).then(() => 'ok', () => 'rejected');
                expect(actual, `step ${step}`).toBe(expected);
            } else if (roll < 0.8) {
                expect(await store.get(key), `step ${step}`).toEqual(reference.get(key));
            } else if (roll < 0.85) {
                reference.delete(key); await store.delete(key);
            } else if (roll < 0.98) {
                vi.advanceTimersByTime(Math.floor(next() * 15));
            } else {
                // A clock that moves backwards must not hide or invent expiry.
                vi.setSystemTime(Date.now() - Math.floor(next() * 40));
            }
        }
        for (const key of keys) expect(await store.get(key), key).toEqual(reference.get(key));
    });

    it('keeps exact expiry when the clock moves backwards', async () => {
        const start = Date.now();
        const store = new InMemoryCacheStore(3);
        await store.set('a', 'a', 100); await store.set('b', 'b', 60_000); await store.set('c', 'c');
        vi.setSystemTime(start + 100);
        await store.set('d', 'd', 60_000); // reclaims a and raises the expiry floor past start
        const floor = (store as any).expiry.floor;
        expect(floor).toBeGreaterThan(start);
        vi.setSystemTime(start - 1_000);
        await store.set('e', 'e', 10); // nothing expired: evicts b; e's deadline is below the floor
        expect((store as any).expiry.floor).toBeLessThan(floor);
        vi.setSystemTime(start - 990);
        await store.set('f', 'f'); // e has expired and goes before the least recently used c
        expect(await store.getMany(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual([undefined, undefined, 'c', 'd', undefined, 'f']);
    });

    it('starts empty after flush and keeps working at capacity', async () => {
        const store = new InMemoryCacheStore(2);
        await store.set('a', 1, 10); await store.set('b', 2);
        await store.flush();
        await store.set('c', 3, 10); await store.set('d', 4); await store.set('e', 5);
        expect(await store.getMany(['a', 'b', 'c', 'd', 'e'])).toEqual([undefined, undefined, undefined, 4, 5]);
        vi.advanceTimersByTime(10);
        await store.set('f', 6);
        expect(await store.getMany(['d', 'e', 'f'])).toEqual([undefined, 5, 6]);
    });
});
