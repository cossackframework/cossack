import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { optimistic } from '../src/shared/optimistic';
import { beginOptimisticCall, finishOptimisticCall, applyOptimisticState, optimisticRequestState } from '../src/shared/optimistic-state';

afterEach(() => vi.restoreAllMocks());

function fixture() {
    class Counter { count = 0; items = ['base']; }
    Reflect.defineMetadata('cossack:state', { count: {} }, Counter);
    Reflect.defineMetadata('cossack:client-store', new Set(['items']), Counter);
    const target = new Counter();
    const begin = (value: string) => beginOptimisticCall(target, 'add', () => {
        const edits = optimistic(target);
        edits.increment('count', 1);
        edits.append('items', value);
    }, ['count', 'items']);
    return { target, begin };
}

describe('optimistic operation contributions', () => {
    it('removes an older failed increment and append while the newer call remains pending', () => {
        const { target, begin } = fixture();
        const old = begin('old'), next = begin('next');
        expect(target.count).toBe(2); expect(target.items).toEqual(['base', 'old', 'next']);
        finishOptimisticCall(old, false);
        expect(target.count).toBe(1); expect(target.items).toEqual(['base', 'next']);
        finishOptimisticCall(next, true);
        expect(target.count).toBe(1); expect(target.items).toEqual(['base', 'next']);
    });
    it('removes a newer failed increment and append while the older call remains pending', () => {
        const { target, begin } = fixture();
        const old = begin('old'), next = begin('next');
        finishOptimisticCall(next, false);
        expect(target.count).toBe(1); expect(target.items).toEqual(['base', 'old']);
        finishOptimisticCall(old, false);
        expect(target.count).toBe(0); expect(target.items).toEqual(['base']);
    });
    it('keeps only the newer committed local operations if an older call fails last', () => {
        const { target, begin } = fixture();
        const old = begin('old'), next = begin('next');
        finishOptimisticCall(next, true);
        finishOptimisticCall(old, false);
        expect(target.count).toBe(1); expect(target.items).toEqual(['base', 'next']);
    });
});

it('keeps an earlier user replacement as the base of a later successful local operation', () => {
    const { target, begin } = fixture();
    const old = begin('old'); target.count = 10;
    const next = begin('next');
    finishOptimisticCall(next, true);
    finishOptimisticCall(old, false);
    expect(target.count).toBe(11);
});


it('folds committed and pending local operations in call order for every completion order', () => {
    for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
        for (const success of [[true, true, true], [false, true, false], [true, false, true], [false, false, false]]) {
            const { target, begin } = fixture();
            const calls = ['a', 'b', 'c'].map(begin);
            const remaining = new Set([0, 1, 2]);
            for (const index of order) {
                finishOptimisticCall(calls[index], success[index]); remaining.delete(index);
                const visible = ['a', 'b', 'c'].filter((_, i) => remaining.has(i) || success[i]);
                expect(target.count).toBe(visible.length); expect(target.items).toEqual(['base', ...visible]);
                finishOptimisticCall(calls[index], success[index]); // settlement is idempotent
                expect(target.count).toBe(visible.length);
            }
        }
    }
});

it('rebases pending operations on an authoritative base without repeating a confirmed operation', () => {
    const { target, begin } = fixture();
    const old = begin('old'), next = begin('next');
    applyOptimisticState(target, 'count', 10, old);
    expect(target.count).toBe(11);
    finishOptimisticCall(old, true); expect(target.count).toBe(11);
    applyOptimisticState(target, 'count', 20, next);
    expect(target.count).toBe(20); finishOptimisticCall(next, true);
    expect(target.count).toBe(20);
    expect(target.items).toEqual(['base', 'old', 'next']);
});

it('keeps pending operations out of public requests after an intervening snapshot', () => {
    const { target, begin } = fixture(); const call = begin('pending');
    applyOptimisticState(target, 'count', 5);
    expect(target.count).toBe(6);
    expect(optimisticRequestState(target, { count: target.count })).toEqual({ count: 5 });
    finishOptimisticCall(call, false); expect(target.count).toBe(5);
});

it('removes the first structurally equal item and retains an independent append on rejection', () => {
    class List { items = [{ id: 1 }, { id: 1 }, { id: 2 }]; }
    const list = new List();
    const remove = beginOptimisticCall(list, 'remove', () => optimistic(list).remove('items', { id: 1 }), ['items']);
    const append = beginOptimisticCall(list, 'append', () => optimistic(list).append('items', { id: 3 }), ['items']);
    expect(list.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    finishOptimisticCall(remove, false);
    expect(list.items).toEqual([{ id: 1 }, { id: 1 }, { id: 2 }, { id: 3 }]);
    finishOptimisticCall(append, true);
    expect(list.items).toEqual([{ id: 1 }, { id: 1 }, { id: 2 }, { id: 3 }]);
});

it('owns a removal that was initially a no-op when an older removal fails', () => {
    const target = { items: ['a'] };
    const first = beginOptimisticCall(target, 'remove', () => optimistic(target).remove('items', 'a'), ['items']);
    const second = beginOptimisticCall(target, 'remove', () => optimistic(target).remove('items', 'a'), ['items']);
    finishOptimisticCall(first, false); expect(target.items).toEqual([]);
    finishOptimisticCall(second, false); expect(target.items).toEqual(['a']);
});

it('detaches appended data from both the input and live preview', () => {
    const target = { items: [] as { id: number }[] }, item = { id: 1 };
    const first = beginOptimisticCall(target, 'append', () => optimistic(target).append('items', item), ['items']);
    item.id = 99;
    const second = beginOptimisticCall(target, 'append', () => optimistic(target).append('items', { id: 2 }), ['items']);
    finishOptimisticCall(second, false);
    expect(target.items).toEqual([{ id: 1 }]); finishOptimisticCall(first, false);
    expect(target.items).toEqual([]);
});

it('rejects stale helpers and helpers outside a handler before mutation', () => {
    const { target } = fixture(); let edits!: ReturnType<typeof optimistic<typeof target>>;
    expect(() => optimistic(target)).toThrow('inside a synchronous');
    const first = beginOptimisticCall(target, 'capture', () => { edits = optimistic(target); edits.increment('count', 1); }, ['count']);
    expect(() => edits.increment('count', 1)).toThrow('execution has ended');
    const second = beginOptimisticCall(target, 'later', () => expect(() => edits.increment('count', 1)).toThrow('execution has ended'), ['count']);
    expect(target.count).toBe(1);
    finishOptimisticCall(first, false); finishOptimisticCall(second, true);
});

it.each(['before', 'after'])('restores a handler that mixes assignments and operations (%s)', position => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { target } = fixture();
    const call = beginOptimisticCall(target, 'mixed', () => {
        if (position === 'before') target.count = 10;
        optimistic(target).increment('count', 1);
        if (position === 'after') target.count = 10;
    }, ['count']);
    expect(target.count).toBe(0); expect(console.error).toHaveBeenCalled();
    finishOptimisticCall(call, false);
});

it('restores partial edits on invalid fields, nonfinite values, native objects and accessors without running getters', () => {
    const getter = vi.fn(() => 'secret');
    const accessor = Object.defineProperty({}, 'id', { enumerable: true, get: getter });
    for (const invalid of [(target: any) => optimistic(target).increment('count', Infinity),
        (target: any) => (optimistic(target) as any).increment('unknown', 1),
        (target: any) => (optimistic(target) as any).append('items', new Date()),
        (target: any) => (optimistic(target) as any).append('items', accessor)]) {
        const target = { count: 0, items: [] as unknown[] };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const call = beginOptimisticCall(target, 'invalid', () => { optimistic(target).increment('count', 1); invalid(target); }, ['count', 'items']);
        expect(target.count).toBe(0); expect(target.items).toEqual([]);
        finishOptimisticCall(call, false);
    }
    expect(getter).not.toHaveBeenCalled();
});
