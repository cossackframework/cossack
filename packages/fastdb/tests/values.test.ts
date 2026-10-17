import { describe, expect, it } from 'vitest';
import { decodeValue, encodeValue, Float64, fromTransport, RecordId, toTransport, Vector, type Value } from '../src/index';

const roundTrip = (value: Value, base64 = false) => decodeValue(JSON.parse(JSON.stringify(encodeValue(value, base64))));

describe('document-transfer-v1 values', () => {
    it('keeps int64, explicit floats and negative zero distinct', () => {
        expect(encodeValue(1)).toEqual({ type: 'Integer', value: '1' });
        expect(encodeValue(1.5)).toEqual({ type: 'Number', value: '3ff8000000000000' });
        expect(encodeValue(new Float64(1))).toEqual({ type: 'Number', value: '3ff0000000000000' });
        expect(encodeValue(-0)).toEqual({ type: 'Number', value: '8000000000000000' });
        expect(roundTrip(9223372036854775807n)).toBe(9223372036854775807n);
        expect(roundTrip(-9223372036854775808n)).toBe(-9223372036854775808n);
        expect(roundTrip(7)).toBe(7n);
        const float = roundTrip(new Float64(2)) as Float64;
        expect(float).toBeInstanceOf(Float64);
        expect(float.value).toBe(2);
        expect(Object.is((roundTrip(-0) as Float64).value, -0)).toBe(true);
    });

    it('rejects values outside the contract', () => {
        expect(() => encodeValue(9223372036854775808n)).toThrow(RangeError);
        expect(() => encodeValue(2 ** 60)).toThrow(/bigint or Float64/);
        expect(() => encodeValue(Number.NaN)).toThrow(TypeError);
        // eslint-disable-next-line no-sparse-arrays
        expect(() => encodeValue([1, , 2] as Value)).toThrow(/holes/);
        expect(() => encodeValue({ a: undefined } as unknown as Value)).toThrow(/omit the field/);
        expect(() => encodeValue(new Date() as unknown as Value)).toThrow(/unsupported/);
        expect(() => encodeValue('\ud800')).toThrow(/well-formed/);
        let nested: Value = 1;
        for (let i = 0; i < 66; i++) nested = [nested];
        expect(() => encodeValue(nested)).toThrow(/nesting/);
    });

    it('preserves string and integer record keys', () => {
        const text = roundTrip(new RecordId('posts', '1')) as RecordId;
        const integer = roundTrip(new RecordId('posts', 1n)) as RecordId;
        expect(text.key).toBe('1');
        expect(integer.key).toBe(1n);
        expect(text.equals(integer)).toBe(false);
        expect(text.equals(new RecordId('posts', '1'))).toBe(true);
        expect(() => new RecordId('sqlite_master', 'x')).toThrow(/nonreserved/);
        expect(decodeValue({ type: 'Record', value: { table: 'posts', key: { String: 'p1' } } })).toEqual(new RecordId('posts', 'p1'));
    });

    it('encodes bytes as integers or canonical base64', () => {
        const bytes = new Uint8Array([0, 1, 254, 255]);
        expect(encodeValue(bytes)).toEqual({ type: 'Binary', value: [0, 1, 254, 255] });
        expect(encodeValue(bytes, true)).toEqual({ type: 'Binary', value: 'AAH+/w==' });
        expect(roundTrip(bytes, true)).toEqual(bytes);
        expect(() => decodeValue({ type: 'Binary', value: 'AAH+/w=' })).toThrow(/base64/);
        const vector = Vector.float32([1, 2.5]);
        expect((roundTrip(vector, true) as Vector).bytes).toEqual(vector.bytes);
        expect(Vector.float64([1]).bytes.at(-1)).toBe(2);
        expect(Vector.sparse32Entries(4, [[1, 2]]).bytes.at(-1)).toBe(9);
    });

    it('keeps objects with type and value fields ordinary', () => {
        const value = { type: 'Integer', value: 'x', nested: [{ id: new RecordId('users', 'u1') }] };
        expect(roundTrip(value)).toEqual(value);
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
