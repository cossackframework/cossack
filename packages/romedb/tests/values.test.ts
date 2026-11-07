import { describe, expect, it } from 'vitest';
import { decodeValue, encodeValue, Float64, fromTransport, RecordId, toTransport, Vector, type Value } from '../src/index';

describe('RomeDB values', () => {
    it('are the classes RomeDB returns, with RecordId as its Record', async () => {
        const romedb = await import('@romedb/client/values');
        expect(RecordId).toBe(romedb.Record);
        expect(Float64).toBe(romedb.Float64);
        expect(Vector).toBe(romedb.Vector);
        // The embedded client refuses values made by another copy of these classes.
        expect((await import('@romedb/node/values')).Record).toBe(romedb.Record);
        expect(decodeValue(encodeValue(new RecordId('posts', 1n)))).toEqual(new RecordId('posts', 1n));
        expect(() => new RecordId('sqlite_master', 'x')).toThrow(/nonreserved/);
    });
});

describe('transport representation', () => {
    it('round-trips every value through JSON', () => {
        const value: Value = {
            id: new RecordId('posts', 9n),
            author: new RecordId('users', 'tan'),
            count: 12345678901234567890n % 9223372036854775807n,
            ratio: new Float64(1),
            negativeZero: -0,
            plain: 3,
            bytes: new Uint8Array([1, 2]),
            vector: Vector.float32([0.5]),
            list: [null, true, 'x'],
            $fdb: 'user data',
        };
        const decoded = fromTransport(JSON.parse(JSON.stringify(toTransport(value)))) as { [key: string]: Value };
        expect(decoded.id).toEqual(new RecordId('posts', 9n));
        expect(decoded.author).toEqual(new RecordId('users', 'tan'));
        expect(decoded.count).toBe(value.count);
        expect(decoded.ratio).toEqual(new Float64(1));
        expect(Object.is((decoded.negativeZero as Float64).value, -0)).toBe(true);
        expect(decoded.plain).toBe(3);
        expect(decoded.bytes).toEqual(new Uint8Array([1, 2]));
        expect((decoded.vector as Vector).bytes).toEqual(Vector.float32([0.5]).bytes);
        expect(decoded.list).toEqual([null, true, 'x']);
        expect(decoded.$fdb).toBe('user data');
    });

    it('rejects unknown tags and versions', () => {
        expect(() => fromTransport({ $fdb: 2, t: 'int', v: '1' })).toThrow(/unsupported/);
        expect(() => fromTransport({ $fdb: 1, t: 'nope', v: '1' })).toThrow(/unsupported/);
        expect(() => fromTransport({ $fdb: 1, t: 'int', v: '01' })).toThrow(/int64/);
    });
});
