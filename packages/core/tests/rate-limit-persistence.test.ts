import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableObjectRateLimitStore, RateLimitDurableObject } from '../src/shared/rate-limit';
import { RateLimitStorageFixture } from './helpers/rate-limit-storage';

const request = (window = '60000') => new Request(`https://limit/?window=${window}`);
const body = async (response: Response) => response.json() as Promise<{ count: number; resetAt: number }>;
afterEach(() => vi.restoreAllMocks());

describe('durable fixed-window rate budgets', () => {
    it('keeps a spent window and its original deadline across instance reconstruction', async () => {
        let now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const storage = new RateLimitStorageFixture();
        const first = new RateLimitDurableObject(storage.state(), {});
        expect(await body(await first.fetch(request('1000')))).toEqual({ count: 1, resetAt: now + 1000 });
        now += 500;
        const restored = new RateLimitDurableObject(storage.state(), {});
        expect(await body(await restored.fetch(request('5000')))).toEqual({ count: 2, resetAt: now + 500 });
        now += 499;
        expect((await body(await restored.fetch(request('5000')))).count).toBe(3);
        now++;
        expect(await body(await restored.fetch(request('5000')))).toEqual({ count: 1, resetAt: now + 5000 });
    });

    it('sets expiry once per window and late alarms cannot delete a newer window', async () => {
        let now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const storage = new RateLimitStorageFixture();
        const object = new RateLimitDurableObject(storage.state(), {});
        await object.fetch(request('1000'));
        expect(storage.alarmTime).toBe(now + 1000);
        now += 500;
        await object.fetch(request('1000'));
        expect(storage.alarmTime).toBe(now + 500);
        // A delayed alarm for the old window runs after a fresh hit has reset it.
        now += 501;
        await object.fetch(request('2000'));
        await object.alarm();
        expect(storage.records.size).toBe(1);
        expect(storage.alarmTime).toBe(now + 2000);
        now += 2000;
        await object.alarm();
        expect(storage.records.size).toBe(0);
        expect(storage.alarmTime).toBeNull();
        await object.alarm(); // Duplicate delivery is harmless.
        expect(storage.records.size).toBe(0);
    });

    it.each(['failWrite', 'failAlarm'] as const)('rejects %s without acknowledging a non-durable hit', async (failure) => {
        const storage = new RateLimitStorageFixture();
        storage[failure] = true;
        const object = new RateLimitDurableObject(storage.state(), {});
        await expect(object.fetch(request())).rejects.toThrow(/failed/);
        expect(storage.records.size).toBe(0);
        storage[failure] = false;
        expect((await body(await new RateLimitDurableObject(storage.state(), {}).fetch(request()))).count).toBe(1);
    });

    it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '', '9007199254740991'])('rejects invalid window %j before storage', async window => {
        const storage = new RateLimitStorageFixture();
        const response = await new RateLimitDurableObject(storage.state(), {}).fetch(request(window));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'COSSACK_RATE_LIMIT_CONFIG_INVALID' });
        expect(storage.records.size).toBe(0);
        expect(storage.alarmTime).toBeNull();
    });

    it('does not reset a corrupt persisted counter', async () => {
        const storage = new RateLimitStorageFixture();
        const object = new RateLimitDurableObject(storage.state(), {});
        await object.fetch(request());
        const key = [...storage.records.keys()][0];
        storage.records.set(key, { count: -1, resetAt: Date.now() + 60000 });
        await expect(object.fetch(request())).rejects.toThrow(/counter/i);
        expect(storage.records.get(key)).toMatchObject({ count: -1 });
    });

    it('evaluates expiry after a queued transaction starts', async () => {
        let now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const storage = new RateLimitStorageFixture();
        const object = new RateLimitDurableObject(storage.state(), {});
        await object.fetch(request('1000'));
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const transaction = storage.transaction.bind(storage);
        vi.spyOn(storage, 'transaction').mockImplementationOnce(async callback => {
            await gate;
            return transaction(callback);
        });
        const queued = object.fetch(request('1000'));
        now += 1000;
        release();
        expect(await body(await queued)).toEqual({ count: 1, resetAt: now + 1000 });
    });

    it.each([0, -1, 1.5, NaN, Infinity])('rejects direct-store window %s before calling the binding', async window => {
        const get = vi.fn();
        const store = new DurableObjectRateLimitStore({ idFromName: name => name, get });
        await expect(store.hit('peer', window)).rejects.toThrow(/window/i);
        expect(get).not.toHaveBeenCalled();
    });

    it.each([{}, { count: 0, resetAt: Date.now() + 60000 }, { count: '1', resetAt: 100 },
        { count: 1, resetAt: -1 }, null])('rejects malformed DO reply %j', async reply => {
        const store = new DurableObjectRateLimitStore({ idFromName: name => name,
            get: () => ({ fetch: async () => Response.json(reply) }) });
        await expect(store.hit('peer', 60000)).rejects.toThrow(/counter/i);
    });
});
