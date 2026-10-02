import { expect, it, vi } from 'vitest';
import { ResponseLifetime } from '../src/response-lifetime';

it('releases every retained middleware resource once even if another close fails', async () => {
    const lifetime = new ResponseLifetime();
    expect(lifetime.deferCleanup(vi.fn())).toBe(false);
    const finish = lifetime.retain();
    const inner = vi.fn(async () => { throw new Error('inner database close failed'); });
    const outer = vi.fn(async () => {});
    expect(lifetime.deferCleanup(inner)).toBe(true);
    expect(lifetime.deferCleanup(outer)).toBe(true);
    const completion = finish();
    await expect(completion).rejects.toBeInstanceOf(AggregateError);
    expect(finish()).toBe(completion);
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).toHaveBeenCalledOnce();
    expect(lifetime.deferCleanup(vi.fn())).toBe(false);
});
