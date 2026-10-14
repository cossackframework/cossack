import { afterEach, expect, it, vi } from 'vitest';
import { component, renderToString, html } from '@cossackframework/renderer';
import { Toaster, createToastStore, toastStore, toast } from '../src/components/Toast';

afterEach(() => vi.unstubAllGlobals());
it('rejects server mutations without changing shared or isolated queues', () => {
    const scoped = createToastStore();
    for (const store of [toast, toastStore, scoped]) {
        for (const call of [() => store.show('Secret'), () => store.dismiss('x'), () => store.clear(), () => store.dispose(), () => store.subscribe(() => {})]) expect(call).toThrow('require a browser');
        expect(store.get()).toEqual([]);
    }
});
it('renders an empty named region and one permanent polite announcer on the server', () => {
    const output = renderToString(component(Toaster, { label: 'Updates', 'data-root': 'notifications', position: 'top-left' }));
    expect(output).toContain('role="region"'); expect(output).toContain('aria-label="Updates"');
    expect(output).toContain('data-root="notifications"'); expect(output).toContain('top-0 left-0');
    expect(output.match(/role="status"/g)).toHaveLength(1);
    expect(output).toContain('aria-relevant="additions"'); expect(output).toContain('aria-atomic="false"');
    expect(output).not.toContain('data-toast-id');
});
it.each([{ label: '' }, { dismissLabel: '' }, { position: 'wrong' }, { store: {} }])('rejects invalid presenter props %j', props => {
    expect(() => renderToString(component(Toaster, props as any))).toThrow('Toaster');
});
it('rejects ignored component children', () => expect(() => renderToString(component(Toaster, {}, html`lost`))).toThrow('not children'));
it.each([0, -1, 1.5, 101, NaN, Infinity])('rejects an invalid queue bound %s', maxToasts => expect(() => createToastStore({ maxToasts })).toThrow('maxToasts'));
it('isolates queues, freezes snapshots, bounds growth and owns a readonly subscription contract', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('document', {});
    const first = createToastStore({ maxToasts: 1 }), second = createToastStore();
    const seen: string[][] = [], unsubscribe = first.subscribe(items => seen.push(items.map(item => item.message)));
    const id = first.success('Saved', { duration: 0 });
    expect(first.get()[0]).toMatchObject({ id, message: 'Saved', duration: 0, variant: 'success' });
    expect(Object.isFrozen(first.get())).toBe(true); expect(Object.isFrozen(first.get()[0])).toBe(true);
    expect(second.get()).toEqual([]);
    first.dismiss('missing'); expect(seen).toEqual([[], ['Saved']]);
    first.dismiss(id); expect(seen.at(-1)).toEqual([]); unsubscribe(); first.warning('Later'); expect(seen).toHaveLength(3);
    first.dispose(); expect(first.get()).toEqual([]); expect(() => first.show('Disposed')).toThrow('disposed');
    first.dispose(); second.dispose();
});
it.each([{ duration: -1 }, { duration: NaN }, { duration: Infinity }, { duration: 2147483648 }, { duration: '1000' }, { duration: null }, { variant: 'error' }, { id: 'overridden' }, null])('rejects invalid options %j', options => {
    vi.stubGlobal('window', {}); vi.stubGlobal('document', {}); const store = createToastStore();
    expect(() => store.show('Message', options as any)).toThrow('Toast'); expect(store.get()).toEqual([]);
});
it('rejects empty messages and options outside a variant helper contract', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('document', {}); const store = createToastStore();
    expect(() => store.show(' ')).toThrow('nonempty');
    expect(() => store.success('X', { variant: 'warning' } as any)).toThrow('only duration');
    expect(() => store.error('X', null as any)).toThrow('only duration');
});
it('does not start timers without a presenter, and a bad subscriber does not hide changes from others', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('document', {}); vi.useFakeTimers();
    try {
        const store = createToastStore(); const snapshots: number[] = [];
        store.subscribe(items => { if (items.length) throw new Error('subscriber failure'); });
        store.subscribe(items => snapshots.push(items.length));
        expect(() => store.show('Queued', { duration: 1 })).toThrow('subscriber failed');
        expect(snapshots).toEqual([0, 1]); expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(1000); expect(store.get()).toHaveLength(1); store.clear();
        expect(snapshots.at(-1)).toBe(0);
    } finally { vi.useRealTimers(); }
});

it('generates distinct notification identities without cryptographic browser APIs', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('document', {}); vi.stubGlobal('crypto', undefined);
    const first = createToastStore(), second = createToastStore();
    const ids = [first.show('One'), second.show('Two'), first.show('Three')];
    expect(new Set(ids).size).toBe(3); first.dispose(); second.dispose();
});

it('drops the oldest toast instead of throwing when the queue is full', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('document', {});
    const store = createToastStore({ maxToasts: 2 });
    store.show('One', { duration: 0 }); store.show('Two', { duration: 0 });
    // toast.error() in a catch block must never mask the original error.
    expect(() => store.error('Three', { duration: 0 })).not.toThrow();
    expect(store.get().map(item => item.message)).toEqual(['Two', 'Three']);
    store.dispose();
});
