import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { Cossack } from '@cossackframework/core';
import { createApiHandler } from '../src/api-handler';

const { rateLimit } = vi.hoisted(() => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('@cossackframework/core', async importOriginal => ({
    ...await importOriginal<typeof import('@cossackframework/core')>(), enforceMethodRateLimit: rateLimit,
}));
afterEach(() => { vi.restoreAllMocks(); rateLimit.mockReset(); rateLimit.mockResolvedValue(null); });

it.each(['authorize', 'handler', 'output'] as const)('redacts class API %s failures and correlates a safe response', async stage => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const crash = () => { throw Object.assign(new Error('private-error-sentinel'), { token: 'private-property-sentinel' }); };
    class Api extends Cossack { async get() { if (stage === 'handler') crash(); } }
    if (stage === 'authorize') rateLimit.mockImplementation(async () => crash());
    if (stage === 'output') vi.spyOn(Api.prototype, 'getPublicState').mockImplementation(crash);
    const app = new Hono<{ Variables: { 'cossack.configContext': { runtime: 'node' } } }>();
    app.use('*', async (c, next) => { c.set('cossack.configContext', { runtime: 'node' }); await next(); });
    app.get('/items/:id', createApiHandler(Api, ['get', 'init']));
    const response = await app.request('/items/private-path-sentinel?token=private-query-sentinel', { headers: { Authorization: 'Bearer private-header-sentinel' } });
    expect(response.status).toBe(500);
    const body = await response.json() as { requestId: string };
    expect(body).toEqual({ error: 'Internal Server Error', code: 'COSSACK_API_INTERNAL', requestId: expect.any(String) });
    expect(response.headers.get('X-Cossack-Request-Id')).toBe(body.requestId);
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]).toHaveLength(1);
    expect(logged.mock.calls[0][0]).toMatchObject({ event: 'cossack.api.failure', route: '/items/:id', action: 'get', runtime: 'node',
        stage, code: 'COSSACK_API_INTERNAL', requestId: body.requestId, durationMs: expect.any(Number) });
    expect(logged.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify([body, logged.mock.calls]);
    for (const value of ['private-error-sentinel', 'private-property-sentinel', 'private-path-sentinel', 'private-query-sentinel', 'private-header-sentinel']) expect(serialized).not.toContain(value);
});

it('preserves controlled HTTP exceptions without emitting an internal failure event', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Api extends Cossack { async get() { throw new HTTPException(409, { message: 'Conflict' }); } }
    const app = new Hono(); app.get('/items/:id', createApiHandler(Api, 'get'));
    const response = await app.request('/items/a');
    expect(response.status).toBe(409); expect(await response.text()).toBe('Conflict');
    expect(response.headers.get('X-Cossack-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(logged).not.toHaveBeenCalled();
});

it('restores the managed correlation header when a failing method changes it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Api extends Cossack { async get() {
        this.c.header('X-Cossack-Request-Id', 'private-application-header');
        throw Error('private-application-error');
    } }
    const app = new Hono(); app.get('/items/:id', createApiHandler(Api, 'get'));
    const response = await app.request('/items/a'); const body = await response.json() as { requestId: string };
    expect(response.status).toBe(500);
    expect(response.headers.get('X-Cossack-Request-Id')).toBe(body.requestId);
    expect(logged.mock.calls[0][0].requestId).toBe(body.requestId);
    expect(JSON.stringify([body, logged.mock.calls])).not.toContain('private-application');
});
