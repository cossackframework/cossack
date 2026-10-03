import { expect, it, vi } from 'vitest';
import { snapshotNavigationDraft } from '../src/shared/navigation-draft';

it('preserves cycles and aliases across fields while isolating mutable records and arrays', () => {
    const child = { value: 'edit' };
    const root: any = { child, list: [child] };
    root.self = root;
    const result = snapshotNavigationDraft(new Map<string, unknown>([['root', root], ['alias', child]]));
    const next = result.get('root') as typeof root;
    expect(next).not.toBe(root);
    expect(next.self).toBe(next);
    expect(next.child).toBe(next.list[0]);
    expect(next.child).toBe(result.get('alias'));
    child.value = 'old write'; root.list.push({ value: 'old insertion' });
    expect(next.child.value).toBe('edit');
    expect(next.list).toHaveLength(1);
});

it('copies sparse arrays, symbols, descriptors and null-prototype records', () => {
    const symbol = Symbol('local');
    const value = Object.create(null);
    value[symbol] = { count: 1 };
    Object.defineProperty(value, 'hidden', { value: { count: 2 }, enumerable: false });
    Object.defineProperty(value, '__proto__', { value: { safe: true } });
    Object.preventExtensions(value);
    const array = new Array(4); array[2] = value;
    const next = snapshotNavigationDraft(new Map([['draft', array]])).get('draft') as any[];
    expect(next.length).toBe(4);
    expect(0 in next).toBe(false);
    expect(Object.getPrototypeOf(next[2])).toBe(null);
    expect(Object.isExtensible(next[2])).toBe(false);
    expect(next[2].__proto__).not.toBe(value.__proto__);
    expect(next[2][symbol]).not.toBe(value[symbol]);
    expect(Object.getOwnPropertyDescriptor(next[2], 'hidden')).toMatchObject({ enumerable: false, writable: false });
    expect(next[2].hidden).not.toBe(value.hidden);
});

it('retains native and authored capabilities by identity without serializing them', () => {
    class Capability { call() { return 'native'; } }
    const capability = new Capability();
    const file = new File(['edit'], 'edit.txt');
    const fn = () => 'callback';
    const value = { capability, file, fn, count: 1n, missing: undefined, nan: NaN };
    const next = snapshotNavigationDraft(new Map([['draft', value]])).get('draft') as typeof value;
    expect(next).not.toBe(value);
    expect(next.file).toBe(file);
    expect(next.capability).toBe(capability);
    expect(next.fn).toBe(fn);
    expect(next.count).toBe(1n);
    expect(next.nan).toBeNaN();
    expect(Object.hasOwn(next, 'missing')).toBe(true);
});

it('rejects draft accessors without running them', () => {
    const getter = vi.fn(() => { throw new Error('must not execute'); });
    const value = { nested: Object.defineProperty({}, 'computed', { get: getter }) };
    expect(() => snapshotNavigationDraft(new Map([['draft', value]]))).toThrow(
        expect.objectContaining({ code: 'COSSACK_NAVIGATION_DRAFT_ACCESSOR', field: 'draft' }),
    );
    expect(getter).not.toHaveBeenCalled();
});
