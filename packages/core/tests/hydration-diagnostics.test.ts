import { expect, it, vi } from 'vitest';
import { diagnoseHydrationState, hydrationBoundaryMetadata } from '../src/shared/hydration-diagnostics';
it('reports only safe source, state field and shape, never the rendered or hydrated values', () => {
    class Page {};
    Object.defineProperty(Page, '__source', { value: { file: '/private/repository/src/pages/page.ts', line: 5, column: 2 } });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        diagnoseHydrationState({ count: 1 }, { count: 'PRIVATE_HYDRATION_SENTINEL' }, 'data', hydrationBoundaryMetadata(Page));
        expect(warning).toHaveBeenCalledWith(expect.objectContaining({ category: 'state-type', statePath: 'public.data.count',
            expected: 'number', actual: 'string', component: 'Page', source: { file: 'src/pages/page.ts', line: 5, column: 2 } }));
        expect(JSON.stringify(warning.mock.calls)).not.toMatch(/PRIVATE_HYDRATION_SENTINEL|private\/repository/);
    } finally { warning.mockRestore(); }
});
it('allows valid changed values, client-only differences, nullable initializers and hostile accessors', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        diagnoseHydrationState(1, 2, 'count');
        diagnoseHydrationState(null, 'loaded', 'data');
        diagnoseHydrationState(1, 'expected', 'count', { expectedClientOnly: true });
        const before = { get secret() { throw Error('must not read'); } };
        diagnoseHydrationState(before, { secret: 'private' }, 'data');
        expect(warning).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
});
