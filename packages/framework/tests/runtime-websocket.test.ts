import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { decodeRuntimeRouteParams, withRuntimeRouteParams } from '../src/runtime-websocket';

describe('runtime WebSocket route params', () => {
  it('retains Hono response getters and setters while overriding page params', async () => {
    const app = new Hono();
    app.get('/tasks/:id', c => {
      const scoped = withRuntimeRouteParams(c, { id: 'page-id' });
      scoped.header('X-Before', 'kept');
      expect(scoped.res.headers.get('X-Before')).toBe('kept');
      scoped.res = new Response(scoped.req.param('id'), { status: 201 });
      scoped.header('X-After', 'kept');
      return scoped.res;
    });
    const response = await app.request('/tasks/socket-id');
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('page-id');
    expect(response.headers.get('X-Before')).toBe('kept');
    expect(response.headers.get('X-After')).toBe('kept');
  });
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
