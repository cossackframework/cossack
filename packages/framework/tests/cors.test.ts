import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createCorsMiddleware, type CorsConfig } from '../src/middlewares/cors';
import { createApp } from '../src/router';

const base: CorsConfig = {
  enabled: true,
  origins: [],
  methods: ['GET', 'POST', 'OPTIONS'],
  headers: [],
  exposeHeaders: [],
  credentials: false,
  maxAge: 600,
};

function appWith(overrides: Partial<CorsConfig> = {}, downstream = vi.fn()) {
  const app = new Hono();
  app.use('*', createCorsMiddleware(() => ({ ...base, ...overrides })));
  app.use('*', async (c, next) => { downstream(c.req.path); await next(); });
  app.all('*', (c) => c.json({ ok: true }));
  return { app, downstream };
}

describe('built-in API CORS middleware', () => {
  it.each([
    ['exact', ['https://app.example.com/'], 'https://app.example.com'],
    ['scheme wildcard', ['https://*.example.com'], 'https://admin.example.com'],
    ['schemeless wildcard (https)', ['*.example.com'], 'https://admin.example.com'],
    ['schemeless wildcard (http)', ['*.example.com'], 'http://admin.example.com'],
  ])('allows %s origins', async (_name, origins, origin) => {
    const { app } = appWith({ origins });
    const res = await app.request('/api/users', { headers: { Origin: origin } });
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it.each([
    [['https://*.example.com'], 'http://admin.example.com'],
    [['https://*.example.com'], 'https://example.com'],
    [['not an origin'], 'https://not-an-origin.test'],
    [[], 'https://app.example.com'],
  ])('does not allow unmatched or invalid configuration %#', async (origins, origin) => {
    const { app } = appWith({ origins });
    const res = await app.request('/api/users', { headers: { Origin: origin } });
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('supports global wildcard origins', async () => {
    const { app } = appWith({ origins: ['*'] });
    const res = await app.request('/api', { headers: { Origin: 'https://anywhere.test' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns a complete 204 preflight and terminates before downstream middleware', async () => {
    const { app, downstream } = appWith({
      origins: ['https://app.example.com'],
      methods: ['GET', 'PATCH', 'OPTIONS'],
      exposeHeaders: ['X-Request-Id'],
      credentials: true,
      maxAge: 3600,
    });
    const res = await app.request('/api/users', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'X-Token, Content-Type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,PATCH,OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('X-Token,Content-Type');
    expect(res.headers.get('access-control-expose-headers')).toBe('X-Request-Id');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-max-age')).toBe('3600');
    expect(res.headers.get('vary')).toContain('Origin');
    expect(res.headers.get('vary')).toContain('Access-Control-Request-Headers');
    expect(downstream).not.toHaveBeenCalled();
  });

  it('uses configured allow headers instead of reflection', async () => {
    const { app } = appWith({ origins: ['*'], headers: ['Authorization'] });
    const res = await app.request('/api/x', {
      method: 'OPTIONS',
      headers: { Origin: 'https://client.test', 'Access-Control-Request-Headers': 'X-Untrusted' },
    });
    expect(res.headers.get('access-control-allow-headers')).toBe('Authorization');
  });

  it('adds CORS headers to handled API errors', async () => {
    const app = new Hono();
    app.use('*', createCorsMiddleware(() => ({ ...base, origins: ['https://app.example.com'] })));
    app.onError((_error, c) => c.json({ error: true }, 500));
    app.get('/api/fail', () => { throw new Error('failure'); });
    const res = await app.request('/api/fail', { headers: { Origin: 'https://app.example.com' } });
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('delegates all requests when disabled', async () => {
    const { app, downstream } = appWith({ enabled: false, origins: ['*'] });
    const res = await app.request('/api/x', { method: 'OPTIONS', headers: { Origin: 'https://client.test' } });
    expect(res.status).toBe(200);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
    expect(downstream).toHaveBeenCalledOnce();
  });

  it.each(['/page', '/crpc', '/upload', '/_cossack/sse', '/socket'])('ignores non-API path %s', async (path) => {
    const { app } = appWith({ origins: ['*'] });
    const res = await app.request(path, { headers: { Origin: 'https://client.test' } });
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('rejects credentials with the global wildcard', async () => {
    const { app } = appWith({ origins: ['*'], credentials: true });
    const res = await app.request('/api/x', { headers: { Origin: 'https://client.test' } });
    expect(res.status).toBe(500);
  });

  it.each(['/api/hello', '/api/class-based'])('is registered for real API route %s', async (path) => {
    const app = createApp();
    const res = await app.request(path, {
      method: 'OPTIONS',
      headers: { Origin: 'https://unconfigured.test', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('does not intercept OPTIONS for a real page route', async () => {
    const res = await createApp().request('/', { method: 'OPTIONS', headers: { Origin: 'https://client.test' } });
    expect(res.status).not.toBe(204);
    expect(res.headers.has('access-control-allow-origin')).toBe(false);
  });
});
