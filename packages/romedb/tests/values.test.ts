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

    it('keeps a __proto__ key as a field instead of a prototype', () => {
        const decoded = fromTransport(JSON.parse('{"__proto__":{"isAdmin":true},"a":1}')) as { [key: string]: Value };
        expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
        expect((decoded as { isAdmin?: unknown }).isAdmin).toBeUndefined();
        expect(Object.keys(decoded)).toEqual(['__proto__', 'a']);
        const wrapped = fromTransport(JSON.parse('{"$fdb":1,"t":"obj","v":{"__proto__":{"x":1}}}')) as object;
        expect(Object.getPrototypeOf(wrapped)).toBe(Object.prototype);
        const encoded = toTransport(decoded) as object;
        expect(Object.getPrototypeOf(encoded)).toBe(Object.prototype);
        expect(JSON.parse(JSON.stringify(encoded))).toEqual(JSON.parse('{"__proto__":{"isAdmin":true},"a":1}'));
    });

    it('refuses integers outside int64', () => {
        expect(fromTransport({ $fdb: 1, t: 'int', v: '9223372036854775807' })).toBe(9223372036854775807n);
        expect(fromTransport({ $fdb: 1, t: 'int', v: '-9223372036854775808' })).toBe(-9223372036854775808n);
        expect(() => fromTransport({ $fdb: 1, t: 'int', v: '9223372036854775808' })).toThrow(/int64/);
        expect(() => fromTransport({ $fdb: 1, t: 'int', v: '9999999999999999999' })).toThrow(/int64/);
        expect(() => fromTransport({ $fdb: 1, t: 'rec', v: { table: 't', int: '9999999999999999999' } })).toThrow(/int64/);
    });

    it('rejects unknown tags and versions', () => {
        expect(() => fromTransport({ $fdb: 2, t: 'int', v: '1' })).toThrow(/unsupported/);
        expect(() => fromTransport({ $fdb: 1, t: 'nope', v: '1' })).toThrow(/unsupported/);
        expect(() => fromTransport({ $fdb: 1, t: 'int', v: '01' })).toThrow(/int64/);
    });
});
