// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { Page, Component } from '../src/shared/decorators';
it.each([Page, Component])('rejects the removed route option for JavaScript consumers (%#)', decorator => {
    expect(() => decorator({ route: '/alias' } as any)).toThrowError(expect.objectContaining({ code: 'COSSACK_ROUTE_ALIAS_UNSUPPORTED' }));
});
it('rejects an unsupported route accessor without evaluating its value', () => {
    const getter = vi.fn(); const options = Object.defineProperty({}, 'route', { get: getter });
    expect(() => Page(options)).toThrow('file path'); expect(getter).not.toHaveBeenCalled();
});
