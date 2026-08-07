import { describe, expect, it, vi } from 'vitest';
import { decodeRuntimeRouteParams, withRuntimeRouteParams } from '../src/runtime-websocket';

describe('runtime WebSocket route params', () => {
  it('decodes string-only route params and rejects malformed frames', () => {
    expect(decodeRuntimeRouteParams('{"team":"cossack"}')).toEqual({ team: 'cossack' });
    expect(() => decodeRuntimeRouteParams('{')).toThrow();
    expect(() => decodeRuntimeRouteParams('["cossack"]')).toThrow('JSON object');
    expect(() => decodeRuntimeRouteParams('{"team":1}')).toThrow('contain strings');
  });

  it('exposes original page params without replacing auth or query access', () => {
    const get = vi.fn(() => ({ id: 'user-1' }));
    const query = vi.fn((key?: string) => key === 'filter' ? 'active' : {});
    const context = {
      get,
      req: { param: () => ({ provider: 'page', id: 'forged' }), query },
    } as any;
    const scoped = withRuntimeRouteParams(context, { team: 'cossack' });

    expect(scoped.req.param()).toEqual({ team: 'cossack' });
    expect(scoped.req.param('team')).toBe('cossack');
    expect(scoped.req.query('filter')).toBe('active');
    expect(scoped.get('user')).toEqual({ id: 'user-1' });
  });
});
