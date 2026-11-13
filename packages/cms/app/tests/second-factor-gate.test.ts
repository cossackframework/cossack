import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { ANONYMOUS, type Principal } from '@cossackframework/cms';

const { required } = vi.hoisted(() => ({ required: vi.fn() }));
vi.mock('../src/auth', () => ({ secondFactorRequired: required, accountNeedsSecondFactor: required }));
vi.mock('../src/cms/index', () => ({ cmsFor: vi.fn(), networkFor: vi.fn() }));
vi.mock('../src/cms/handoff', () => ({ handoff: vi.fn() }));
vi.mock('../src/cms/maintenance', () => ({ runMaintenance: vi.fn() }));
vi.mock('../src/dashboard/head', () => ({ dashboardPalette: vi.fn() }));

const { cmsPrincipal } = await import('../src/cms/middleware');

const staff: Principal = { kind: 'user', id: 'u1', roles: ['editor'], permissions: ['cms.dashboard'] } as unknown as Principal;

/** An app whose routes answer with the principal the CMS middleware chose. */
function app(options: { user?: boolean; token?: Principal } = {}) {
    const server = new Hono();
    server.use('*', async (c, next) => {
        if (options.user) c.set('user' as never, { id: 'u1', principal: staff } as never);
        c.set('cms' as never, {
            settings: { get: async () => 'off', all: async () => ({}) },
            tokenPrincipal: async () => options.token ? { principal: options.token, scope: 'write' } : null,
        } as never);
        await next();
    });
    server.use('*', cmsPrincipal);
    server.all('*', c => c.text((c.get('principal' as never) as Principal).kind === 'user' ? 'staff' : 'anonymous'));
    return server;
}

describe('required two-step sign-in', () => {
    it('makes a session waiting for a second factor anonymous on the site and in server methods', async () => {
        required.mockResolvedValue(true);
        for (const path of ['/posts/hello', '/preview/posts/1', '/crpc', '/dashboard/profile/security']) {
            expect(await (await app({ user: true }).request(path, { method: path === '/crpc' ? 'POST' : 'GET' })).text()).toBe('anonymous');
        }
        required.mockResolvedValue(false);
        expect(await (await app({ user: true }).request('/posts/hello')).text()).toBe('staff');
    });

    it('refuses the API but leaves sign-in and visitor endpoints open, as anyone', async () => {
        required.mockResolvedValue(true);
        const tokens = await app({ user: true }).request('/api/cms/me/tokens');
        expect(tokens.status).toBe(403);
        expect(await tokens.json()).toMatchObject({ code: 'CMS_SECOND_FACTOR_REQUIRED' });
        expect(await (await app({ user: true }).request('/api/auth/session', { method: 'DELETE' })).text()).toBe('staff');
        for (const path of ['/api/cms/comments', '/api/cms/forms/contact', '/api/cms/search', '/api/cms/menus/primary']) {
            const response = await app({ user: true }).request(path, { method: path === '/api/cms/search' ? 'GET' : 'POST' });
            expect(response.status, path).toBe(200);
            expect(await response.text(), path).toBe('anonymous');
        }
        expect((await app({ user: true }).request('/api/cms/forms/contact/submissions')).status).toBe(403);
    });

    it('refuses application passwords whose owner still needs a second factor', async () => {
        const bearer = { headers: { authorization: 'Bearer cms_secret' } };
        required.mockResolvedValue(true);
        const refused = await app({ token: staff }).request('/api/cms/content/posts', bearer);
        expect(refused.status).toBe(403);
        expect(required).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'u1', principal: staff }));
        required.mockResolvedValue(false);
        expect(await (await app({ token: staff }).request('/api/cms/content/posts', bearer)).text()).toBe('staff');
        expect(ANONYMOUS.kind).toBe('anonymous');
    });
});
