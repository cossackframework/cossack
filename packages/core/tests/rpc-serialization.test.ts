import { describe, expect, it, vi } from 'vitest';
import { describeUnsupportedValue, snapshotRpcValue } from '../src/shared/rpc-stream';

describe('RPC JSON value contract', () => {
    it('normalizes valid dates, optional fields, sparse arrays, and top-level void without mutating native data', () => {
        const when = new Date('2026-10-03T00:00:00.000Z');
        const input = { when, absent: undefined, list: [when, undefined, , null] };
        expect(snapshotRpcValue(input)).toEqual({ when: when.toISOString(), list: [when.toISOString(), null, null, null] });
        expect(snapshotRpcValue(undefined)).toBeUndefined();
        expect(input.when).toBe(when); expect(input.list[1]).toBeUndefined();
    });
    it('snapshots own enumerable model fields without transferring prototype methods', () => {
        class Model { id = 7; createdAt = new Date('2026-10-03'); save() { throw new Error('never invoked'); } }
        const value = snapshotRpcValue(new Model());
        expect(value).toEqual({ id: 7, createdAt: '2026-10-03T00:00:00.000Z' });
        expect(Object.getPrototypeOf(value)).toBeNull();
    });
    it('evaluates custom toJSON once at each location and validates the returned representation', () => {
        const toJSON = vi.fn((key: string) => ({ key, when: new Date('2026-10-03') }));
        expect(snapshotRpcValue({ row: { toJSON } })).toEqual({ row: { key: 'row', when: '2026-10-03T00:00:00.000Z' } });
        expect(toJSON).toHaveBeenCalledExactlyOnceWith('row');
        const bad = vi.fn(() => ({ nested: { value: Infinity } }));
        expect(() => snapshotRpcValue({ row: { toJSON: bad } }, 'value')).toThrow(expect.objectContaining({
            code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining('value.row.nested.value (non-finite number)'),
        }));
        expect(bad).toHaveBeenCalledOnce();
    });
    it('supports toJSON returning itself but still rejects actual cycles', () => {
        class Record { id = 1; toJSON() { return this; } }
        expect(snapshotRpcValue(new Record())).toEqual({ id: 1 });
        const parent: any = { toJSON() { return { parent }; } };
        expect(() => snapshotRpcValue(parent, 'value')).toThrow(/value.parent \(cyclic reference\)/);
    });
    it('does not invoke another hook on the returned representation', () => {
        const nestedHook = vi.fn(() => 'incorrect');
        class Representation { id = 1; toJSON = undefined; }
        Object.defineProperty(Representation.prototype, 'toJSON', { value: nestedHook });
        const representation = Object.assign(Object.create(Representation.prototype), { id: 1 });
        expect(snapshotRpcValue({ toJSON() { return representation; } })).toEqual({ id: 1 });
        expect(nestedHook).not.toHaveBeenCalled();
    });
    it.each([
        [NaN, 'non-finite number'], [Infinity, 'non-finite number'], [-Infinity, 'non-finite number'],
        [new Date('invalid'), 'invalid Date'], [new ArrayBuffer(4), 'binary value'],
        [new Uint8Array([1]), 'binary value'], [new DataView(new ArrayBuffer(4)), 'binary value'],
        [new Blob(['hello']), 'binary value'], [/pattern/, 'native object'],
        [new Error('private'), 'native object'], [Promise.resolve(1), 'native object'],
        [new URLSearchParams('a=1'), 'native object'], [new Number(1), 'native object'],
    ])('rejects lossy or opaque value %s with its path', (value, reason) => {
        expect(describeUnsupportedValue({ nested: value }, 'payload')).toBe(`payload.nested (${reason})`);
        expect(() => snapshotRpcValue({ nested: value }, 'payload')).toThrow(expect.objectContaining({
            code: 'COSSACK_RPC_SERIALIZATION_FAILED', message: expect.stringContaining(`payload.nested (${reason})`),
        }));
    });
    it('sanitizes failures in hooks and property access while preserving their location', () => {
        for (const value of [{ toJSON() { throw new Error('PRIVATE_TOKEN'); } },
            Object.defineProperty({}, 'data', { enumerable: true, get() { throw new Error('PRIVATE_TOKEN'); } })]) {
            try { snapshotRpcValue(value, 'result'); throw new Error('expected failure'); }
            catch (error: any) { expect(error.code).toBe('COSSACK_RPC_SERIALIZATION_FAILED'); expect(error.message).toContain('result'); expect(error.message).not.toContain('PRIVATE_TOKEN'); }
        }
    });
    it('preserves __proto__ as data and accepts shared references without accepting cycles', () => {
        const data = JSON.parse('{"__proto__":{"owned":true}}');
        expect(JSON.stringify(snapshotRpcValue(data))).toBe('{"__proto__":{"owned":true}}');
        const shared = { id: 1 };
        expect(snapshotRpcValue({ left: shared, right: shared })).toEqual({ left: { id: 1 }, right: { id: 1 } });
        (shared as any).self = shared;
        expect(() => snapshotRpcValue(shared)).toThrow(/self \(cyclic reference\)/);
    });
    it('bounds recursion before overflowing the stack', () => {
        let value: unknown = 1;
        for (let i = 0; i < 300; i++) value = { nested: value };
        expect(() => snapshotRpcValue(value)).toThrow(/maximum depth exceeded/);
    });
});
